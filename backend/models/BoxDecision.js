// models/BoxDecision.js
const pool = require("../config/pg");

/**
 * Insert a new decision row
 */
async function insertDecision({
  wbn,
  induct_point,
  decided_bag,
  decision_type,
  rejection_code,
}) {
  const res = await pool.query(
    `INSERT INTO box_decisions 
      (wbn, induct_point, decided_bag, decision_type, rejection_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [wbn, induct_point, decided_bag, decision_type, rejection_code]
  );
  return res.rows[0];
}

/**
 * Fetch latest decision for a WBN
 */
async function getDecisionByWbn(wbn) {
  const res = await pool.query(
    `SELECT *
     FROM box_decisions
     WHERE wbn = $1
     ORDER BY id DESC
     LIMIT 1`,
    [wbn]
  );
  return res.rows[0];
}

/**
 * Update decision_type (used by ConfirmationWorker)
 */
async function updateDecisionStatus(wbn, newStatus) {
  await pool.query(
    `UPDATE box_decisions
     SET decision_type = $1, updated_at = NOW()
     WHERE wbn = $2`,
    [newStatus, wbn]
  );
}

/**
 * Update confirmation status + timestamp
 */
async function updateConfirmationStatus(wbn, status) {
  await pool.query(
    `UPDATE box_decisions
     SET confirmation_status = $1, confirmation_at = NOW(), updated_at = NOW()
     WHERE wbn = $2`,
    [status, wbn]
  );
}

/**
 * Update vendor API result
 */
async function updateConfirmationStatus(wbn, status) {
  const res = await pool.query(
    `UPDATE box_decisions
     SET confirmation_status = $1, confirmation_at = NOW(), updated_at = NOW()
     WHERE wbn = $2
     RETURNING *`,
    [status, wbn]
  );
  return res.rows[0] || null;
}

/**
 * Check if decision already exists (avoid duplicates)
 */
async function checkDecisionExists(wbn) {
  const res = await pool.query(
    `SELECT 1 FROM box_decisions WHERE wbn=$1 LIMIT 1`,
    [wbn]
  );
  return res.rowCount > 0;
}

module.exports = {
  insertDecision,
  getDecisionByWbn,
  updateDecisionStatus,
  updateConfirmationStatus,
  updateVendorStatus,
  checkDecisionExists,
};
