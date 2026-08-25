const fp = require("fastify-plugin");
const { Parser } = require("json2csv");

async function  productionReportRoutes(fastify) {

  // =========================================================
  // ✅ GET REPORT (TABLE DATA)
  // =========================================================
  fastify.get("/production-report", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let {
        page = 1,
        limit = 100,               // 100 / 500 / 1000
        search = "",
        startTime,
        endTime
      } = req.query;

      page = parseInt(page);
      limit = parseInt(limit);
      const offset = (page - 1) * limit;

      const hasSearch = search && search.trim() !== "";
      const hasTimeFilter = startTime || endTime;

      // ❌ both search and filter not allowed
      if (hasSearch && hasTimeFilter) {
        return reply.code(400).send({
          error: true,
          message: "Please reset data first"
        });
      }

      let where = [];
      let params = [];
      let idx = 1;

      // -----------------------------
      // SEARCH
      // -----------------------------
      if (hasSearch) {
        where.push(`
          (
            wbn ILIKE $${idx}
            OR tracking_id::text ILIKE $${idx}
            OR bag_code ILIKE $${idx}
            OR rejection_type ILIKE $${idx}
          )
        `);
        params.push(`%${search}%`);
        idx++;
      }

      // -----------------------------
      // DATE FILTER
      // -----------------------------
      if (startTime && endTime) {
        where.push(`created_at BETWEEN $${idx} AND $${idx + 1}`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`created_at >= $${idx}`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`created_at <= $${idx}`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // -----------------------------
      // TOTAL COUNT
      // -----------------------------
      const countSql = `
        SELECT COUNT(*) 
        FROM sorter_audit_log
        ${whereSql}
      `;

      const countRes = await client.query(countSql, params);
      const total = parseInt(countRes.rows[0].count);

      // -----------------------------
      // PAGE DATA
      // -----------------------------
      const dataSql = `
        SELECT
          id,
          wbn,
          tracking_id,
          bag_code,
          ptl_id,
          primary_status,
          primary_payload,
          primary_response,
          secondary_status,
          secondary_payload,
          secondary_response,
          image_status,
          rejection_type,
          sorter_location,
          sorter_id,
          s3_path,
          created_at
        FROM sorter_audit_log
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;

      const dataParams = [...params, limit, offset];

      const dataRes = await client.query(dataSql, dataParams);

      reply.send({
        total,
        page,
        limit,
        rows: dataRes.rows
      });

    } catch (err) {
      console.error("❌ production-report error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });


  // =========================================================
  // ✅ EXPORT REPORT (CSV)
  // =========================================================
  fastify.get("/production-report/export", async (req, reply) => {
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

      // SEARCH
      if (hasSearch) {
        where.push(`
          (
            wbn ILIKE $${idx}
            OR tracking_id::text ILIKE $${idx}
            OR bag_code ILIKE $${idx}
            OR rejection_type ILIKE $${idx}
          )
        `);
        params.push(`%${search}%`);
        idx++;
      }

      // DATE FILTER
      if (startTime && endTime) {
        where.push(`created_at BETWEEN $${idx} AND $${idx + 1}`);
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`created_at >= $${idx}`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`created_at <= $${idx}`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // ONLY NON-JSON COLUMNS
      const sql = `
        SELECT
          id,
          wbn,
          tracking_id,
          bag_code,
          ptl_id,
          primary_status,
          secondary_status,
          image_status,
          rejection_type,
          sorter_location,
          sorter_id,
          s3_path,
          created_at
        FROM sorter_audit_log
        ${whereSql}
        ORDER BY created_at DESC
      `;

      const res = await client.query(sql, params);

      const fields = [
        "id",
        "wbn",
        "tracking_id",
        "bag_code",
        "ptl_id",
        "primary_status",
        "secondary_status",
        "image_status",
        "rejection_type",
        "sorter_location",
        "sorter_id",
        "s3_path",
        "created_at"
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=production_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = productionReportRoutes;
