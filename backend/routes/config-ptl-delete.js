/**
 * Delete a PTL Config
 * DELETE /configs/ptl/:id
 */
async function ptlDeleteRoute(fastify, opts) {
  fastify.delete("/configs/ptl/:id", async (request, reply) => {
    const id = Number(request.params.id);

    const { rows } = await fastify.pg.query(
      `SELECT is_active FROM sorter_configs WHERE id=$1`,
      [id]
    );

    if (!rows.length) {
      return reply.code(404).send({ error: "Config not found" });
    }
    if (rows[0].is_active) {
      return reply.code(400).send({ error: "Cannot delete an active config" });
    }

    await fastify.pg.query(`DELETE FROM sorter_configs WHERE id=$1`, [id]);
    return reply.send({ success: true });
  });
}

module.exports = ptlDeleteRoute;
