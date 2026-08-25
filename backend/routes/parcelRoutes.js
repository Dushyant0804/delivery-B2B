const { Parser } = require("json2csv");

async function parcelRoutes(fastify) {

  // =========================================================
  // ✅ GET PARCELS (TABLE DATA)
  // =========================================================
  fastify.get("/parcels", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let {
        page = 1,
        limit = 100,
        search = "",
        mode,
        sort,
        reason,
        infeed,
        ptl_id,
        bay_id,
        startTime,
        endTime
      } = req.query;

      page = parseInt(page);
      limit = parseInt(limit);
      const offset = (page - 1) * limit;

      const hasSearch = search && search.trim() !== "";
      const hasTimeFilter = startTime || endTime;

      // ❌ Both search + filter not allowed
      if (hasSearch && hasTimeFilter) {
        return reply.code(400).send({
          error: true,
          message: "Please reset data first"
        });
      }

      let where = [];
      let params = [];
      let idx = 1;

      // ---------------- SEARCH (WBN or scanned_wbn — final wbn
      // can differ from the raw scan after regex resolution)
      if (hasSearch) {
        where.push(`(wbn ILIKE $${idx} OR scanned_wbn ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      // ---------------- MODE FILTER — case-insensitive, since the DB
      // stores 'HHD' uppercase but the UI's option list is lowercase
      if (mode && mode.trim() !== "") {
        where.push(`LOWER(mode) = LOWER($${idx})`);
        params.push(mode.trim());
        idx++;
      }

      // ---------------- STATUS FILTER (sort column: SORTED / INDUCTED / REJECTED)
      if (sort && sort.trim() !== "") {
        where.push(`sort = $${idx}`);
        params.push(sort.trim().toUpperCase());
        idx++;
      }

      // ---------------- REASON FILTER
      if (reason && reason.trim() !== "") {
        where.push(`LOWER(reason) = LOWER($${idx})`);
        params.push(reason.trim());
        idx++;
      }

      // ---------------- INFEED FILTER
      if (infeed && infeed.trim() !== "") {
        where.push(`infeed = $${idx}`);
        params.push(infeed.trim());
        idx++;
      }

      // ---------------- PTL ID / BAY ID — partial match, since operators
      // often want "anything containing these digits"
      if (ptl_id && ptl_id.trim() !== "") {
        where.push(`ptl_id ILIKE $${idx}`);
        params.push(`%${ptl_id.trim()}%`);
        idx++;
      }

      if (bay_id && bay_id.trim() !== "") {
        where.push(`bay_id ILIKE $${idx}`);
        params.push(`%${bay_id.trim()}%`);
        idx++;
      }

      // ---------------- DATE FILTER (FIXED)
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

      // ---------------- TOTAL COUNT
      const countSql = `
        SELECT COUNT(*)
        FROM primary_bin_data
        ${whereSql}
      `;

      const countRes = await client.query(countSql, params);
      const total = parseInt(countRes.rows[0].count);

      // ---------------- PAGE DATA
      const dataSql = `
        SELECT
          id,
          wbn,
          scanned_wbn,
          tracking_id,
          infeed,
          length,
          width,
          height,
          weight,
          volume,
          real_volume,
          imagepath,
          mode,
          expected_bag,
          sort,
          reason,
          final_bag,
          ptl_id,
          bay_id,
          scantime,
          sorttime,
          secondary_scantime,
          created_at
        FROM primary_bin_data
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
      console.error("❌ parcels route error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });


  // =========================================================
  // ✅ EXPORT PARCELS (CSV) — same filters as the list, but
  // unpaginated: every matching row goes into the report.
  // =========================================================
  fastify.get("/parcels/export", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      let { search = "", mode, sort, reason, infeed, ptl_id, bay_id, startTime, endTime } = req.query;

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
        where.push(`(wbn ILIKE $${idx} OR scanned_wbn ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      if (mode && mode.trim() !== "") {
        where.push(`LOWER(mode) = LOWER($${idx})`);
        params.push(mode.trim());
        idx++;
      }

      if (sort && sort.trim() !== "") {
        where.push(`sort = $${idx}`);
        params.push(sort.trim().toUpperCase());
        idx++;
      }

      if (reason && reason.trim() !== "") {
        where.push(`LOWER(reason) = LOWER($${idx})`);
        params.push(reason.trim());
        idx++;
      }

      if (infeed && infeed.trim() !== "") {
        where.push(`infeed = $${idx}`);
        params.push(infeed.trim());
        idx++;
      }

      if (ptl_id && ptl_id.trim() !== "") {
        where.push(`ptl_id ILIKE $${idx}`);
        params.push(`%${ptl_id.trim()}%`);
        idx++;
      }

      if (bay_id && bay_id.trim() !== "") {
        where.push(`bay_id ILIKE $${idx}`);
        params.push(`%${bay_id.trim()}%`);
        idx++;
      }

      // -------- DATE FILTER (FIXED)
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
    wbn,
    scanned_wbn,
    tracking_id,
    infeed,
    length,
    width,
    height,
    weight,
    volume,
    real_volume,
    mode,
    expected_bag,
    sort,
    reason,
    final_bag,
    ptl_id,
    bay_id,
    scantime,
    sorttime,
    secondary_scantime,
    created_at AS created_at_utc,
    TO_CHAR(
      created_at AT TIME ZONE 'Asia/Kolkata',
      'DD-MM-YYYY HH24:MI:SS'
    ) AS created_at_ist
  FROM primary_bin_data
  ${whereSql}
  ORDER BY created_at DESC
`;
      const res = await client.query(sql, params);

      const fields = [
        "id",
        "wbn",
        "scanned_wbn",
        "tracking_id",
        "infeed",
        "length",
        "width",
        "height",
        "weight",
        "volume",
        "real_volume",
        "mode",
        "expected_bag",
        "sort",
        "reason",
        "final_bag",
        "ptl_id",
        "bay_id",
        "scantime",
        "sorttime",
        "secondary_scantime",
        "created_at_utc",
        "created_at_ist"
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(res.rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=parcels_report.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ parcels export error:", err);
      reply.code(500).send({ error: true, message: err.message });
    } finally {
      client.release();
    }
  });

}

module.exports = parcelRoutes;