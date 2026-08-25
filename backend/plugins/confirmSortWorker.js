// plugins/confirmSortWorker.js
const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");

module.exports = fp(async function confirmSortWorkerPlugin(fastify, opts) {
  const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
  });

  new Worker(
    "confirmSortQueue",
    async (job) => {
      const { id, wbn, bag_code, sort, reason, status } = job.data || {};
      const client = await fastify.pg.connect();
      let isNewWbn = false;

      if (!wbn || !bag_code) {
        console.warn("confirmSortQueue: missing wbn or bag_code:", job.data);
        client.release();
        return;
      }

      /** Only accept PLC success packets */
      // if (String(sort).toLowerCase() !== "success") {
      //   console.log("confirmSortQueue: ignored non-success:", job.data);
      //   client.release();
      //   return;
      // }

      try {
        await client.query("BEGIN");

        /***************************************************
         0️⃣ WEIGHT / REALVOLUME — from the DWS scan, not the PLC
         confirmation. The confirmation payload only carries an infeed
         id, not a tracking_id, so there's no exact per-scan match
         available here — this takes the wbn's last scan by scantime.
         That's fine: the dedup check just below (wbns array) is what
         actually prevents double-counting on a re-confirm, not this
         lookup, so an approximate "latest scan" match doesn't risk
         double-counting anything — worst case on a genuine same-wbn
         double-induction (jam recovery) is picking the wrong one of
         two scans' weight, not counting either twice.
        ***************************************************/
        const scanRes = await client.query(
          `SELECT weight, real_volume
           FROM primary_bin_data
           WHERE wbn = $1
           ORDER BY scantime DESC
           LIMIT 1`,
          [wbn]
        );

        const scannedWeight = scanRes.rows.length ? Number(scanRes.rows[0].weight) : NaN;
        const safeWeight = Number.isFinite(scannedWeight) ? scannedWeight : 0;

        const scannedRealVolume = scanRes.rows.length ? Number(scanRes.rows[0].real_volume) : NaN;
        const safeRealVolume = Number.isFinite(scannedRealVolume) ? scannedRealVolume : 0;

        /***************************************************
         1️⃣ BAGS_WBN TABLE UPSERT
         count/weight/realvolume are running totals for this
         physical bag. We lock+read first so we know for certain
         whether this wbn is actually new to the bag (isNewWbn) —
         needed both to avoid double-counting a re-confirm AND to
         keep the Redis chute:{bag_code} counters (read by
         sortEngine.js on every scan) in lockstep with Postgres.
        ***************************************************/
        const existingRow = await client.query(
          `SELECT wbns FROM bags_wbn WHERE bag_code=$1 FOR UPDATE`,
          [bag_code]
        );

        const isNewBagRow = existingRow.rows.length === 0;
        const alreadyHasWbn =
          !isNewBagRow &&
          Array.isArray(existingRow.rows[0].wbns) &&
          existingRow.rows[0].wbns.includes(wbn);
        isNewWbn = isNewBagRow || !alreadyHasWbn;

        if (isNewBagRow) {
          await client.query(
            `INSERT INTO bags_wbn (bag_code, wbns, count, weight, realvolume, first_drop_at, updated_at)
             VALUES ($1, ARRAY[$2], 1, $3, $4, NOW(), NOW())`,
            [bag_code, wbn, safeWeight, safeRealVolume]
          );
        } else if (isNewWbn) {
          // $2::text — without this cast, Postgres has to infer $2's
          // type for the `wbns || $2` expression and defaults to
          // text[] (matching wbns' own type) rather than the scalar
          // text it actually is, since text[]||text[] and text[]||text
          // are both valid overloads. node-pg then sends the plain wbn
          // string, and Postgres tries to parse it AS an array literal
          // — "malformed array literal", since a bare string isn't
          // valid array syntax (must start with '{'). Only bites once
          // a bag already has a row (isNewBagRow branch above uses
          // ARRAY[$2], which disambiguates the type on its own).
          await client.query(
            `UPDATE bags_wbn
             SET wbns = wbns || $2::text,
                 count = count + 1,
                 weight = weight + $3,
                 realvolume = realvolume + $4,
                 updated_at = NOW(),
                 first_drop_at = COALESCE(first_drop_at, NOW())
             WHERE bag_code = $1`,
            [bag_code, wbn, safeWeight, safeRealVolume]
          );
        }
        // else: duplicate wbn for this bag — no-op, matches prior behavior

        if (isNewWbn) {
          await client.query(
            `UPDATE bag_mappings
             SET wbns = CASE
                   WHEN wbns IS NULL THEN ARRAY[$2::text]
                   WHEN NOT (wbns @> ARRAY[$2::text]) THEN wbns || $2::text
                   ELSE wbns
                 END,
                 updated_at = NOW()
             WHERE bag_code = $1`,
            [bag_code, wbn]
          );
        }

        /***************************************************
         2️⃣ MOVE PAYLOAD (ONLY IF EXISTS)
        ***************************************************/
        const sortedRes = await client.query(
          `SELECT payload FROM sorted_payloads WHERE wbn=$1 LIMIT 1`,
          [wbn]
        );

        if (sortedRes.rows.length > 0) {
          const payload = sortedRes.rows[0].payload;

          /***************************************************
           2.1 MOVE TO success_payloads
          ***************************************************/
          const updRes = await client.query(
            `UPDATE success_payloads
     SET payload=$2, updated_at=NOW()
     WHERE wbn=$1`,
            [wbn, payload]
          );

          if (updRes.rowCount === 0) {
            await client.query(
              `INSERT INTO success_payloads (wbn, payload, updated_at)
       VALUES ($1,$2,NOW())`,
              [wbn, payload]
            );
          }

          /***************************************************
           2.2 UPDATE sorter_audit_log.fetch_payload ✅ NEW
          ***************************************************/
          await client.query(
            `UPDATE sorter_audit_log
     SET fetch_payload = $2,
         updated_at = NOW()
     WHERE wbn = $1`,
            [wbn, payload]
          );

          /***************************************************
           2.3 DELETE FROM sorted_payloads
          ***************************************************/
          await client.query(
            `DELETE FROM sorted_payloads WHERE wbn=$1`,
            [wbn]
          );
        } else {
          console.log(
            `confirmSortQueue: REJECT parcel, no payload move for WBN ${wbn}`
          );
        }

        /***************************************************
         3️⃣ UPDATE primary_bin_data (ALWAYS)
        ***************************************************/
        await client.query(
          `
          UPDATE primary_bin_data
          SET
            final_bag = $1,
            sort = $2,
            reason = $3,
            sorttime = NOW()
          WHERE wbn = $4
          `,
          [
            bag_code,        // final bag from PLC
            status,            // success
            reason || null,  // NDIM / IBO / etc
            wbn,
          ]
        );

        await client.query("COMMIT");

        // ---------------------------------------------------
        // 4️⃣ SYNC REDIS CHUTE COUNTERS (post-commit — Postgres is the
        // source of truth, this is the fast-read mirror sortEngine.js
        // hits on every scan). Runs outside the DB transaction since
        // Redis isn't transactional with it anyway; a failure here
        // logs but never fails the confirm.
        // ---------------------------------------------------
        if (isNewWbn) {
          try {
            const chuteKey = `chute:${bag_code}`;
            await connection
              .multi()
              .hincrby(chuteKey, "count", 1)
              .hincrbyfloat(chuteKey, "weight", safeWeight)
              .hincrbyfloat(chuteKey, "realvolume", safeRealVolume)
              .exec();
          } catch (err) {
            console.error("❌ chute redis sync failed:", err);
          }
        }

        console.log(
          `confirmSortQueue: updated primary_bin_data for WBN=${wbn}, bag=${bag_code}`
        );
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("confirmSort worker error:", err);
        throw err;
      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: Number(process.env.CONFIRM_SORT_WORKER_CONC || 5),
    }
  );

  console.log("⚙ confirmSortWorker started");
});