// routes/bagResetRoute.js


async function bagResetRoute(fastify) {
  fastify.post("/operator/bag-reset", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { bag_code } = req.body || {};

      // -----------------------------
      // 1) Validate bag_code
      // -----------------------------
      if (!bag_code || !/^D(0[0-9]{2}|[1-9][0-9]{2})$/.test(bag_code)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag code. Expected D001–D999.",
        });
      }

      // -----------------------------
      // 2) Ensure bag exists
      // -----------------------------
      const bagCheck = await client.query(
        `SELECT bag_code FROM bags_wbn WHERE bag_code=$1 LIMIT 1`,
        [bag_code]
      );

      if (!bagCheck.rows.length) {
        return reply.code(404).send({
          success: false,
          error: "Bag not found.",
        });
      }

      // -----------------------------
      // 3) Clear bag data (MAIN LOGIC)
      // -----------------------------
      await client.query(
        `
        UPDATE bags_wbn
        SET wbns='{}',
            first_drop_at=NULL,
            updated_at=NOW()
        WHERE bag_code=$1
        `,
        [bag_code]
      );

      await client.query(
        `
        UPDATE bag_mappings
        SET wbns='{}',
            updated_at=NOW()
        WHERE bag_code=$1
        `,
        [bag_code]
      );

      // -----------------------------
      // ✅ SUCCESS
      // -----------------------------
      return reply.send({
        success: true,
        message: `Bag ${bag_code} reset successfully`,
      });

    } catch (err) {
      fastify.log.error("POST /operator/bag-reset error:", err);
      return reply.code(500).send({
        success: false,
        error: "Failed to reset bag. Please try again.",
      });
    } finally {
      client.release();
    }
  });
}

module.exports = bagResetRoute;
