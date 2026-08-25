// routes/operatorUsers.js
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;

async function operatorUsersRoutes(fastify) {

  /**
   * 🔹 GET all users
   */
  fastify.get("/operator-users", async (req, reply) => {
    const client = await fastify.pg.connect();
    try {
      const res = await client.query(
        `SELECT id, username, is_active, created_at
         FROM operator_users
         ORDER BY id ASC`
      );
      return res.rows;
    } finally {
      client.release();
    }
  });

  /**
   * 🔹 ADD user (signup)
   * body: { username, pin }
   */
  fastify.post("/operator-users", async (req, reply) => {
    const { username, pin } = req.body || {};

    if (!username || !pin) {
      return reply.code(400).send({ error: "username and pin required" });
    }

    if (!/^\d{4}$/.test(String(pin))) {
      return reply.code(400).send({ error: "PIN must be 4 digits" });
    }

    const pinHash = await bcrypt.hash(String(pin), SALT_ROUNDS);
    const client = await fastify.pg.connect();

    try {
      await client.query(
        `
        INSERT INTO operator_users (username, pin_hash)
        VALUES ($1, $2)
        `,
        [username, pinHash]
      );

      return { success: true, username };
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "username already exists" });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * 🔹 UPDATE PIN
   * body: { pin }
   */
  fastify.put("/operator-users/:id/pin", async (req, reply) => {
    const { id } = req.params;
    const { pin } = req.body || {};

    if (!/^\d{4}$/.test(String(pin))) {
      return reply.code(400).send({ error: "PIN must be 4 digits" });
    }

    const pinHash = await bcrypt.hash(String(pin), SALT_ROUNDS);
    const client = await fastify.pg.connect();

    try {
      const res = await client.query(
        `
        UPDATE operator_users
        SET pin_hash=$1, updated_at=NOW()
        WHERE id=$2
        `,
        [pinHash, id]
      );

      if (res.rowCount === 0) {
        return reply.code(404).send({ error: "user not found" });
      }

      return { success: true };
    } finally {
      client.release();
    }
  });

  /**
   * 🔹 DELETE user
   */
  fastify.delete("/operator-users/:id", async (req, reply) => {
    const { id } = req.params;
    const client = await fastify.pg.connect();

    try {
      const res = await client.query(
        `DELETE FROM operator_users WHERE id=$1`,
        [id]
      );

      if (res.rowCount === 0) {
        return reply.code(404).send({ error: "user not found" });
      }

      return { success: true };
    } finally {
      client.release();
    }
  });

};

module.exports = operatorUsersRoutes;
