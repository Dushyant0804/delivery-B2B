// routes/bags.js
const fp = require("fastify-plugin");

function isValidBagCode(code) {
  return /^D\d{3}$/.test(code);
}

function parseCutoffTimes(raw) {
  // Accept "0000;2030" or ["00:00","20:30"]
  if (!raw) return { raw: null, arr: null };

  if (Array.isArray(raw)) {
    return { raw: raw.join(";"), arr: raw };
  }

  if (typeof raw === "string") {
    const arr = raw
      .split(";")
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => `${t.slice(0, 2)}:${t.slice(2, 4)}`);

    return { raw, arr };
  }

  return { raw: null, arr: null };
}

async function bagsRoutes(fastify) {
  const pool = fastify.pg;

  // --------------------------------------------------
  // GET all bags (optional config_id)
  // --------------------------------------------------
  fastify.get("/bags", async (req, reply) => {
    const { config_id } = req.query;

    const q = `
      SELECT id, config_id, bag_code, priority, volume,
             cutoff_times_raw, cutoff_times
      FROM bags
      ${config_id ? "WHERE config_id = $1" : ""}
      ORDER BY bag_code ASC
    `;

    const res = await pool.query(q, config_id ? [config_id] : []);
    return reply.send({ success: true, rows: res.rows });
  });

  // --------------------------------------------------
  // GET single bag by ID
  // --------------------------------------------------
  fastify.get("/bags/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) {
      return reply.code(400).send({ success: false, error: "Invalid bag id" });
    }

    const res = await pool.query(
      `SELECT * FROM bags WHERE id=$1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.code(404).send({ success: false, error: "Bag not found" });
    }

    return reply.send({ success: true, bag: res.rows[0] });
  });

  // --------------------------------------------------
  // POST create bag
  // --------------------------------------------------
  fastify.post("/bags", async (req, reply) => {
    const {
      config_id,
      bag_code,
      priority,
      volume,
      cutoff_times,
    } = req.body || {};

    if (!config_id) {
      return reply.code(400).send({ success: false, error: "config_id is required" });
    }

    if (!bag_code || !isValidBagCode(bag_code)) {
      return reply.code(400).send({
        success: false,
        error: "Invalid bag_code. Expected D001..D999",
      });
    }

    const { raw, arr } = parseCutoffTimes(cutoff_times);

    try {
      const res = await pool.query(
        `
        INSERT INTO bags
          (config_id, bag_code, priority, volume, cutoff_times_raw, cutoff_times)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [
          config_id,
          bag_code.toUpperCase(),
          priority || null,
          volume || null,
          raw,
          arr,
        ]
      );

      return reply.code(201).send({ success: true, bag: res.rows[0] });
    } catch (err) {
      fastify.log.error("POST /bags error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  // --------------------------------------------------
  // PUT update bag
  // --------------------------------------------------
  fastify.put("/bags/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) {
      return reply.code(400).send({ success: false, error: "Invalid bag id" });
    }

    const {
      priority,
      volume,
      cutoff_times,
    } = req.body || {};

    const { raw, arr } = parseCutoffTimes(cutoff_times);

    try {
      const res = await pool.query(
        `
        UPDATE bags
        SET
          priority = $1,
          volume = $2,
          cutoff_times_raw = $3,
          cutoff_times = $4
        WHERE id = $5
        RETURNING *
        `,
        [
          priority || null,
          volume || null,
          raw,
          arr,
          id,
        ]
      );

      if (res.rows.length === 0) {
        return reply.code(404).send({ success: false, error: "Bag not found" });
      }

      return reply.send({ success: true, bag: res.rows[0] });
    } catch (err) {
      fastify.log.error("PUT /bags error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  // --------------------------------------------------
  // DELETE bag
  // --------------------------------------------------
  fastify.delete("/bags/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) {
      return reply.code(400).send({ success: false, error: "Invalid bag id" });
    }

    try {
      const res = await pool.query(
        `DELETE FROM bags WHERE id=$1`,
        [id]
      );

      if (res.rowCount === 0) {
        return reply.code(404).send({ success: false, error: "Bag not found" });
      }

      return reply.send({ success: true });
    } catch (err) {
      fastify.log.error("DELETE /bags error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });
};

module.exports = bagsRoutes;
