// routes/bagReadyCheck.js
const fp = require("fastify-plugin");

async function bagReadyCheckRoutes(fastify) {
  fastify.get("/bag-ready/:bagCode", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { bagCode } = req.params;

      // -----------------------------
      // 1) BAG SENSOR CHECK
      // -----------------------------
      const chuteId = "btn" + Number(bagCode.replace("D", ""));

      const sensorRes = await client.query(
        `SELECT value FROM bag_sensors WHERE chute_id=$1 LIMIT 1`,
        [chuteId]
      );

      if (!sensorRes.rows.length) {
        return reply.code(404).send({
          ready: false,
          reason: "SENSOR_NOT_FOUND",
          error: "Sensor not found",
        });
      }

      if (sensorRes.rows[0].value !== 1) {
        return reply.code(400).send({
          ready: false,
          reason: "SENSOR_OFF",
          error: "Bag sensor is OFF",
        });
      }

      // -----------------------------
      // 2) BAG WBN CHECK (NEW)
      // -----------------------------
      const bagRes = await client.query(
        `SELECT wbns, first_drop_at
         FROM bags_wbn
         WHERE bag_code=$1
         LIMIT 1`,
        [bagCode]
      );

      if (!bagRes.rows.length) {
        return reply.code(404).send({
          ready: false,
          reason: "BAG_NOT_FOUND",
          error: "Bag not found in bags_wbn",
        });
      }

      const { wbns } = bagRes.rows[0];

      if (!Array.isArray(wbns) || wbns.length === 0) {
        return reply.code(400).send({
          ready: false,
          reason: "EMPTY_BAG",
          error: "Bag has no WBNs",
        });
      }

      // -----------------------------
      // ✅ ALL CHECKS PASSED
      // -----------------------------
      return reply.send({
        ready: true,
        wbn_count: wbns.length,
      });

    } catch (err) {
      fastify.log.error("GET /bag-ready error:", err);
      return reply.code(500).send({
        ready: false,
        reason: "SERVER_ERROR",
        error: err.message,
      });
    } finally {
      client.release();
    }
  });
}

module.exports = bagReadyCheckRoutes;
