// plugins/operatorAuth.js
const fp = require("fastify-plugin");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.OPERATOR_JWT_SECRET || "operator-secret";

module.exports = fp(async function operatorAuthPlugin(fastify) {

  fastify.decorate("authenticateOperator", async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth) {
      return reply.code(401).send({ error: "Missing Authorization header" });
    }

    const token = auth.replace("Bearer ", "");
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.operator = decoded; // { id, username }
    } catch (err) {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
  });

});
