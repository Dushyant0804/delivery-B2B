const { Parser } = require("json2csv");

async function primarySortingReportRoutes(fastify) {

  // =========================================================
  // ✅ GET PRIMARY SORTING LOG (TABLE DATA)
  // =========================================================
  fastify.get("/primary-sorting", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let {
        page = 1,
        limit = 100,
        search = "",
        username,
        bag_code,
        bay_id,
        reason,
        startTime,
        endTime
      } = req.query;

      page = parseInt(page);
      limit = parseInt(limit);
      const offset = (page - 1) * limit;

      const hasSearch = search && search.trim() !== "";
      const hasTimeFilter = startTime || endTime;

      // ❌ Both search + filter not allowed (same rule as /parcels)
      if (hasSearch && hasTimeFilter) {
        return reply.code(400).send({
          error: true,
          message: "Please reset data first"
        });
      }

      let where = [];
      let params = [];
      let idx = 1;

      // ---------------- SEARCH (WBN or username)
      if (hasSearch) {
        where.push(`(wbn ILIKE $${idx} OR username ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      // ---------------- FIELD FILTERS
      if (username && username.trim() !== "") {
        where.push(`username = $${idx}`);
        params.push(username.trim());
        idx++;
      }

      if (bag_code && bag_code.trim() !== "") {
        where.push(`bag_code = $${idx}`);
        params.push(bag_code.trim().toUpperCase());
        idx++;
      }

      if (bay_id && bay_id.trim() !== "") {
        where.push(`bay_id = $${idx}`);
        params.push(bay_id.trim());
        idx++;
      }

      if (reason && reason.trim() !== "") {
        where.push(`LOWER(reason) = LOWER($${idx})`);
        params.push(reason.trim());
        idx++;
      }

      // ---------------- DATE FILTER (on primary_scantime)
      if (startTime && endTime) {
        where.push(
          `primary_scantime BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`
        );
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`primary_scantime >= $${idx}::timestamptz`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`primary_scantime <= $${idx}::timestamptz`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // ---------------- TOTAL COUNT
      const countRes = await client.query(
        `SELECT COUNT(*) FROM primary_sorting ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      // ---------------- PAGE DATA
      const dataSql = `
        SELECT
          id,
          username,
          wbn,
          bag_code,
          bay_id,
          reason,
          primary_scantime
        FROM primary_sorting
        ${whereSql}
        ORDER BY primary_scantime DESC
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
      console.error("❌ primary-sorting route error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });


  // =========================================================
  // ✅ EXPORT PRIMARY SORTING LOG (CSV)
  // =========================================================
  fastify.get("/primary-sorting/export", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let { search = "", username, bag_code, bay_id, reason, startTime, endTime } = req.query;

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
        where.push(`(wbn ILIKE $${idx} OR username ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      if (username && username.trim() !== "") {
        where.push(`username = $${idx}`);
        params.push(username.trim());
        idx++;
      }

      if (bag_code && bag_code.trim() !== "") {
        where.push(`bag_code = $${idx}`);
        params.push(bag_code.trim().toUpperCase());
        idx++;
      }

      if (bay_id && bay_id.trim() !== "") {
        where.push(`bay_id = $${idx}`);
        params.push(bay_id.trim());
        idx++;
      }

      if (reason && reason.trim() !== "") {
        where.push(`LOWER(reason) = LOWER($${idx})`);
        params.push(reason.trim());
        idx++;
      }

      if (startTime && endTime) {
        where.push(
          `primary_scantime BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`
        );
        params.push(startTime, endTime);
        idx += 2;
      } else if (startTime) {
        where.push(`primary_scantime >= $${idx}::timestamptz`);
        params.push(startTime);
        idx++;
      } else if (endTime) {
        where.push(`primary_scantime <= $${idx}::timestamptz`);
        params.push(endTime);
        idx++;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          id,
          username,
          wbn,
          bag_code,
          bay_id,
          reason,
          primary_scantime AS primary_scantime_utc,
          TO_CHAR(
            primary_scantime AT TIME ZONE 'Asia/Kolkata',
            'DD-MM-YYYY HH24:MI:SS'
          ) AS primary_scantime_ist
        FROM primary_sorting
        ${whereSql}
        ORDER BY primary_scantime DESC
      `;

      const res = await client.query(sql, params);

      const fields = [
        "id",
        "username",
        "wbn",
        "bag_code",
        "bay_id",
        "reason",
        "primary_scantime_utc",
        "primary_scantime_ist"
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=primary_sorting_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ primary-sorting export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = primarySortingReportRoutes;