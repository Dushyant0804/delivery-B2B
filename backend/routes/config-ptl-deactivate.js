/**
 * Deactivate a PTL config
 * POST /configs/ptl/:id/deactivate
 */
async function ptlDeactivateRoute(fastify, opts) {
  fastify.post("/configs/ptl/:id/deactivate", async (request, reply) => {
    const id = Number(request.params.id);
    const client = await fastify.pg.connect();

    try {
      // 1️⃣ Check if this config is currently active
      const check = await client.query(
        `SELECT id 
         FROM sorter_configs 
         WHERE id=$1 AND is_active = TRUE`,
        [id]
      );

      if (check.rowCount === 0) {
        return reply.code(400).send({
          success: false,
          error: "This configuration is not active."
        });
      }

      // 2️⃣ Check bags_wbn for pending parcels
      const pending = await client.query(`
        SELECT bag_code, array_length(wbns, 1) AS count
        FROM bags_wbn
        WHERE array_length(wbns, 1) > 0
      `);

      if (pending.rowCount > 0) {
        const bags = pending.rows.map(
          r => `${r.bag_code} (${r.count})`
        );

        return reply.code(409).send({
          success: false,
          error: "Cannot deactivate configuration. Some bags still contain parcels.",
          bags
        });
      }

      // 3️⃣ Deactivate config
      await client.query(
        `UPDATE sorter_configs
         SET is_active = FALSE,
             last_deactivated_at = NOW()
         WHERE id=$1`,
        [id]
      );

      // 4️⃣ Clear Redis
      await fastify.redis.del("activeConfigId:PTL");

      const keys = await fastify.redis.keys("bagRules:v1:*");
      if (keys.length) await fastify.redis.del(keys);

      // 5️⃣ Reset sorter memory
      if (fastify.sorter?.reloadRules) {
        await fastify.sorter.reloadRules();
      }

      return reply.send({ success: true });

    } catch (err) {
      console.error("Deactivate error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    } finally {
      client.release();
    }
  });
}

module.exports = ptlDeactivateRoute;
