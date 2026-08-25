// models/MoveToSuccess.js
const pool = require("../config/pg");

async function movePayloadToSuccess(wbn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO success_payloads (
        wbn, oid, ndc, pt, ss, sl, st, cl, ar, mot, xray, xraycs,
        zn, cn, rcn, pdd, rpdd, adf_pin, adf_rpin, pin, rpin, cwh,
        adf_loc, adf_rloc, city, rcity, adf_city, adf_rcity, pdt,
        incoming_trip, chute_id, pri, expected, offload, scn, sorted_at
      )
      SELECT
        wbn, oid, ndc, pt, ss, sl, st, cl, ar, mot, xray, xraycs,
        zn, cn, rcn, pdd, rpdd, adf_pin, adf_rpin, pin, rpin, cwh,
        adf_loc, adf_rloc, city, rcity, adf_city, adf_rcity, pdt,
        incoming_trip, chute_id, pri, expected, offload, scn, NOW()
      FROM sorter_payloads WHERE wbn = $1
      ON CONFLICT (wbn) DO NOTHING;`,
      [wbn]
    );

    await client.query(
      `DELETE FROM sorter_payloads WHERE wbn = $1`,
      [wbn]
    );

    await client.query("COMMIT");
    console.log(`✅ Moved ${wbn} to success_payloads`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ movePayloadToSuccess failed:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = movePayloadToSuccess;
