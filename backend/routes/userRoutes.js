const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

async function userRoutes(fastify, options) {
  const pool = fastify.pg;

  // 🟢 SIGNUP / CREATE ACCOUNT
  fastify.post("/signup", async (request, reply) => {
    const { username, password, confirmPassword } = request.body;

    try {
      if (!username || !password || !confirmPassword) {
        return reply.code(400).send({ message: "All fields are required" });
      }

      if (password !== confirmPassword) {
        return reply.code(400).send({ message: "Passwords do not match" });
      }

      // Check if username already exists
      const existing = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
      if (existing.rows.length > 0) {
        return reply.code(400).send({ message: "Username already exists" });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Insert new user
      await pool.query(
        `INSERT INTO users (username, password, role, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [username, hashedPassword, "user"]
      );

      // Log event
      await pool.query(
        `INSERT INTO user_logs (username, message, timestamp)
         VALUES ($1, $2, NOW())`,
        [username, "account_created"]
      );

      fastify.log.info(`✅ New user created: ${username}`);
      reply.code(201).send({ message: "Account created successfully" });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ message: "Server error during signup" });
    }
  });

  // 🟢 LOGIN
  fastify.post("/login", async (request, reply) => {
    const { username, password } = request.body;

    try {
      const res = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
      const user = res.rows[0];

      if (!user) {
        fastify.log.warn("❌ User not found");
        return reply.code(400).send({ message: "Invalid username or password" });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return reply.code(400).send({ message: "Invalid username or password" });
      }

      const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });

      await pool.query(
        `INSERT INTO user_logs (username, message, timestamp)
         VALUES ($1, $2, NOW())`,
        [username, "login"]
      );

      reply.send({ token, username: user.username, role: user.role });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ message: "Server error during login" });
    }
  });

  // 🟢 LOGOUT (frontend deletes token)
  fastify.post("/logout", async (request, reply) => {
    reply.send({ message: "Logged out successfully" });
  });

  // 🟢 GET ALL USERS (for admin panel or later use)
  fastify.get("/users", async (request, reply) => {
    try {
      const res = await pool.query("SELECT id, username, role, created_at FROM users ORDER BY id ASC");
      reply.send(res.rows);
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ message: "Failed to fetch users" });
    }
  });

  // 🟢 DELETE USER
  fastify.delete("/users/:id", async (request, reply) => {
    const { id } = request.params;
    try {
      const userRes = await pool.query("SELECT username FROM users WHERE id = $1", [id]);
      if (userRes.rowCount === 0) {
        return reply.code(404).send({ message: "User not found" });
      }

      const username = userRes.rows[0].username;
      await pool.query("DELETE FROM users WHERE id = $1", [id]);

      await pool.query(
        `INSERT INTO user_logs (username, message, timestamp)
         VALUES ($1, $2, NOW())`,
        [username, "account_deleted"]
      );

      fastify.log.info(`🗑️ User deleted: ${username}`);
      reply.send({ message: "User deleted successfully" });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ message: "Failed to delete user" });
    }
  });
}

module.exports = userRoutes;
