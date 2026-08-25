const { Pool } = require("pg");
const bcrypt = require("bcrypt");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.PG_URI,
});

const SALT_ROUNDS = 10;

async function operatorsManagementRoutes(fastify, options) {

  // =============================
  // CREATE operators TABLE
  // =============================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role VARCHAR(50) DEFAULT 'operators',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // =============================
  // GET ALL operators (NO PASSWORD)
  // =============================
  fastify.get("/operators", async (req, reply) => {
    try {
      const res = await pool.query(
        "SELECT id, username, role, created_at FROM operators ORDER BY id ASC"
      );
      reply.send(res.rows);
    } catch (err) {
      console.error("❌ Fetch operators error:", err);
      reply.code(500).send({ error: "Failed to fetch operators" });
    }
  });

  // =============================
  // ADD USER (HASH PASSWORD)
  // =============================
  fastify.post("/operators", async (req, reply) => {
    const { username, password, role } = req.body;

    try {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const res = await pool.query(
        `INSERT INTO operators (username, password, role)
         VALUES ($1, $2, $3)
         RETURNING id, username, role`,
        [username, hashedPassword, role || "operators"]
      );

      reply.send(res.rows[0]);

    } catch (err) {
      console.error("❌ Add user error:", err);

      if (err.code === "23505") {
        return reply.code(400).send({ error: "Username already exists" });
      }

      reply.code(500).send({ error: "Failed to create user" });
    }
  });

  // =============================
  // UPDATE USER (RE-HASH PASSWORD)
  // =============================
  fastify.put("/operators/:id", async (req, reply) => {
    const { id } = req.params;
    const { password, role } = req.body;

    try {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const res = await pool.query(
        `UPDATE operators
         SET password = $1,
             role = $2
         WHERE id = $3
         RETURNING id, username, role`,
        [hashedPassword, role || "operators", id]
      );

      if (res.rows.length === 0) {
        return reply.code(404).send({ error: "User not found" });
      }

      reply.send(res.rows[0]);

    } catch (err) {
      console.error("❌ Update user error:", err);
      reply.code(500).send({ error: "Failed to update user" });
    }
  });

  // =============================
  // DELETE USER
  // =============================
  fastify.delete("/operators/:id", async (req, reply) => {
    const { id } = req.params;

    try {
      const res = await pool.query(
        "DELETE FROM operators WHERE id = $1 RETURNING id",
        [id]
      );

      if (res.rows.length === 0) {
        return reply.code(404).send({ error: "User not found" });
      }

      reply.send({ success: true });

    } catch (err) {
      console.error("❌ Delete user error:", err);
      reply.code(500).send({ error: "Failed to delete user" });
    }
  });

  // =============================
  // LOGIN API (FOR HHD / operators)
  // =============================
  fastify.post("/auth/login", async (req, reply) => {
    const { username, password } = req.body;

    try {
      const res = await pool.query(
        "SELECT * FROM operators WHERE username = $1",
        [username]
      );

      if (res.rows.length === 0) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const user = res.rows[0];

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      // ✅ Successful login
      reply.send({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      });

    } catch (err) {
      console.error("❌ Login error:", err);
      reply.code(500).send({ error: "Login failed" });
    }
  });
}

module.exports = operatorsManagementRoutes;
