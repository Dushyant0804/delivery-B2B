async function ptlListRoute(fastify, opts) {
  fastify.get("/configs/ptl", async (request, reply) => {

    // Always fetch fresh from DB
    const { rows } = await fastify.pg.query(`
      SELECT id, name, type, status, is_active, file_path,
             uploaded_at, last_activated_at, last_deactivated_at,
             error_message
      FROM sorter_configs
      WHERE type='PTL'
      ORDER BY is_active DESC, last_activated_at DESC NULLS LAST, uploaded_at DESC
    `);

    return reply.send(rows);
  });
}

module.exports = ptlListRoute;
