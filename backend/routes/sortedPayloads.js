// routes/sortedPayloads.js

/**
 * Sorted Parcels (Success Payloads)
 * Table: success_payloads
 * Columns: id, wbn, payload, updated_at
 */

async function sortedPayloadsRoutes(fastify, opts) {
  const pool = fastify.pg;

  /**
   * GET /sorted-payloads
   * Query params:
   *  - page (default: 1)
   *  - limit (default: 20)
   *  - wbn (optional search)
   */
  fastify.get("/sorted-payloads", async (req, reply) => {
    try {
      const {
        page = 1,
        limit = 50,
        wbn
      } = req.query;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
      const offset = (pageNum - 1) * limitNum;

      const where = [];
      const values = [];

      // WBN filter
      if (wbn) {
        values.push(`%${wbn}%`);
        where.push(`wbn ILIKE $${values.length}`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // Total count
      const countRes = await pool.query(
        `
        SELECT COUNT(*)::int AS total
        FROM success_payloads
        ${whereSql}
        `,
        values
      );

      const total = countRes.rows[0]?.total || 0;

      // Data fetch
      const rowsRes = await pool.query(
        `
        SELECT
          id,
          wbn,
          payload,
          updated_at
        FROM success_payloads
        ${whereSql}
        ORDER BY updated_at DESC, id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
        `,
        [...values, limitNum, offset]
      );

      return reply.send({
        success: true,
        page: pageNum,
        limit: limitNum,
        total,
        rows: rowsRes.rows
      });

    } catch (err) {
      fastify.log.error("GET /sorted-payloads error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    }
  });
}

module.exports = sortedPayloadsRoutes;
