// models/VendorCall.js
const pool = require("../config/pg");

async function logVendorAttempt({
  wbn,
  bag_id,
  chute_id,
  status,
  request_payload,
  response_payload,
}) {
  await pool.query(
    `INSERT INTO vendor_calls 
      (wbn, bag_id, chute_id, status, request_payload, response_payload, retries)
     VALUES ($1, $2, $3, $4, $5, $6, 0)
     ON CONFLICT (wbn) DO UPDATE 
       SET status = $4,
           response_payload = $6,
           attempted_at = NOW(),
           retries = vendor_calls.retries + 1`,
    [wbn, bag_id, chute_id, status, request_payload, response_payload]
  );
}

module.exports = { logVendorAttempt };
