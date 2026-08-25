// plugins/sortEngineWorker.js
// Consolidated sort worker: DB/Redis-cache lookup, with a direct
// Delhivery API fallback when the wbn isn't already known.
// sortEngine.js's PTL-matching / business-rule logic is UNCHANGED.
// No sort_events logging — table retired. Rows are matched/updated
// in primary_bin_data by tracking_id (unique per scan), not wbn —
// and the worker writes the final validated wbn back onto that row
// (scanned_wbn on the row stays the untouched raw scan value).
//
// Every outcome (SORTED or REJECT) also writes a pending:{wbn} hash
// to the shared Dragonfly client — this is what Secondary Sorting's
// engine reads (and pops) later to resolve a scan without hitting
// Postgres on its hot path.

const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const fetch = require("node-fetch");
const { redisConfig, sharedClient } = require("../config/redis");
const { writePendingCache } = require("../config/pendingCache");

module.exports = fp(async function sortEngineWorkerPlugin(fastify, opts) {
  // Dedicated connection for the BullMQ Worker itself — never share this
  // with plain cache calls (see config/redis.js for why).
  const connection = new IORedis(redisConfig);

  // ---------------------------------------------------
  // UPDATE primary_bin_data — matched by tracking_id (falls
  // back to wbn-latest-row match only if no trackingId was
  // passed, e.g. jobs queued before this rollout). Also
  // writes the FINAL validated wbn, ptl_id, and bay_id.
  // ---------------------------------------------------
  async function writePrimaryBinData(pool, { trackingId, wbn }, finalWbn, expectedBag, sort, reason, ptlId, bayId) {
    try {
      if (trackingId) {
        await pool.query(
          `UPDATE primary_bin_data
           SET wbn = $1,
               expected_bag = $2,
               sort = $3,
               reason = $4,
               ptl_id = $5,
               bay_id = $6,
               scantime = NOW()
           WHERE tracking_id = $7`,
          [finalWbn, expectedBag, sort, reason, ptlId, bayId, trackingId]
        );
      } else {
        await pool.query(
          `UPDATE primary_bin_data
           SET wbn = $1,
               expected_bag = $2,
               sort = $3,
               reason = $4,
               ptl_id = $5,
               bay_id = $6,
               scantime = NOW()
           WHERE id = (
             SELECT id FROM primary_bin_data
             WHERE wbn = $7
             ORDER BY id DESC
             LIMIT 1
           )`,
          [finalWbn, expectedBag, sort, reason, ptlId, bayId, wbn]
        );
      }
    } catch (err) {
      console.error("❌ writePrimaryBinData failed:", err);
    }
  }

  // ---------------------------------------------------
  // (pending:{wbn} cache writes now come from ../config/pendingCache.js —
  // shared with Primary Sorting HHD, see that file for details)
  // ---------------------------------------------------

  // Reject-result shape, matching sortEngine.js's precheck()/resolveShipment()
  function reject(reason, wbn) {
    const bag = fastify.sorter.rejectBag(reason);
    return { wbn, ptl_id: bag, bag_code: bag, bay_id: null, status: "REJECT", reason };
  }

  // ---------------------------------------------------
  // DELHIVERY API FALLBACK — only reached when the wbn isn't
  // already in sorted_payloads / Redis cache.
  // ---------------------------------------------------
  async function fetchFromDelhiveryApi(pool, rawWbn) {
    const rawWbns = rawWbn
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

    if (!rawWbns.length) return { ok: false, result: reject("DNF", null) };

    const validWbns = [];
    for (const wbn of rawWbns) {
      if (wbn.trim().toUpperCase() === "NO_READ") {
        return { ok: false, result: reject("DBO", wbn) };
      }
      if (!fastify.regexCache.validateWbn(wbn)) {
        return { ok: false, result: reject("IBO", wbn) };
      }
      validWbns.push(wbn);
    }
    if (!validWbns.length) return { ok: false, result: reject("IBO", rawWbn) };

    const url =
      `https://hq.delhivery.com/api/p/search` +
      `?wbns=${validWbns.join(",")}` +
      `&expected=Noida_DeriSkaner_H (Uttar Pradesh)`;

    let body;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImtlbmdpYy1wcmltYXJ5LXNvcnRlci1ldmVudCIsInRva2VuX25hbWUiOiJrZW5naWMtcHJpbWFyeS1zb3J0ZXItZXZlbnQiLCJjZW50ZXIiOlsiSU5EMTIyMDAzQUFCIl0sInVzZXJfdHlwZSI6Ik5GIiwiYXBwX2lkIjoxLCJhdWQiOiIuZGVsaGl2ZXJ5LmNvbSIsImZpcnN0X25hbWUiOiJLRU5HSUMtcHJpbWFyeS1zb3J0ZXItZXZlbnQiLCJzdWIiOiJ1bXM6OnVzZXI6OmM0OTk3MDE0LTkwYzAtMTFlZC1iOTQxLTAyZjY0ZWY3NWZiNCIsImV4cCI6MTk4ODY5OTMxMywiYXBwX25hbWUiOiJVTVMiLCJhcGlfdmVyc2lvbiI6InYyIn0.0mhtfEDwV0XpXo59loxB62WtWgA92xf07YPmlpS2a1c`,
          Accept: "application/json",
        },
        timeout: 8000,
      });
      // console.log(url);
      body = await res.json();
      // console.log({ body }, "✅ Live Fetch API Response");
    } catch (err) {
      return { ok: false, result: reject("API_FAIL", rawWbn) };
    }

    if (!body || body.count === 0 || !Array.isArray(body.result)) {
      return { ok: false, result: reject("DNF", rawWbn) };
    }
    if (body.count > 1) {
      return { ok: false, result: reject("MSE", rawWbn) };
    }

    const item = body.result[0];

    await pool.query(
      `INSERT INTO sorted_payloads (wbn, payload, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (wbn) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [item.wbn, item]
    );

    return { ok: true, item };
  }

  new Worker(
    "sortEngineQueue",
    async (job) => {
      const pool = fastify.pg;
      const {
        id,
        wbn: jobWbn,
        trackingId,
        infeed,
        length,
        width,
        height,
        weight,
        volume,
        realvolume,
        Volume,
        RealVolume,
      } = job.data;

      const dims = {
        length,
        width,
        height,
        weight,
        volume: volume ?? Volume,
        realvolume: realvolume ?? RealVolume,
      };

      const client = await pool.connect();
      try {
        // 0️⃣ Active config check
        if (!fastify.sorter?.isActive()) {
          const out = {
            id,
            wbn: jobWbn,
            bag_code: null,
            ptl_id: null,
            status: "ERROR",
            reason: "NO_ACTIVE_CONFIG",
            infeed,
          };
          fastify.broadcastSortResult?.(out);
          return out;
        }


        // 1️⃣ EARLY PRE-CHECK — barcode format (comma-split, per-
        // candidate) / NO_READ(DBO) / dims
        const preRes = await fastify.sorter.precheck({ wbn: jobWbn, ...dims });
        if (!preRes.ok) {
          const r = preRes.result;
          const finalWbn = r.wbn ?? jobWbn;
          await writePrimaryBinData(pool, { trackingId, wbn: jobWbn }, finalWbn, r.bag_code, "REJECTED", r.reason, r.ptl_id, r.bay_id);
          await writePendingCache(finalWbn, { status: r.status, ptlId: r.ptl_id, bagId: r.bay_id, reason: r.reason });
          const out = {
            id,
            wbn: finalWbn,
            ptl_id: r.ptl_id,
            bag_code: r.bag_code,
            status: r.status,
            reason: r.reason,
            source: "DB Fetch",
            infeed,
          };
          fastify.broadcastSortResult?.(out);
          return out;
        }

        const { validWbns } = preRes;

        // 2️⃣ Look for an existing payload — try each valid candidate
        // against Redis cache, then sorted_payloads, in order
        let payload = null;
        let source = "DB Fetch";

        for (const candidate of validWbns) {
          try {
            const raw = await sharedClient.get(`payload:${candidate}`);
            if (raw) { payload = JSON.parse(raw); break; }
          } catch (_) { }
        }

        if (!payload) {
          for (const candidate of validWbns) {
            const res = await client.query(
              `SELECT payload FROM sorted_payloads WHERE wbn=$1 LIMIT 1`,
              [candidate]
            );
            if (res.rows.length) { payload = res.rows[0].payload; break; }
          }
        }

        // 3️⃣ Not cached anywhere → fall back to the Delhivery API
        // with all valid candidates (it disambiguates via the search API)
        if (!payload) {
          const fetched = await fetchFromDelhiveryApi(pool, validWbns.join(","));
          if (!fetched.ok) {
            const r = fetched.result;
            const finalWbn = r.wbn ?? jobWbn;
            await writePrimaryBinData(pool, { trackingId, wbn: jobWbn }, finalWbn, r.bag_code, "REJECTED", r.reason, r.ptl_id, r.bay_id);
            await writePendingCache(finalWbn, { status: r.status, ptlId: r.ptl_id, bagId: r.bay_id, reason: r.reason });
            const out = {
              id,
              wbn: finalWbn,
              ptl_id: r.ptl_id,
              bag_code: r.bag_code,
              status: r.status,
              reason: r.reason,
              source: "LIVE_FETCH",
              infeed,
            };
            fastify.broadcastSortResult?.(out);
            return out;
          }
          payload = fetched.item;
          source = "LIVE_FETCH";
        }
        // 4️⃣ Merge box dims onto the payload
        const fullPayload = { ...payload, wbn: payload.wbn || jobWbn, ...dims };

        // 5️⃣ Resolve shipment — sortEngine.js's business/PTL logic, UNCHANGED
        const result = await fastify.sorter.resolveShipment(fullPayload);
        if (!result) throw new Error("resolveShipment returned null");
        const finalWbn = result.wbn ?? jobWbn;

        // 6️⃣ Update primary_bin_data — final wbn + expected_bag / sort / reason / ptl_id / bay_id / sorttime
        await writePrimaryBinData(
          pool,
          { trackingId, wbn: jobWbn },
          finalWbn,
          result.bag_code,
          // A successful Machine resolution is now INDUCTED (not SORTED)
          // until confirmSortWorker.js overwrites it with the real
          // outcome once PLC confirmation arrives. "REJECTED" (with the
          // D) is kept as-is to match the literal string every other
          // writePrimaryBinData call in this file already uses for
          // rejects — result.status itself is "REJECT" (singular) on
          // that path, so this can't be a blind passthrough.
          result.status === "INDUCTED" ? "INDUCTED" : "REJECTED",
          result.reason,
          result.ptl_id,
          result.bay_id
        );

        // 6.5️⃣ Write pending:{wbn} — what Secondary Sorting reads later
        await writePendingCache(finalWbn, {
          status: result.status,
          ptlId: result.ptl_id,
          bagId: result.bay_id,
          reason: result.reason,
        });

        // 7️⃣ Cleanup Redis payload cache
        try {
          await sharedClient.del(`payload:${jobWbn}`);
        } catch (_) { }

        // 8️⃣ Broadcast result — PLC/sort-result clients only care about
        // the physical routing decision, not confirmation bookkeeping,
        // so INDUCTED/NCONF is translated back to SORTED/null here.
        // The table (step 6) and pending cache (step 6.5) above keep
        // the real INDUCTED/NCONF values untouched.
        const broadcastStatus = result.status === "INDUCTED" ? "SORTED" : result.status;
        const broadcastReason = result.status === "INDUCTED" ? null : result.reason;

        const out = {
          id,
          wbn: finalWbn,
          ptl_id: result.ptl_id,
          bag_code: result.bag_code,
          status: broadcastStatus,
          reason: broadcastReason,
          source,
          infeed,
        };
        console.log("📤 SORT RESULT:", out);
        fastify.broadcastSortResult?.(out);
        return out;
      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: Number(process.env.SORTER_WORKER_CONC || 8),
    }
  );

  console.log("⚙ sortEngineWorker started");
});