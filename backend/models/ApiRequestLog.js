// models/ApiRequestLog.js
const pool = require("../config/pg");

/**
 * Store HQ API request logs
 * requestPayload and responsePayload are JSON-safe (auto stringified)
 */
async function logApiRequest(
  wbn,
  bagId,
  status,
  requestPayload,
  responsePayload
) {
  try {
    await pool.query(
      `INSERT INTO api_request_logs 
        (wbn, bag_id, status, request_payload, response_payload, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        wbn,
        bagId,
        status,
        JSON.stringify(requestPayload ?? {}),
        JSON.stringify(responsePayload ?? {}),
      ]
    );
  } catch (err) {
    console.error("❌ Failed to log API request:", {
      wbn,
      bagId,
      status,
      error: err.message
    });
  }
}

/**
 * Fetch recent API logs
 */
async function getLogs(limit = 500) {
  const res = await pool.query(
    `SELECT *
     FROM api_request_logs
     ORDER BY id DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  logApiRequest,
  getLogs,
};
