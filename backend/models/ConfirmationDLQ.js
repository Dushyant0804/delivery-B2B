// models/ConfirmationDLQ.js
const pool = require("../config/pg");

async function saveConfirmationDLQ({ barcode, induct_id, sort_status, reason, payload }) {
  await pool.query(
    `INSERT INTO confirmation_dlq (barcode, induct_id, sort_status, reason, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [barcode, induct_id, sort_status, reason, payload]
  );
}

module.exports = { saveConfirmationDLQ };
