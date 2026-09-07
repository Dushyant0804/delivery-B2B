// plugins/sortEngineWorker.js
// Dedicated Real-time Live Fetch Sorter Worker (Pure Routing & Primary Bin Data State Only)

const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const fetch = require("node-fetch");
const { redisConfig } = require("../config/redis");

module.exports = fp(async function sortEngineWorkerPlugin(fastify, opts) {
  const connection = new IORedis(redisConfig);

  // ---------------------------------------------------
  // UPDATE primary_bin_data ONLY
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
      console.error("❌ writePrimaryBinData failed:", err.message);
    }
  }

  function reject(reason, wbn) {
    const bag = fastify.sorter.rejectBag(reason);
    return { wbn, ptl_id: bag, bag_code: bag, bay_id: null, status: "REJECTED", reason };
  }

  // ---------------------------------------------------
  // REAL-TIME DELHIVERY LIVE FETCH API
  // ---------------------------------------------------
  async function fetchFromDelhiveryApi(pool, rawWbn, settings) {
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
      if (fastify.regexCache && !fastify.regexCache.validateWbn(wbn)) {
        return { ok: false, result: reject("IBO", wbn) };
      }
      validWbns.push(wbn);
    }
    if (!validWbns.length) return { ok: false, result: reject("IBO", rawWbn) };

    const centerParam = settings?.center_name 
      ? encodeURIComponent(`${settings.center_name} (${settings.state || ""})`.trim()) 
      : encodeURIComponent("Noida_DeriSkaner_H (Uttar Pradesh)");

    const rawToken = settings?.weight_api_token || process.env.DELHIVERY_AUTH_TOKEN || "";
    const cleanToken = String(rawToken).trim();
    const authToken = cleanToken.toLowerCase().startsWith("bearer ") ? cleanToken : `Bearer ${cleanToken}`;
// https://hq.delhivery.com/api/p/search?wbns=${validWbns.join(",")}&expected=${centerParam}
    const url = `http://localhost:4000/api/p/search`;

    let body;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authToken,
          Accept: "application/json",
        },
        timeout: 8000,
      });
      body = await res.json();
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

    // Store in sorted_payloads buffer for confirmation consumption
    try {
      await pool.query(
        `INSERT INTO sorted_payloads (wbn, payload, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (wbn) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [item.wbn, item]
      );
    } catch (e) {
      console.warn("⚠️ sorted_payloads write error:", e.message);
    }

    return { ok: true, item };
  }

  // ======================================================
  // BULLMQ WORKER
  // ======================================================
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

        const settings = typeof fastify.getSettings === "function" ? fastify.getSettings() : {};

        // 1️⃣ Precheck
        const preRes = await fastify.sorter.precheck({ wbn: jobWbn, ...dims });
        if (!preRes.ok) {
          const r = preRes.result;
          const finalWbn = r.wbn ?? jobWbn;
          await writePrimaryBinData(pool, { trackingId, wbn: jobWbn }, finalWbn, r.bag_code, "REJECTED", r.reason, r.ptl_id, r.bay_id);

          const out = {
            id,
            wbn: finalWbn,
            ptl_id: r.ptl_id,
            bag_code: r.bag_code,
            status: r.status,
            reason: r.reason,
            source: "PRECHECK",
            infeed,
          };
          fastify.broadcastSortResult?.(out);
          return out;
        }

        const { validWbns } = preRes;

        // 2️⃣ Live Fetch
        const fetched = await fetchFromDelhiveryApi(pool, validWbns.join(","), settings);
        if (!fetched.ok) {
          const r = fetched.result;
          const finalWbn = r.wbn ?? jobWbn;
          await writePrimaryBinData(pool, { trackingId, wbn: jobWbn }, finalWbn, r.bag_code, "REJECTED", r.reason, r.ptl_id, r.bay_id);

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

        const payload = fetched.item;

        // 3️⃣ Resolve Shipment
        const fullPayload = { ...payload, wbn: payload.wbn || jobWbn, ...dims };
        const result = await fastify.sorter.resolveShipment(fullPayload);
        if (!result) throw new Error("resolveShipment returned null");
        const finalWbn = result.wbn ?? jobWbn;

        // 4️⃣ Update Primary Bin Data
        await writePrimaryBinData(
          pool,
          { trackingId, wbn: jobWbn },
          finalWbn,
          result.bag_code,
          result.status === "INDUCTED" ? "INDUCTED" : "REJECTED",
          result.reason,
          result.ptl_id,
          result.bay_id
        );

        // 5️⃣ Broadcast Sorter Outcome to PLC/UI
        const broadcastStatus = result.status === "INDUCTED" ? "SORTED" : result.status;
        const broadcastReason = result.status === "INDUCTED" ? null : result.reason;

        const out = {
          id,
          wbn: finalWbn,
          ptl_id: result.ptl_id,
          bag_code: result.bag_code,
          status: broadcastStatus,
          reason: broadcastReason,
          source: "LIVE_FETCH",
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