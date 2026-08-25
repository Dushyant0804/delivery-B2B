// routes/sorterPayloadRoutes.js
const sorterQueue = require("../plugins/queues");
const IORedis = require("ioredis");
const { validatePayload } = require("../utils/payloadValidator");
require("dotenv").config();

// Consistent response envelope for every route in this file:
// { success, error_code, error_message, data }
function sendResponse(reply, httpStatus, { success, error_code, error_message, data = null }) {
  reply.code(httpStatus).send({ success, error_code, error_message, data });
}

async function sorterPayloadRoutes(fastify, options) {
  const pool = fastify.pg;
  const redis = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
  });

  /**
   * 🟢 BULK INGEST ROUTE
   *
   * Validates every item synchronously here, before anything is queued —
   * 60 small objects costs microseconds to validate, and it means the
   * accepted/rejected split in the response is actually true at the
   * moment it's sent, instead of the caller finding out later (or never)
   * that something silently landed in sorted_payload_errors. Only
   * genuinely valid items go to the queue.
   */
  fastify.post("/bulk", async (req, reply) => {
    try {
      const { data } = req.body;
      console.log(data);

      if (!Array.isArray(data) || data.length === 0) {
        return sendResponse(reply, 400, {
          success: false,
          error_code: "400",
          error_message: "Invalid payload",
        });
      }

      const accepted = [];
      const validItems = [];
      const rejected = []; // { wbn, error } — returned to caller
      const rejectedFull = []; // keeps the full item too, for the error-table insert

      for (const item of data) {
        const result = validatePayload(item);
        if (result.valid) {
          accepted.push(item.wbn);
          validItems.push(item);
        } else {
          rejected.push({ wbn: item.wbn || null, error: result.error });
          rejectedFull.push({ item, error: result.error });
        }
      }

      // Log rejected items now, synchronously — small in number (this
      // should be rare once validation lives here), no need to route
      // them through the queue.
      if (rejectedFull.length > 0) {
        const client = await pool.connect();
        try {
          for (const { item, error } of rejectedFull) {
            console.log(`❌ Invalid payload for WBN ${item.wbn}: ${error}`);
            await client.query(
              `INSERT INTO sorted_payload_errors (wbn, payload, error, created_at)
               VALUES ($1, $2, $3, NOW())`,
              [item.wbn || null, item, error]
            );
          }
        } finally {
          client.release();
        }
      }

      if (validItems.length > 0) {
        await fastify.queues.sorterQueue.add("bulkInsert", validItems);
      }

      if (accepted.length === 0) {
        return sendResponse(reply, 400, {
          success: false,
          error_code: "400",
          error_message: "All items failed validation",
          data: { accepted },
        });
      }

      return sendResponse(reply, 200, {
        success: true,
        error_code: "200",
        error_message: rejected.length > 0 ? "Partially accepted" : "Ok",
        data: { accepted },
      });
    } catch (err) {
      fastify.log.error("❌ Bulk ingestion error:", err);
      sendResponse(reply, 500, {
        success: false,
        error_code: "500",
        error_message: "Server Error",
      });
    }
  });

  // 🟢 MANUAL INSERT
  fastify.post("/manual", async (req, reply) => {
    try {
      const payload = req.body;
      const result = validatePayload(payload);

      if (!result.valid) {
        await pool.query(
          `INSERT INTO sorted_payload_errors (wbn, payload, error, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [payload.wbn || null, payload, result.error]
        );
        return sendResponse(reply, 400, {
          success: false,
          error_code: "400",
          error_message: result.error,
        });
      }

      // FIXED ✔
      await fastify.queues.sorterQueue.add("manualInsert", [payload]);

      sendResponse(reply, 200, {
        success: true,
        error_code: "200",
        error_message: "Ok",
        data: { accepted: [payload.wbn] },
      });
    } catch (err) {
      fastify.log.error("❌ Manual insert error:", err);
      sendResponse(reply, 500, {
        success: false,
        error_code: "500",
        error_message: "Server error",
      });
    }
  });

  /**
   * 🟢 FETCH ALL
   */

  // 🟢 GET /bulk → Return empty array so browser GET works
  fastify.get("/bulk", async (req, reply) => {
    sendResponse(reply, 200, {
      success: true,
      error_code: "200",
      error_message: "Ok",
      data: { accepted: [] },
    });
  });

  fastify.get("/", async (req, reply) => {
    try {
      const { limit = 500 } = req.query;
      const result = await pool.query(
        `SELECT wbn, payload, created_at, updated_at 
         FROM sorted_payloads 
         ORDER BY updated_at DESC 
         LIMIT $1`,
        [parseInt(limit)]
      );
      sendResponse(reply, 200, {
        success: true,
        error_code: "200",
        error_message: "Ok",
        data: { rows: result.rows },
      });
    } catch (err) {
      fastify.log.error("❌ Fetch error:", err);
      sendResponse(reply, 500, {
        success: false,
        error_code: "500",
        error_message: "Failed to fetch",
      });
    }
  });

  /**
   * 🟢 FETCH BY WBN with Redis Cache
   */
  fastify.get("/:wbn", async (req, reply) => {
    const { wbn } = req.params;
    if (!wbn) {
      return sendResponse(reply, 400, {
        success: false,
        error_code: "400",
        error_message: "WBN required",
      });
    }

    try {
      const cached = await redis.get(`payload:${wbn}`);
      if (cached) {
        return sendResponse(reply, 200, {
          success: true,
          error_code: "200",
          error_message: "Ok",
          data: { source: "redis", payload: JSON.parse(cached) },
        });
      }

      const result = await pool.query(
        `SELECT wbn, payload, created_at FROM sorted_payloads WHERE wbn=$1 LIMIT 1`,
        [wbn]
      );

      if (result.rows.length === 0) {
        return sendResponse(reply, 404, {
          success: false,
          error_code: "404",
          error_message: "WBN not found",
        });
      }

      await redis.setex(`payload:${wbn}`, 3600, JSON.stringify(result.rows[0]));
      sendResponse(reply, 200, {
        success: true,
        error_code: "200",
        error_message: "Ok",
        data: { source: "postgres", payload: result.rows[0] },
      });
    } catch (err) {
      fastify.log.error("❌ Fetch by WBN error:", err);
      sendResponse(reply, 500, {
        success: false,
        error_code: "500",
        error_message: "Error fetching payload",
      });
    }
  });

  /**
   * 🔴 DELETE ALL RECORDS
   */
  fastify.delete("/", async (req, reply) => {
    try {
      await pool.query(`TRUNCATE sorted_payloads RESTART IDENTITY`);
      await redis.flushdb();
      sendResponse(reply, 200, {
        success: true,
        error_code: "200",
        error_message: "All records deleted",
      });
    } catch (err) {
      fastify.log.error("❌ Delete error:", err);
      sendResponse(reply, 500, {
        success: false,
        error_code: "500",
        error_message: "Failed to delete records",
      });
    }
  });
}

module.exports = sorterPayloadRoutes;