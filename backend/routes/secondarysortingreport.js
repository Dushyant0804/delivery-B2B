const { Parser } = require("json2csv");

async function secondarySortingReportRoutes(fastify) {

  // =========================================================
  // ✅ GET SECONDARY SORTING SESSIONS (TABLE DATA)
  // =========================================================
  fastify.get("/secondary-sorting-sessions", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let {
        page = 1,
        limit = 100,
        search = "",
        username,
        bay_id,
        status, // "open" | "sealed"
        startTime,
        endTime
      } = req.query;

      page = parseInt(page);
      limit = parseInt(limit);
      const offset = (page - 1) * limit;

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

      // ---------------- SEARCH — virtualbagseal, originalbagseal, or
      // an exact wbn match (which secondary bag did this parcel end up in)
      if (hasSearch) {
        where.push(
          `(virtualbagseal ILIKE $${idx} OR originalbagseal ILIKE $${idx} OR $${idx + 1} = ANY(wbns))`
        );
        params.push(`%${search}%`, search.trim());
        idx += 2;
      }

      // ---------------- FIELD FILTERS
      if (username && username.trim() !== "") {
        where.push(`username = $${idx}`);
        params.push(username.trim());
        idx++;
      }

      if (bay_id && bay_id.trim() !== "") {
        where.push(`bay_id = $${idx}`);
        params.push(bay_id.trim());
        idx++;
      }

      if (status === "open") {
        where.push(`sealed_at IS NULL`);
      } else if (status === "sealed") {
        where.push(`sealed_at IS NOT NULL`);
      }

      // ---------------- DATE FILTER (on created_at — when the
      // session/bay selection started)
      if (startTime && endTime) {
        where.push(
          `created_at BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`
        );
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

      const countRes = await client.query(
        `SELECT COUNT(*) FROM secondary_sorting_sessions ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      const dataSql = `
        SELECT
          id,
          username,
          bay_id,
          virtualbagseal,
          originalbagseal,
          wbns,
          count,
          firstscan,
          sealed_at,
          created_at
        FROM secondary_sorting_sessions
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
      console.error("❌ secondary-sorting-sessions route error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });


  // =========================================================
  // ✅ EXPORT SECONDARY SORTING SESSIONS (CSV)
  // =========================================================
  fastify.get("/secondary-sorting-sessions/export", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let { search = "", username, bay_id, status, startTime, endTime } = req.query;

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
        where.push(
          `(virtualbagseal ILIKE $${idx} OR originalbagseal ILIKE $${idx} OR $${idx + 1} = ANY(wbns))`
        );
        params.push(`%${search}%`, search.trim());
        idx += 2;
      }

      if (username && username.trim() !== "") {
        where.push(`username = $${idx}`);
        params.push(username.trim());
        idx++;
      }

      if (bay_id && bay_id.trim() !== "") {
        where.push(`bay_id = $${idx}`);
        params.push(bay_id.trim());
        idx++;
      }

      if (status === "open") {
        where.push(`sealed_at IS NULL`);
      } else if (status === "sealed") {
        where.push(`sealed_at IS NOT NULL`);
      }

      if (startTime && endTime) {
        where.push(
          `created_at BETWEEN $${idx}::timestamptz AND $${idx + 1}::timestamptz`
        );
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
          username,
          bay_id,
          virtualbagseal,
          originalbagseal,
          array_to_string(wbns, ', ') AS wbns,
          count,
          firstscan AS firstscan_utc,
          TO_CHAR(firstscan AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI:SS') AS firstscan_ist,
          sealed_at AS sealed_at_utc,
          TO_CHAR(sealed_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI:SS') AS sealed_at_ist,
          created_at AS created_at_utc,
          TO_CHAR(created_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI:SS') AS created_at_ist
        FROM secondary_sorting_sessions
        ${whereSql}
        ORDER BY created_at DESC
      `;

      const res = await client.query(sql, params);

      const fields = [
        "id",
        "username",
        "bay_id",
        "virtualbagseal",
        "originalbagseal",
        "wbns",
        "count",
        "firstscan_utc",
        "firstscan_ist",
        "sealed_at_utc",
        "sealed_at_ist",
        "created_at_utc",
        "created_at_ist"
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=secondary_sorting_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ secondary-sorting-sessions export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = secondarySortingReportRoutes;