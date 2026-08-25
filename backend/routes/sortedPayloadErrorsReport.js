// routes/sortedPayloadErrorsReport.js
const { Parser } = require("json2csv");

async function sortedPayloadErrorsReportRoutes(fastify) {

  // =========================================================
  // ✅ GET SORTED PAYLOAD ERRORS (TABLE DATA)
  // =========================================================
  fastify.get("/sorted-payload-errors-report", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let { page = 1, limit = 100, search = "", error_search = "", startTime, endTime } = req.query;

      page = parseInt(page);
      limit = parseInt(limit);
      const offset = (page - 1) * limit;

      const hasSearch = search && search.trim() !== "";
      const hasTimeFilter = startTime || endTime;

      // ❌ Both search + date filter not allowed (same rule as every
      // other report route)
      if (hasSearch && hasTimeFilter) {
        return reply.code(400).send({
          error: true,
          message: "Please reset data first"
        });
      }

      let where = [];
      let params = [];
      let idx = 1;

      // ---------------- SEARCH (WBN — nullable here, since a
      // sufficiently malformed payload might not even have one)
      if (hasSearch) {
        where.push(`wbn ILIKE $${idx}`);
        params.push(`%${search}%`);
        idx++;
      }

      // ---------------- ERROR MESSAGE FILTER — independent of the
      // wbn/date mutual exclusivity above, since it's a different axis
      // (e.g. "find every row about pin" regardless of when or which wbn)
      if (error_search && error_search.trim() !== "") {
        where.push(`error ILIKE $${idx}`);
        params.push(`%${error_search.trim()}%`);
        idx++;
      }

      // ---------------- DATE FILTER (on created_at — this table is
      // append-only, one row per failed attempt, so created_at is the
      // right axis, unlike sorted_payloads' updated_at)
      if (startTime && endTime) {
        where.push(`created_at BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`created_at >= $${idx}::timestamptz`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`created_at <= $${idx}::timestamptz`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // ---------------- TOTAL COUNT
      const countRes = await client.query(
        `SELECT COUNT(*) FROM sorted_payload_errors ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      // ---------------- PAGE DATA
      const dataSql = `
        SELECT
          id,
          wbn,
          payload,
          error,
          created_at
        FROM sorted_payload_errors
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;

      const dataRes = await client.query(dataSql, [...params, limit, offset]);

      reply.send({
        total,
        page,
        limit,
        rows: dataRes.rows
      });

    } catch (err) {
      console.error("❌ sorted-payload-errors-report route error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });


  // =========================================================
  // ✅ EXPORT SORTED PAYLOAD ERRORS (CSV)
  // =========================================================
  fastify.get("/sorted-payload-errors-report/export", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let { search = "", error_search = "", startTime, endTime } = req.query;

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
        where.push(`wbn ILIKE $${idx}`);
        params.push(`%${search}%`);
        idx++;
      }

      if (error_search && error_search.trim() !== "") {
        where.push(`error ILIKE $${idx}`);
        params.push(`%${error_search.trim()}%`);
        idx++;
      }

      if (startTime && endTime) {
        where.push(`created_at BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`created_at >= $${idx}::timestamptz`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`created_at <= $${idx}::timestamptz`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          id,
          wbn,
          error,
          payload::text AS payload_json,
          created_at AS created_at_utc,
          TO_CHAR(
            created_at AT TIME ZONE 'Asia/Kolkata',
            'DD-MM-YYYY HH24:MI:SS'
          ) AS created_at_ist
        FROM sorted_payload_errors
        ${whereSql}
        ORDER BY created_at DESC
      `;

      const res = await client.query(sql, params);

      const fields = ["id", "wbn", "error", "payload_json", "created_at_utc", "created_at_ist"];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=sorted_payload_errors_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ sorted-payload-errors-report export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = sortedPayloadErrorsReportRoutes;