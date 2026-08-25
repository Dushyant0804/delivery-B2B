/**
 * SORT EVENTS ROUTES
 * Table: sort_events
 *
 * GET /sort-events      → Paginated list
 * GET /sort-events/export → CSV export
 */

const fp = require("fastify-plugin");
const { Parser } = require("json2csv");

module.exports = fp(async function sortEventsRoutes(fastify, opts) {

  // ---------------------------
  // GET /sort-events (Paginated)
  // ---------------------------
  fastify.get("/sort-events", async (req, reply) => {
    let {
      page = 1,
      limit = 20,
      wbn,
      event_type,
      start,
      end,
    } = req.query;

    page = Number(page);
    limit = Number(limit);
    const offset = (page - 1) * limit;

    const params = [];
    let where = "WHERE 1=1";

    if (wbn) {
      params.push(wbn);
      where += ` AND wbn = $${params.length}`;
    }

    if (event_type) {
      params.push(event_type);
      where += ` AND event_type = $${params.length}`;
    }

    if (start) {
      params.push(start);
      where += ` AND created_at >= $${params.length}`;
    }

    if (end) {
      params.push(end);
      where += ` AND created_at <= $${params.length}`;
    }

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM sort_events
      ${where}
    `;

    const dataQuery = `
      SELECT id, wbn, job_id, event_type, details, created_at
      FROM sort_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const client = await fastify.pg.connect();

    try {
      const totalRes = await client.query(countQuery, params);
      const total = Number(totalRes.rows[0].total);

      const dataRes = await client.query(dataQuery, params);

      return reply.send({
        success: true,
        page,
        limit,
        total,
        rows: dataRes.rows,
      });
    } catch (err) {
      console.error("sort-events error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  // ---------------------------
  // GET /sort-events/export (CSV)
  // ---------------------------
  fastify.get("/sort-events/export", async (req, reply) => {
    let { wbn, event_type, start, end } = req.query;

    const params = [];
    let where = "WHERE 1=1";

    if (wbn) {
      params.push(wbn);
      where += ` AND wbn = $${params.length}`;
    }

    if (event_type) {
      params.push(event_type);
      where += ` AND event_type = $${params.length}`;
    }

    if (start) {
      params.push(start);
      where += ` AND created_at >= $${params.length}`;
    }

    if (end) {
      params.push(end);
      where += ` AND created_at <= $${params.length}`;
    }

    const query = `
      SELECT id, wbn, job_id, event_type, details, created_at
      FROM sort_events
      ${where}
      ORDER BY created_at DESC
    `;

    const client = await fastify.pg.connect();

    try {
      const res = await client.query(query, params);
      const rows = res.rows;

      // Convert JSONB "details" to string
      const csvData = rows.map((r) => ({
        ...r,
        details: JSON.stringify(r.details || {}),
      }));

      const parser = new Parser();
      const csv = parser.parse(csvData);

      reply.header("Content-Type", "text/csv");
      reply.header(
        "Content-Disposition",
        `attachment; filename="sort_events_export_${Date.now()}.csv"`
      );

      return reply.send(csv);
    } catch (err) {
      console.error("sort-events export error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  fastify.get("/sort-events/all", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const res = await client.query(`
        SELECT id, wbn, job_id, event_type, details, created_at
        FROM sort_events
        ORDER BY created_at DESC
      `);

      return reply.send({
        success: true,
        total: res.rows.length,
        rows: res.rows,
      });

    } catch (err) {
      console.error("sort-events-all error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    } finally {
      client.release();
    }
  });

  fastify.get("/sort-events/today", async (req, reply) => {
    const client = await fastify.pg.connect();
    try {
      const res = await client.query(`
      SELECT COUNT(*) AS total
      FROM sort_events
      WHERE created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata')
        AND created_at <  DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 day'
    `);

      reply.send({ total: Number(res.rows[0].total) });
    } finally {
      client.release();
    }
  });

    // -----------------------------------------
  // GET /sort-events/reject-stats (Cards + Graph)
  // -----------------------------------------
  fastify.get("/sort-events/reject-stats", async (req, reply) => {
    let { start, end } = req.query;

    const params = [];
    let where = `WHERE event_type = 'SORT_REJECT'`;

    if (start) {
      params.push(start);
      where += ` AND created_at >= $${params.length}`;
    }

    if (end) {
      params.push(end);
      where += ` AND created_at <= $${params.length}`;
    }

    const totalQuery = `
      SELECT COUNT(*) AS total
      FROM sort_events
      ${where}
    `;

    const freqQuery = `
      SELECT
        details->'result'->>'reason' AS reason,
        COUNT(*) AS count
      FROM sort_events
      ${where}
      GROUP BY reason
      ORDER BY count DESC
    `;

    const client = await fastify.pg.connect();

    try {
      const totalRes = await client.query(totalQuery, params);
      const freqRes = await client.query(freqQuery, params);

      reply.send({
        success: true,
        totalRejects: Number(totalRes.rows[0].total),
        frequency: freqRes.rows, // for bar / pie graph
      });
    } catch (err) {
      console.error("reject-stats error:", err);
      reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  // -------------------------------------------------
  // GET /sort-events/reject-stats/export (CSV Excel)
  // -------------------------------------------------
  fastify.get("/sort-events/reject-stats/export", async (req, reply) => {
    let { start, end } = req.query;

    const params = [];
    let where = `WHERE event_type = 'SORT_REJECT'`;

    if (start) {
      params.push(start);
      where += ` AND created_at >= $${params.length}`;
    }

    if (end) {
      params.push(end);
      where += ` AND created_at <= $${params.length}`;
    }

    const query = `
      SELECT
        details->'result'->>'reason' AS reason,
        COUNT(*) AS count
      FROM sort_events
      ${where}
      GROUP BY reason
      ORDER BY count DESC
    `;

    const client = await fastify.pg.connect();

    try {
      const res = await client.query(query, params);

      const parser = new Parser({ fields: ["reason", "count"] });
      const csv = parser.parse(res.rows);

      reply.header("Content-Type", "text/csv");
      reply.header(
        "Content-Disposition",
        `attachment; filename="reject_frequency_${Date.now()}.csv"`
      );

      reply.send(csv);
    } catch (err) {
      console.error("reject export error:", err);
      reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

   // -------------------------------------------------
  // GET /sort-events/reject-trend (time series graph)
  // bucket = minute | hour
  // -------------------------------------------------
  fastify.get("/sort-events/reject-trend", async (req, reply) => {
    let { start, end, bucket = "minute" } = req.query;

    const params = [];
    let where = `WHERE event_type = 'SORT_REJECT'`;

    if (start) {
      params.push(start);
      where += ` AND created_at >= $${params.length}`;
    }

    if (end) {
      params.push(end);
      where += ` AND created_at <= $${params.length}`;
    }

    const trunc =
      bucket === "hour" ? "hour" : "minute";

    const query = `
      SELECT
        DATE_TRUNC('${trunc}', created_at) AS time_bucket,
        COUNT(*) AS count
      FROM sort_events
      ${where}
      GROUP BY time_bucket
      ORDER BY time_bucket
    `;

    const client = await fastify.pg.connect();

    try {
      const res = await client.query(query, params);

      reply.send({
        success: true,
        bucket: trunc,
        rows: res.rows,
      });
    } catch (err) {
      console.error("reject-trend error:", err);
      reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  fastify.get("/sort-events/throughput", async (req, reply) => {
  let { start, end, groupBy = "bag_code" } = req.query;

  const col =
    groupBy === "ptl_id"
      ? "details->'result'->>'ptl_id'"
      : "details->'result'->>'bag_code'";

  const params = [];
  let where = "WHERE event_type = 'SORTED'";

  if (start) {
    params.push(start);
    where += ` AND created_at >= $${params.length}`;
  }
  if (end) {
    params.push(end);
    where += ` AND created_at <= $${params.length}`;
  }

  const query = `
    SELECT
      ${col} AS key,
      COUNT(*) AS count
    FROM sort_events
    ${where}
    GROUP BY key
    ORDER BY count DESC
  `;

  const client = await fastify.pg.connect();
  try {
    const res = await client.query(query, params);
    reply.send({ success: true, rows: res.rows });
  } catch (e) {
    reply.code(500).send({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

fastify.get("/sort-events/throughput/export", async (req, reply) => {
  let { start, end, groupBy = "bag_code" } = req.query;

  const col =
    groupBy === "ptl_id"
      ? "details->'result'->>'ptl_id'"
      : "details->'result'->>'bag_code'";

  const params = [];
  let where = "WHERE event_type = 'SORTED'";

  if (start) {
    params.push(start);
    where += ` AND created_at >= $${params.length}`;
  }
  if (end) {
    params.push(end);
    where += ` AND created_at <= $${params.length}`;
  }

  const query = `
    SELECT
      ${col} AS key,
      COUNT(*) AS count
    FROM sort_events
    ${where}
    GROUP BY key
    ORDER BY count DESC
  `;

  const client = await fastify.pg.connect();
  try {
    const res = await client.query(query, params);

    const { Parser } = require("json2csv");
    const parser = new Parser({ fields: ["key", "count"] });
    const csv = parser.parse(res.rows);

    reply.header("Content-Type", "text/csv");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"throughput_${groupBy}_${Date.now()}.csv\"`
    );
    reply.send(csv);
  } catch (e) {
    reply.code(500).send({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

});
