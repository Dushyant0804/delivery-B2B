// models/FailedPayload.js
const pool = require("../config/pg");

/**
 * Table Definition (Run in PostgreSQL if not created):
 *
 * CREATE TABLE failed_payloads (
 *   id SERIAL PRIMARY KEY,
 *   wbn VARCHAR(50),
 *   reason VARCHAR(100),
 *   payload JSONB,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 * );
 *
 * Recommended indexes:
 * CREATE INDEX idx_failed_payloads_wbn ON failed_payloads(wbn);
 * CREATE INDEX idx_failed_payloads_reason ON failed_payloads(reason);
 */

async function insertFailedPayload(wbn, reason, payload) {
  try {
    await pool.query(
      `INSERT INTO failed_payloads (wbn, reason, payload)
       VALUES ($1, $2, $3)`,
      [wbn, reason, payload]
    );
  } catch (err) {
    console.error("❌ Failed to insert into failed_payloads:", err);
  }
}

async function getFailedByWbn(wbn) {
  const res = await pool.query(
    `SELECT * FROM failed_payloads WHERE wbn=$1 ORDER BY id DESC`,
    [wbn]
  );
  return res.rows;
}

async function getAllFailed(limit = 2000) {
  const res = await pool.query(
    `SELECT * FROM failed_payloads ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

async function deleteFailed(wbn) {
  await pool.query(`DELETE FROM failed_payloads WHERE wbn=$1`, [wbn]);
}

async function deleteAllFailed() {
  await pool.query(`DELETE FROM failed_payloads`);
}

module.exports = {
  insertFailedPayload,
  getFailedByWbn,
  getAllFailed,
  deleteFailed,
  deleteAllFailed,
};
