const { Pool } = require("pg");
const { Parser } = require("json2csv");

const pool = new Pool({
  connectionString: process.env.PG_URI,
});

async function bagsealEventsRoutes(fastify, opts) {

  // ======================================================
  // GET BAGSEAL EVENTS (SEARCH / FILTER / PAGINATION)
  // ======================================================
  fastify.get("/bagseal/events", async (req, reply) => {
    try {
      const {
        page = 1,
        limit = 100,
        search,
        startTime,
        endTime,
      } = req.query;

      const offset = (page - 1) * limit;

      const hasSearch = !!search;
      const hasDate = !!startTime || !!endTime;

      if (hasSearch && hasDate) {
        return reply.code(400).send({
          error: true,
          message: "Please reset data first"
        });
      }

      let where = [];
      let values = [];
      let idx = 1;

      // ---- SEARCH
      if (hasSearch) {
        where.push(`
          (
            bag_code ILIKE $${idx} OR
            seal_number ILIKE $${idx} OR
            operator_user ILIKE $${idx} OR
            destination ILIKE $${idx}
          )
        `);
        values.push(`%${search}%`);
        idx++;
      }

      // ---- DATE FILTER (sealed_at)
      if (hasDate) {
        if (startTime && endTime) {
          where.push(`sealed_at BETWEEN $${idx} AND $${idx + 1}`);
          values.push(startTime, endTime);
          idx += 2;
        } else if (startTime) {
          where.push(`sealed_at >= $${idx}`);
          values.push(startTime);
          idx++;
        } else if (endTime) {
          where.push(`sealed_at <= $${idx}`);
          values.push(endTime);
          idx++;
        }
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // ---- COUNT
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM bagseal_events ${whereSql}`,
        values
      );

      const total = Number(countRes.rows[0].count);

      // ---- DATA
      const dataQuery = `
        SELECT
          id,
          bag_code,
          seal_number,
          wbns,
          destination,
          operator_user,
          first_drop_at,
          sealed_at,
          success,
          request_payload,
          response_payload
        FROM bagseal_events
        ${whereSql}
        ORDER BY sealed_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;

      const dataRes = await pool.query(dataQuery, [...values, limit, offset]);

      reply.send({
        page: Number(page),
        limit: Number(limit),
        total,
        rows: dataRes.rows
      });

    } catch (err) {
      console.error("❌ bagseal events fetch error:", err);
      reply.code(500).send({ error: true, message: "Failed to fetch bagseal events" });
    }
  });


  // ======================================================
  // EXPORT CSV
  // ======================================================
  fastify.get("/bagseal/events/export", async (req, reply) => {
    const client = await pool.connect();

    try {
      let { search = "", startTime, endTime } = req.query;

      const hasSearch = search && search.trim() !== "";
      const hasTimeFilter = startTime || endTime;

      if (hasSearch && hasTimeFilter) {
        return reply.code(400).send({
          error: true,
          message: "Please reset data first"
        });
      }

      let where = [];
      let params = [];
      let idx = 1;

      if (hasSearch) {
        where.push(`
          (
            bag_code ILIKE $${idx} OR
            seal_number ILIKE $${idx} OR
            operator_user ILIKE $${idx} OR
            destination ILIKE $${idx}
          )
        `);
        params.push(`%${search}%`);
        idx++;
      }

      if (startTime && endTime) {
        where.push(`sealed_at BETWEEN $${idx} AND $${idx + 1}`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`sealed_at >= $${idx}`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`sealed_at <= $${idx}`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          bag_code,
          seal_number,
          destination,
          operator_user,
          first_drop_at,
          sealed_at,
          success
        FROM bagseal_events
        ${whereSql}
        ORDER BY sealed_at DESC
      `;

      const res = await client.query(sql, params);

      const fields = [
        "bag_code",
        "seal_number",
        "destination",
        "operator_user",
        "first_drop_at",
        "sealed_at",
        "success"
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=bagseal_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ bagseal export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = bagsealEventsRoutes;
