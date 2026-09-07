// plugins/confirmSortWorker.js
const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { redisConfig } = require("../config/redis");

module.exports = fp(async function confirmSortWorkerPlugin(fastify, opts) {
  const connection = new IORedis(redisConfig);

  new Worker(
    "confirmSortQueue",
    async (job) => {
      // 🔥 Job now sends "sort" instead of "status" — same SORTED/REJECTED-style
      // string values, renamed to match primaryApiWorker/secondaryApiWorker and
      // the primary_bin_data table's actual "sort" column name.
      const { wbn, bag_code, reason, sort, tracking_id } = job.data || {};
      const client = await fastify.pg.connect();
      let isNewWbn = false;

      if (!wbn || !bag_code) {
        console.warn("⚠️ confirmSortQueue: missing wbn or bag_code:", job.data);
        client.release();
        return;
      }

      try {
        await client.query("BEGIN");

        // ---------------------------------------------------
        // 0️⃣ WEIGHT / REALVOLUME LOOKUP (Exact match by tracking_id/latest scan)
        // ---------------------------------------------------
        const scanRes = await client.query(
          `SELECT tracking_id, weight, real_volume
           FROM primary_bin_data
           WHERE ${tracking_id ? "tracking_id = $1" : "wbn = $1 ORDER BY id DESC"}
           LIMIT 1`,
          [tracking_id || wbn]
        );

        const scannedWeight = scanRes.rows.length ? Number(scanRes.rows[0].weight) : NaN;
        const safeWeight = Number.isFinite(scannedWeight) ? scannedWeight : 0;

        const scannedRealVolume = scanRes.rows.length ? Number(scanRes.rows[0].real_volume) : NaN;
        const safeRealVolume = Number.isFinite(scannedRealVolume) ? scannedRealVolume : 0;
        const effectiveTrackingId = tracking_id || scanRes.rows[0]?.tracking_id;

        // ---------------------------------------------------
        // 1️⃣ BAGS_WBN TABLE UPSERT
        // ---------------------------------------------------
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
             VALUES ($1, ARRAY[$2::text], 1, $3, $4, NOW(), NOW())`,
            [bag_code, wbn, safeWeight, safeRealVolume]
          );
        } else if (isNewWbn) {
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

        // ---------------------------------------------------
        // 2️⃣ MOVE PAYLOAD (FROM sorted_payloads -> success_payloads & audit log)
        // ---------------------------------------------------
        const sortedRes = await client.query(
          `SELECT payload FROM sorted_payloads WHERE wbn=$1 LIMIT 1`,
          [wbn]
        );

        if (sortedRes.rows.length > 0) {
          const payload = sortedRes.rows[0].payload;

          // 2.1 Update/Insert into success_payloads
          await client.query(
            `INSERT INTO success_payloads (wbn, payload, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (wbn) DO UPDATE SET
               payload = EXCLUDED.payload,
               updated_at = NOW()`,
            [wbn, payload]
          );

          // 2.2 Update sorter_audit_log fetch_payload
          if (effectiveTrackingId) {
            await client.query(
              `UPDATE sorter_audit_log
               SET fetch_payload = $1,
                   updated_at = NOW()
               WHERE tracking_id = $2`,
              [JSON.stringify(payload), effectiveTrackingId]
            );
          } else {
            await client.query(
              `UPDATE sorter_audit_log
               SET fetch_payload = $1,
                   updated_at = NOW()
               WHERE id = (
                 SELECT id FROM sorter_audit_log WHERE wbn = $2 ORDER BY id DESC LIMIT 1
               )`,
              [JSON.stringify(payload), wbn]
            );
          }

          // 2.3 Delete from sorted_payloads buffer
          await client.query(
            `DELETE FROM sorted_payloads WHERE wbn=$1`,
            [wbn]
          );
        } else {
          console.log(`ℹ️ confirmSortQueue: No buffer payload in sorted_payloads for WBN ${wbn}`);
        }

        // ---------------------------------------------------
        // 3️⃣ UPDATE primary_bin_data (Row-targeted)
        // ---------------------------------------------------
        if (effectiveTrackingId) {
          await client.query(
            `UPDATE primary_bin_data
             SET final_bag = $1,
                 sort = $2,
                 reason = $3,
                 sorttime = NOW()
             WHERE tracking_id = $4`,
            [bag_code, sort, reason || null, effectiveTrackingId]
          );
        } else {
          await client.query(
            `UPDATE primary_bin_data
             SET final_bag = $1,
                 sort = $2,
                 reason = $3,
                 sorttime = NOW()
             WHERE id = (
               SELECT id FROM primary_bin_data WHERE wbn = $4 ORDER BY id DESC LIMIT 1
             )`,
            [bag_code, sort, reason || null, wbn]
          );
        }

        await client.query("COMMIT");

        // ---------------------------------------------------
        // 4️⃣ SYNC REDIS CHUTE COUNTERS (Post-Commit)
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
            console.error("❌ chute redis sync failed:", err.message);
          }
        }

        console.log(`✅ confirmSortQueue: Confirmation completed for WBN=${wbn}, Bag=${bag_code}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ confirmSort worker error:", err.message);
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
