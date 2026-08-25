async function bagSensorsRoutes(fastify) {

  fastify.get("/bag-sensors", async () => {
    const { rows } = await fastify.pg.query(
      `SELECT chute_id, value, updated_at 
       FROM bag_sensors 
       ORDER BY chute_id ASC`
    );
    return rows;
  });

}

module.exports = bagSensorsRoutes;
