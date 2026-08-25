// routes/sortDebugRoutes.js
const IORedis = require("ioredis");

module.exports = async function sortDebugRoutes(fastify, opts) {
  const pool = fastify.pg;
  const redis = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
  });

  /**
   * Helper: get payload by wbn (Redis first, then Postgres)
   * Returns null if not found.
   */
  async function getPayloadByWbn(wbn) {
    try {
      const cached = await redis.get(`payload:${wbn}`);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      fastify.log.warn("Redis get failed in debug route:", e.message);
    }

    const res = await pool.query(`SELECT payload FROM sorted_payloads WHERE wbn=$1 LIMIT 1`, [wbn]);
    if (res.rows.length === 0) return null;
    return res.rows[0].payload;
  }

  /**
   * 1) Full test endpoint: perform full movement (DELETE from sorted_payloads -> INSERT into success_payloads)
   *    This mimics the worker exactly and writes sort_events.
   */
  fastify.post("/test/:wbn", async (req, reply) => {
    const wbn = req.params.wbn;
    const jobId = `manual-test-${Date.now()}`;

    if (!wbn) return reply.code(400).send({ error: "wbn required" });

    // 1. load payload (redis -> db)
    const payload = await getPayloadByWbn(wbn);
    if (!payload) {
      // DNF
      const resObj = { wbn, bag_code: "R001", status: "REJECT", reason: "DNF" };
      // write event
      await pool.query(
        `INSERT INTO sort_events (wbn, job_id, event_type, details) VALUES ($1,$2,$3,$4)`,
        [wbn, jobId, "SORT_FAIL", { reason: "DNF" }]
      );
      return reply.code(404).send(resObj);
    }

    // 2. resolve using sorter (in-memory)
    let result;
    try {
      result = await fastify.sorter.resolveShipment(payload);
    } catch (err) {
      fastify.log.error("Resolver error in /test:", err);
      return reply.code(500).send({ error: "resolve error", detail: String(err.message) });
    }

    // 3. perform DB atomic move (DELETE + INSERT) identical to worker
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // delete from sorted_payloads and get payload back (if present)
      const delRes = await client.query(`DELETE FROM sorted_payloads WHERE wbn=$1 RETURNING payload`, [wbn]);

      // If row wasn't present (maybe previously moved), check success_payloads for idempotency
      if (delRes.rowCount === 0) {
        const exist = await client.query(`SELECT * FROM success_payloads WHERE wbn=$1 LIMIT 1`, [wbn]);
        if (exist.rows.length > 0) {
          await client.query("COMMIT");
          const row = exist.rows[0];
          const out = {
            wbn,
            bag_code: row.bag_code,
            ptl_id: row.bag_code,
            status: row.status,
            reason: row.reason,
            note: "already moved"
          };
          // log a duplicate attempt event
          await pool.query(`INSERT INTO sort_events (wbn, job_id, event_type, details) VALUES ($1,$2,$3,$4)`,
            [wbn, jobId, "SORT_IDEMPOTENT", { existing: true }]);
          return reply.code(200).send(out);
        }
      }

      // find bag_id if sorted
      let bagId = null;
      if (result.status === "SORTED") {
        const bq = await client.query(`SELECT id FROM bags WHERE bag_code=$1 LIMIT 1`, [result.bag_code]);
        if (bq.rows.length) bagId = bq.rows[0].id;
      }

      // insert into success_payloads
      await client.query(
        `INSERT INTO success_payloads (wbn, payload, bag_code, bag_id, status, reason, sorter_job_id, sorted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [wbn, payload, result.bag_code, bagId, result.status, result.reason, jobId]
      );

      // record event
      await client.query(
        `INSERT INTO sort_events (wbn, job_id, event_type, details) VALUES ($1,$2,$3,$4)`,
        [wbn, jobId, result.status === "SORTED" ? "SORT_SUCCESS" : "SORT_REJECT", { result }]
      );

      await client.query("COMMIT");

      // optionally cleanup redis cache
      try { await redis.del(`payload:${wbn}`); } catch (e) { /* ignore */ }

      // return the same shape as worker broadcast
      const out = {
        wbn,
        bag_code: result.bag_code,
        ptl_id: result.ptl_id || result.bag_code,
        status: result.status,
        reason: result.reason
      };
      return reply.code(200).send(out);

    } catch (err) {
      await client.query("ROLLBACK").catch(()=>{});
      fastify.log.error("Test endpoint DB error:", err);
      return reply.code(500).send({ error: "DB error", detail: String(err.message) });
    } finally {
      client.release();
    }
  });


  /**
   * POST /api/sort/resolve
   * Accepts JSON body payload and returns resolveShipment result WITHOUT modifying DB.
   * Useful for previewing what the worker would do.
   */
  fastify.post("/resolve", async (req, reply) => {
    const payload = req.body;
    if (!payload || !payload.wbn) return reply.code(400).send({ error: "payload with wbn required" });
    try {
      const result = await fastify.sorter.resolveShipment(payload);
      return reply.code(200).send(result);
    } catch (err) {
      fastify.log.error("resolve API error:", err);
      return reply.code(500).send({ error: "resolve failed", detail: String(err.message) });
    }
  });


  /**
   * GET /api/sort/events/:wbn
   * Return audit events for a WBN
   */
  fastify.get("/events/:wbn", async (req, reply) => {
    const wbn = req.params.wbn;
    if (!wbn) return reply.code(400).send({ error: "wbn required" });
    try {
      const res = await pool.query(`SELECT * FROM sort_events WHERE wbn=$1 ORDER BY created_at DESC LIMIT 200`, [wbn]);
      return reply.code(200).send(res.rows);
    } catch (err) {
      fastify.log.error("events API error:", err);
      return reply.code(500).send({ error: "failed to fetch events" });
    }
  });


  /**
   * GET /api/sort/active-config
   * Return active config info
   */
  fastify.get("/active-config", async (req, reply) => {
    try {
      const res = await pool.query(`SELECT id, name, is_active, last_activated_at FROM sorter_configs WHERE is_active=true LIMIT 1`);
      if (res.rows.length === 0) return reply.code(200).send({ active: false });
      return reply.code(200).send({ active: true, config: res.rows[0] });
    } catch (err) {
      fastify.log.error("active-config API error:", err);
      return reply.code(500).send({ error: "failed to fetch active config" });
    }
  });


  /**
   * GET /api/sort/rules
   * Return a safe snapshot of currently loaded in-memory rules
   */
  fastify.get("/rules", async (req, reply) => {
    try {
      const idx = fastify.sorter && fastify.sorter._internal && fastify.sorter._internal.rulesIndexGetter
        ? fastify.sorter._internal.rulesIndexGetter()
        : {};
      // return only top-level shape to avoid huge payloads
      return reply.code(200).send({ rulesCount: Object.keys(idx).length, sample: Object.keys(idx).slice(0,50) });
    } catch (err) {
      fastify.log.error("rules API error:", err);
      return reply.code(500).send({ error: "failed to fetch rules snapshot" });
    }
  });

};
