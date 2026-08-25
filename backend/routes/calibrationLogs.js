const { Pool } = require("pg");
const { Parser } = require("json2csv");

const pool = new Pool({
  connectionString: process.env.PG_URI,
});

async function calibrationLogsRoutes(fastify, opts) {

  // ======================================================
  // GET CALIBRATION LOGS (SEARCH / FILTER / PAGINATION)
  // ======================================================
  fastify.get("/calibration/logs", async (req, reply) => {
    try {
      const {
        page = 1,
        limit = 100,

        search,           // wbn
        startTime,
        endTime,
      } = req.query;

      const offset = (page - 1) * limit;

      const hasSearch = !!search;
      const hasDate = !!startTime || !!endTime;

      if (hasSearch && hasDate) {
        return reply.code(400).send({
          error: "Please reset data first. Use either search or date filter."
        });
      }

      let where = "WHERE 1=1";
      const values = [];
      let idx = 1;

      // ---- SEARCH (WBN)
      if (hasSearch) {
        where += ` AND wbn ILIKE $${idx++}`;
        values.push(`%${search}%`);
      }

      // ---- DATE FILTER
      if (hasDate) {
        if (startTime && endTime) {
          where += ` AND created_at BETWEEN $${idx++} AND $${idx++}`;
          values.push(startTime, endTime);
        } else if (startTime) {
          where += ` AND created_at >= $${idx++}`;
          values.push(startTime);
        } else if (endTime) {
          where += ` AND created_at <= $${idx++}`;
          values.push(endTime);
        }
      }

      // ---- TOTAL COUNT
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM calibration_logs ${where}`,
        values
      );

      const total = Number(countRes.rows[0].count);

      // ---- DATA
      const dataQuery = `
        SELECT
          id, wbn,
          length_mm, width_mm, height_mm, weight_g, real_volume, volume,
          calibrate_length_mm, calibrate_width_mm, calibrate_height_mm,
          calibrate_weight_g, calibrate_real_volume,
          weight_tolerance, real_volume_tolerance,
          length_status, width_status, height_status, weight_status, real_volume_status,
          final_result,
          length_variance, width_variance, height_variance, weight_variance, real_volume_variance,
          dimension_tolerance, feedlane,
          created_at
        FROM calibration_logs
        ${where}
        ORDER BY id DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `;

      const dataRes = await pool.query(dataQuery, [...values, limit, offset]);

      reply.send({
        page: Number(page),
        limit: Number(limit),
        total,
        rows: dataRes.rows
      });

    } catch (err) {
      console.error("❌ Calibration logs fetch error:", err);
      reply.code(500).send({ error: "Failed to fetch calibration logs" });
    }
  });


  // ======================================================
  // EXPORT CSV
  // ======================================================


fastify.get("/calibration/logs/export", async (req, reply) => {
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
      where.push(`wbn ILIKE $${idx}`);
      params.push(`%${search}%`);
      idx++;
    }

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

    const sql = `
      SELECT
        wbn,
        feedlane,
        length_mm,
        width_mm,
        height_mm,
        weight_g,
        real_volume,
        volume,
        calibrate_length_mm,
        calibrate_width_mm,
        calibrate_height_mm,
        calibrate_weight_g,
        calibrate_real_volume,
        weight_tolerance,
        real_volume_tolerance,
        length_status,
        width_status,
        height_status,
        weight_status,
        real_volume_status,
        final_result,
        length_variance,
        width_variance,
        height_variance,
        weight_variance,
        real_volume_variance,
        dimension_tolerance,
        created_at
      FROM calibration_logs
      ${whereSql}
      ORDER BY created_at DESC
    `;

    const res = await client.query(sql, params);

    const fields = [
      "wbn",
      "feedlane",
      "length_mm",
      "width_mm",
      "height_mm",
      "weight_g",
      "real_volume",
      "volume",
      "calibrate_length_mm",
      "calibrate_width_mm",
      "calibrate_height_mm",
      "calibrate_weight_g",
      "calibrate_real_volume",
      "weight_tolerance",
      "real_volume_tolerance",
      "length_status",
      "width_status",
      "height_status",
      "weight_status",
      "real_volume_status",
      "final_result",
      "length_variance",
      "width_variance",
      "height_variance",
      "weight_variance",
      "real_volume_variance",
      "dimension_tolerance",
      "created_at"
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(res.rows);

    reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", "attachment; filename=calibration_report.csv")
      .send(csv);

  } catch (err) {
    console.error("❌ calibration export error:", err);
    reply.code(500).send({ error: true, message: err.message });
  } finally {
    client.release();
  }
});


}

module.exports = calibrationLogsRoutes;
