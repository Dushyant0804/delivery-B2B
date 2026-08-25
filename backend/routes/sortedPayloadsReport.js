// routes/sortedPayloadsReport.js
const { Parser } = require("json2csv");

async function sortedPayloadsReportRoutes(fastify) {

  // =========================================================
  // ✅ GET SORTED PAYLOADS (TABLE DATA)
  // =========================================================
  fastify.get("/sorted-payloads-report", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let { page = 1, limit = 100, search = "", startTime, endTime } = req.query;

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

      // ---------------- SEARCH (WBN only — this table has one row
      // per wbn, so there's no scanned_wbn/expected-vs-final distinction
      // to search across like the other reports)
      if (hasSearch) {
        where.push(`wbn ILIKE $${idx}`);
        params.push(`%${search}%`);
        idx++;
      }

      // ---------------- DATE FILTER (on updated_at — this table has
      // no created_at; a row's "time" is whenever it was last upserted)
      if (startTime && endTime) {
        where.push(`updated_at BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`updated_at >= $${idx}::timestamptz`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`updated_at <= $${idx}::timestamptz`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // ---------------- TOTAL COUNT
      const countRes = await client.query(
        `SELECT COUNT(*) FROM sorted_payloads ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      // ---------------- PAGE DATA — a handful of glance-able fields
      // pulled out of the jsonb payload, plus the full payload itself
      // for the "View Payload" modal on the frontend.
      const dataSql = `
        SELECT
          id,
          wbn,
          payload,
          payload->>'chute_id' AS chute_id,
          payload->>'city'     AS city,
          payload->>'zn'       AS zone,
          payload->>'mot'      AS mot,
          payload->>'pdt'      AS pdt,
          payload->>'cn'       AS client_name,
          updated_at
        FROM sorted_payloads
        ${whereSql}
        ORDER BY updated_at DESC
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
      console.error("❌ sorted-payloads-report route error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });


  // =========================================================
  // ✅ EXPORT SORTED PAYLOADS (CSV)
  // =========================================================
  fastify.get("/sorted-payloads-report/export", async (req, reply) => {
    const client = await fastify.pg.connect();

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
        where.push(`wbn ILIKE $${idx}`);
        params.push(`%${search}%`);
        idx++;
      }

      if (startTime && endTime) {
        where.push(`updated_at BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`updated_at >= $${idx}::timestamptz`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`updated_at <= $${idx}::timestamptz`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          id,
          wbn,
          payload->>'chute_id' AS chute_id,
          payload->>'city'     AS city,
          payload->>'zn'       AS zone,
          payload->>'mot'      AS mot,
          payload->>'pdt'      AS pdt,
          payload->>'cn'       AS client_name,
          payload::text        AS payload_json,
          updated_at AS updated_at_utc,
          TO_CHAR(
            updated_at AT TIME ZONE 'Asia/Kolkata',
            'DD-MM-YYYY HH24:MI:SS'
          ) AS updated_at_ist
        FROM sorted_payloads
        ${whereSql}
        ORDER BY updated_at DESC
      `;

      const res = await client.query(sql, params);

      const fields = [
        "id", "wbn", "chute_id", "city", "zone", "mot", "pdt", "client_name",
        "payload_json", "updated_at_utc", "updated_at_ist"
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=sorted_payloads_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ sorted-payloads-report export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = sortedPayloadsReportRoutes;