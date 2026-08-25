// routes/clearBag.js
// "Clear Bag" operator flow: scan a bag_code, see its current
// count/weight/realvolume instantly, Block Bag (btn{N} 0->1) before
// Clear Bag (btn{N} 1->0 + full reset) becomes allowed.
//
// Bag-code FORMAT validation (D001-D035 only) is deliberately NOT done
// here — that's app-side, per instruction. This file accepts whatever
// bag_code string it's given and just looks it up; an unknown/malformed
// one simply won't match any bag_sensors/bags_wbn row.

const { sharedClient } = require("../config/redis");
const { chuteIdFromBagCode } = require("../config/chuteId");

async function loadBagStatus(pool, bagCode, chuteId) {
  const wbnRes = await pool.query(
    `SELECT count, weight, realvolume FROM bags_wbn WHERE bag_code=$1`,
    [bagCode]
  );

  // No row yet = a bag that's never had a confirmed drop — that's a
  // legitimate "empty" state, not an error.
  const stats = wbnRes.rows[0] || { count: 0, weight: 0, realvolume: 0 };

  const sensorRes = await pool.query(
    `SELECT value FROM bag_sensors WHERE chute_id=$1`,
    [chuteId]
  );

  const blocked = sensorRes.rows.length > 0 && Number(sensorRes.rows[0].value) === 1;

  return {
    bag_code: bagCode,
    count: Number(stats.count) || 0,
    weight: Number(stats.weight) || 0,
    realvolume: Number(stats.realvolume) || 0,
    blocked,
  };
}

async function clearBagRoutes(fastify, opts) {
  const pool = fastify.pg;

  // ----------------------------------------------------
  // GET current status — what the top-right panel shows the instant
  // a bag_code is scanned, and what drives Clear Bag's enabled state.
  // ----------------------------------------------------
  fastify.get("/clear-bag/:bag_code/status", async (req, reply) => {
    const bagCode = String(req.params.bag_code || "").toUpperCase();
    const chuteId = chuteIdFromBagCode(bagCode);

    if (!chuteId) {
      return reply.code(400).send({ success: false, error: "Invalid bag_code" });
    }

    const status = await loadBagStatus(pool, bagCode, chuteId);
    return reply.send({ success: true, ...status });
  });

  // ----------------------------------------------------
  // POST block — btn{N} 0 -> 1
  // ----------------------------------------------------
  fastify.post("/clear-bag/:bag_code/block", async (req, reply) => {
    const bagCode = String(req.params.bag_code || "").toUpperCase();
    const chuteId = chuteIdFromBagCode(bagCode);

    if (!chuteId) {
      return reply.code(400).send({ success: false, error: "Invalid bag_code" });
    }

    const res = await pool.query(
      `UPDATE bag_sensors SET value=1, updated_at=NOW() WHERE chute_id=$1`,
      [chuteId]
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ success: false, error: `Sensor ${chuteId} not found` });
    }

    const status = await loadBagStatus(pool, bagCode, chuteId);
    return reply.send({ success: true, ...status });
  });

  // ----------------------------------------------------
  // POST clear — only allowed while blocked (checked server-side, not
  // just trusted from the UI's disabled button). Resets bags_wbn,
  // bag_mappings.wbns, the Redis chute mirror, and btn{N} back to 0 —
  // all inside one transaction so a mid-way failure can't leave the
  // sensor and the counts out of sync with each other.
  // ----------------------------------------------------
  fastify.post("/clear-bag/:bag_code/clear", async (req, reply) => {
    const bagCode = String(req.params.bag_code || "").toUpperCase();
    const chuteId = chuteIdFromBagCode(bagCode);

    if (!chuteId) {
      return reply.code(400).send({ success: false, error: "Invalid bag_code" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // FOR UPDATE must run inside the transaction to actually hold
      // the row lock until COMMIT/ROLLBACK.
      const sensorRes = await client.query(
        `SELECT value FROM bag_sensors WHERE chute_id=$1 FOR UPDATE`,
        [chuteId]
      );

      const isBlocked = sensorRes.rows.length > 0 && Number(sensorRes.rows[0].value) === 1;

      if (!isBlocked) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          success: false,
          error: `Bag ${bagCode} must be blocked before it can be cleared.`,
        });
      }

      await client.query(
        `UPDATE bags_wbn
         SET wbns='{}', count=0, weight=0, realvolume=0, first_drop_at=NULL, updated_at=NOW()
         WHERE bag_code=$1`,
        [bagCode]
      );

      await client.query(
        `UPDATE bag_mappings SET wbns='{}', updated_at=NOW() WHERE bag_code=$1`,
        [bagCode]
      );

      await client.query(
        `UPDATE bag_sensors SET value=0, updated_at=NOW() WHERE chute_id=$1`,
        [chuteId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error({ err }, "❌ clear-bag transaction failed");
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }

    // Redis chute:{bag_code} counter mirror — outside the transaction,
    // same pattern bagMappings.js's clear-wbns/clear-all-wbns already use.
    try {
      await sharedClient.del(`chute:${bagCode}`);
    } catch (err) {
      console.error("❌ clear-bag redis chute cleanup failed:", err);
    }

    const status = await loadBagStatus(pool, bagCode, chuteId);
    return reply.send({ success: true, ...status });
  });
}

module.exports = clearBagRoutes;