// routes/operatorAuth.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.OPERATOR_JWT_SECRET || "operator-secret";
const JWT_EXPIRES = "12h";

module.exports = async function operatorAuthRoutes(fastify) {

  /**
   * 🔐 LOGIN
   * body: { username, pin }
   */
  fastify.post("/operator/login", async (req, reply) => {
    const { username, pin } = req.body || {};

    if (!username || !pin) {
      return reply.code(400).send({ error: "username and pin required" });
    }

    if (!/^\d{4}$/.test(String(pin))) {
      return reply.code(400).send({ error: "PIN must be 4 digits" });
    }

    const client = await fastify.pg.connect();
    try {
      const res = await client.query(
        `SELECT id, username, pin_hash, is_active
         FROM operator_users
         WHERE username=$1
         LIMIT 1`,
        [username]
      );

      if (!res.rows.length) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const user = res.rows[0];

      if (!user.is_active) {
        return reply.code(403).send({ error: "User disabled" });
      }

      const ok = await bcrypt.compare(String(pin), user.pin_hash);
      if (!ok) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      /** ✅ Create token */
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      return {
        success: true,
        token,
        username: user.username
      };
    } finally {
      client.release();
    }
  });

};
