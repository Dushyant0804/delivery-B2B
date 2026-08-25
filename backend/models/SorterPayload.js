// models/SorterPayload.js
const pool = require("../config/pg");

/**
 * Get single record by WBN
 */
async function getPayloadByWbn(wbn) {
  const res = await pool.query(
    `SELECT * FROM sorter_payloads WHERE wbn = $1 LIMIT 1`,
    [wbn]
  );
  return res.rows[0] || null;
}

/**
 * Bulk fetch for multi-WBN logic if needed
 */
async function getPayloadsByWbns(wbnList = []) {
  if (!wbnList.length) return [];
  const res = await pool.query(
    `SELECT * FROM sorter_payloads WHERE wbn = ANY($1)`,
    [wbnList]
  );
  return res.rows;
}

/**
 * Move one WBN from sorter_payloads → sorted_payloads
 */
async function moveToSorted(wbn) {
  const res = await pool.query(
    `
    WITH moved AS (
      DELETE FROM sorter_payloads
      WHERE wbn = $1
      RETURNING *
    )
    INSERT INTO sorted_payloads (wbn, payload, moved_at)
    SELECT wbn, row_to_json(moved.*), NOW()
    FROM moved
    RETURNING wbn;
    `,
    [wbn]
  );

  return res.rowCount > 0; // true if moved, false if not found
}

/**
 * Optional cleanup function to purge old sorted records
 */
async function purgeOldSorted(days = 7) {
  await pool.query(
    `DELETE FROM sorted_payloads WHERE moved_at < NOW() - INTERVAL '${days} days'`
  );
}

module.exports = {
  getPayloadByWbn,
  getPayloadsByWbns,
  moveToSorted,
  purgeOldSorted
};
