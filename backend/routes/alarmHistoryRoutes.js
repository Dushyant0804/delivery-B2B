// routes/alarmHistoryRoutes.js

async function alarmHistoryRoutes(fastify, options) {

  // ======================================================
  // 1️⃣ GET Alarm History (Pagination + Date Filter)
  // ======================================================
  fastify.get("/alarm-history", async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 20,
        startDate,
        endDate,
      } = request.query;

      const offset = (page - 1) * limit;

      let whereClause = "";
      let values = [];
      let paramIndex = 1;

      // Date Filter
      if (startDate && endDate) {
        whereClause = `WHERE arrived_at BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        values.push(startDate, endDate);
        paramIndex += 2;
      }

      // Total count
      const countQuery = `
        SELECT COUNT(*) 
        FROM alarm_history
        ${whereClause}
      `;

      const countResult = await fastify.pg.query(countQuery, values);
      const totalRecords = parseInt(countResult.rows[0].count);

      // Data Query
      const dataQuery = `
        SELECT 
          id,
          code,
          message,
          arrived_at,
          resolved_at,
          EXTRACT(EPOCH FROM (resolved_at - arrived_at)) AS duration_seconds
        FROM alarm_history
        ${whereClause}
        ORDER BY arrived_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      values.push(limit, offset);

      const dataResult = await fastify.pg.query(dataQuery, values);

      return reply.send({
        total: totalRecords,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalRecords / limit),
        data: dataResult.rows,
      });

    } catch (err) {
      console.error("❌ Alarm History Fetch Error:", err);
      return reply.code(500).send({ error: "Failed to fetch alarm history" });
    }
  });


  // ======================================================
  // 2️⃣ DELETE Single Record
  // ======================================================
  fastify.delete("/alarm-history/:id", async (request, reply) => {
    try {
      const { id } = request.params;

      await fastify.pg.query(
        `DELETE FROM alarm_history WHERE id = $1`,
        [id]
      );

      return reply.send({ success: true });

    } catch (err) {
      console.error("❌ Alarm Delete Error:", err);
      return reply.code(500).send({ error: "Delete failed" });
    }
  });


  // ======================================================
  // 3️⃣ DELETE All (Optional)
  // ======================================================
  fastify.delete("/alarm-history", async (request, reply) => {
    try {
      await fastify.pg.query(`TRUNCATE TABLE alarm_history RESTART IDENTITY`);
      return reply.send({ success: true });
    } catch (err) {
      console.error("❌ Alarm Delete All Error:", err);
      return reply.code(500).send({ error: "Delete all failed" });
    }
  });


  // ======================================================
  // 4️⃣ EXPORT CSV
  // ======================================================
  fastify.get("/alarm-history/export", async (request, reply) => {
    try {
      const { startDate, endDate } = request.query;

      let whereClause = "";
      let values = [];

      if (startDate && endDate) {
        whereClause = `WHERE arrived_at BETWEEN $1 AND $2`;
        values.push(startDate, endDate);
      }

      const query = `
        SELECT 
          code,
          message,
          arrived_at,
          resolved_at,
          EXTRACT(EPOCH FROM (resolved_at - arrived_at)) AS duration_seconds
        FROM alarm_history
        ${whereClause}
        ORDER BY arrived_at DESC
      `;

      const result = await fastify.pg.query(query, values);

      // Convert to CSV
      const rows = result.rows;

      let csv = "Code,Message,Arrived At,Resolved At,Duration Seconds\n";

      rows.forEach(row => {
        csv += `${row.code},"${row.message}",${row.arrived_at},${row.resolved_at || ""},${row.duration_seconds || ""}\n`;
      });

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", "attachment; filename=alarm-history.csv")
        .send(csv);

    } catch (err) {
      console.error("❌ Alarm Export Error:", err);
      return reply.code(500).send({ error: "Export failed" });
    }
  });

}

module.exports = alarmHistoryRoutes;