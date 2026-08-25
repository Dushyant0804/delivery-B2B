// routes/bagsOverview.js

/**
 * Bags Overview Routes
 * - Summary for grid + graph
 * - WBNS list for a specific bag
 */

const { chuteIdFromBagCode } = require("../config/chuteId");
const { sharedClient: redis } = require("../config/redis");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function bagsOverviewRoutes(fastify, opts) {
  const pool = fastify.pg;

  /**
   * GET /bags/summary
   * Returns WBN count for all bags D001–D065, plus blocked (bag_sensors)
   * and full (settings cutoffs + Redis chute:{bag_code} mirror — the
   * SAME source sortEngine.js's isChuteFull() actually reads, not a
   * fresh Postgres recompute, so this reflects what's really being
   * enforced right now even if Redis and Postgres ever drift again).
   */
  fastify.get("/bags/summary", async (req, reply) => {
    try {
      // Generate D001 -> D065
      const allBags = [];
      for (let i = 1; i <= 65; i++) {
        allBags.push(`D${String(i).padStart(3, "0")}`);
      }

      // Fetch counts from bags_wbn (NEW SOURCE)
      const { rows } = await pool.query(`
        SELECT
          bag_code,
          COALESCE(array_length(wbns, 1), 0) AS count
        FROM bags_wbn
        WHERE bag_code ~ '^D\\d{3}$'
      `);

      const map = {};
      for (const r of rows) {
        map[r.bag_code] = Number(r.count) || 0;
      }

      // ── Blocked — bag_sensors, same chuteIdFromBagCode helper
      // isBagBlocked() uses, for consistency with live enforcement.
      const sensorRes = await pool.query(`SELECT chute_id, value FROM bag_sensors`);
      const sensorByChute = {};
      sensorRes.rows.forEach((r) => {
        sensorByChute[r.chute_id] = Number(r.value) === 1;
      });

      // ── Full — settings cutoffs + one Redis pipeline for all 65 bags
      // at once, instead of 65 individual round trips.
      const settingsRes = await pool.query(
        `SELECT cutoff_count, cutoff_weight, cutoff_realvolume FROM settings WHERE id=1`
      );
      const settings = settingsRes.rows[0] || {};
      const maxCount = num(settings.cutoff_count);
      const maxWeight = num(settings.cutoff_weight);
      const maxRealVolume = num(settings.cutoff_realvolume);
      const hasCutoffs = maxCount != null || maxWeight != null || maxRealVolume != null;

      let redisStats = {};
      if (hasCutoffs) {
        const pipeline = redis.pipeline();
        allBags.forEach((code) => {
          pipeline.hmget(`chute:${code}`, "count", "weight", "realvolume");
        });
        const results = await pipeline.exec();
        allBags.forEach((code, i) => {
          const [err, stats] = results[i] || [null, [null, null, null]];
          redisStats[code] = err ? [0, 0, 0] : stats;
        });
      }

      // Normalize: ensure all 65 bags exist
      const result = allBags.map((code) => {
        const chuteId = chuteIdFromBagCode(code);
        const blocked = chuteId ? !!sensorByChute[chuteId] : false;

        let full = false;
        if (hasCutoffs) {
          const [rc, rw, rv] = redisStats[code] || [0, 0, 0];
          const count = Number(rc) || 0;
          const weight = Number(rw) || 0;
          const realvolume = Number(rv) || 0;
          full =
            (maxCount != null && count >= maxCount) ||
            (maxWeight != null && weight >= maxWeight) ||
            (maxRealVolume != null && realvolume >= maxRealVolume);
        }

        return {
          bag_code: code,
          count: map[code] || 0,
          blocked,
          full
        };
      });

      return reply.send({
        success: true,
        total: result.length,
        bags: result
      });

    } catch (err) {
      fastify.log.error("GET /bags/summary error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * GET /bags/:bag_code/wbns
   * Returns WBNS list for a single bag (tooltip / modal), plus
   * weight/realvolume from the same bags_wbn row.
   */
  fastify.get("/bags/:bag_code/wbns", async (req, reply) => {
    try {
      const bagCode = String(req.params.bag_code || "").toUpperCase();

      if (!/^D\d{3}$/.test(bagCode)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag_code. Expected format D001–D065"
        });
      }

      // Fetch from bags_wbn (NEW SOURCE)
      const { rows } = await pool.query(
        `
        SELECT
          bag_code,
          COALESCE(wbns, '{}'::text[]) AS wbns,
          COALESCE(weight, 0) AS weight,
          COALESCE(realvolume, 0) AS realvolume,
          first_drop_at,
          updated_at
        FROM bags_wbn
        WHERE bag_code = $1
        LIMIT 1
        `,
        [bagCode]
      );

      // Bag exists but has no runtime entry yet
      if (rows.length === 0) {
        return reply.send({
          success: true,
          bag_code: bagCode,
          wbns: [],
          count: 0,
          weight: 0,
          realvolume: 0,
          first_drop_at: null
        });
      }

      return reply.send({
        success: true,
        bag_code: rows[0].bag_code,
        wbns: rows[0].wbns,
        count: rows[0].wbns.length,
        weight: Number(rows[0].weight) || 0,
        realvolume: Number(rows[0].realvolume) || 0,
        first_drop_at: rows[0].first_drop_at,
        updated_at: rows[0].updated_at
      });

    } catch (err) {
      fastify.log.error("GET /bags/:bag_code/wbns error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    }
  });
}

module.exports = bagsOverviewRoutes;