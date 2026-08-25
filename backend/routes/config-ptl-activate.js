/**
 * Activate a PTL config
 * POST /configs/ptl/:id/activate
 */
async function ptlActivateRoute(fastify, opts) {
  fastify.post("/configs/ptl/:id/activate", async (request, reply) => {
    const id = Number(request.params.id);
    const client = await fastify.pg.connect();

    try {
      // 1. Check if another config is still active
      const activeCheck = await client.query(
        `SELECT id 
         FROM sorter_configs
         WHERE type='PTL' AND is_active = TRUE AND id != $1`,
        [id]
      );

      if (activeCheck.rowCount > 0) {
        return reply.code(409).send({
          success: false,
          error: "Another configuration is already active. Deactivate it first."
        });
      }

      // 2. Activate THIS config
      await client.query(
        `UPDATE sorter_configs
         SET is_active = TRUE, last_activated_at = NOW()
         WHERE id=$1`,
        [id]
      );

      // 3. Deactivate ALL other configs
      await client.query(
        `UPDATE sorter_configs
         SET is_active = FALSE, last_deactivated_at = NOW()
         WHERE type='PTL' AND id != $1`,
        [id]
      );

      // 4. Clear Redis caches
      await fastify.redis.del("activeConfigId:PTL");

      const keys = await fastify.redis.keys("bagRules:v1:*");
      if (keys.length) await fastify.redis.del(keys);

      // 5. Store active config ID in Redis
      await fastify.redis.set("activeConfigId:PTL", String(id));

      // 6. Reload sorter engine rules
      if (fastify.sorter && fastify.sorter.reloadRules) {
        await fastify.sorter.reloadRules();
        console.log("🔄 Sorter engine: rules reloaded (ACTIVE CONFIG = " + id + ")");
      } else {
        console.log("⚠ sorter.reloadRules() not found");
      }

      // 7. Respond success
      return reply.send({ success: true });

    } catch (err) {
      console.error("Activate route error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    } finally {
      client.release();
    }
  });
}

module.exports = ptlActivateRoute;
