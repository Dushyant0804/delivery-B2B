// models/settings.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.PG_URI,
});

// ✅ Create default settings (only once)
async function createDefaultSettings() {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO settings (
        sorter_name, state, center_name, data_incoming,
        source, source_id, source_type, secondary_api_token, bag_seal_api_token
      )
      VALUES ('', '', '', false, '', '', '', '', '')
      ON CONFLICT DO NOTHING
      RETURNING *;
    `;
    const result = await client.query(query);
    return result.rows[0];
  } catch (err) {
    console.error("❌ DB insert error (settings):", err);
    throw err;
  } finally {
    client.release();
  }
}

// ✅ Fetch settings (usually one row)
async function getSettings() {
  const query = `SELECT * FROM settings WHERE id = 1`;
  const res = await pool.query(query);
  return res.rows[0] || null;
}

// ✅ Update settings
async function updateSettings(updates) {
  const {
    sorter_name,
    state,
    center_name,
    data_incoming,
    source,
    source_id,
    source_type,
    secondary_api_token,
    bag_seal_api_token,
  } = updates;

  const query = `
    UPDATE settings SET
      sorter_name = $1,
      state = $2,
      center_name = $3,
      data_incoming = $4,
      source = $5,
      source_id = $6,
      source_type = $7,
      secondary_api_token = $8,
      bag_seal_api_token = $9,
      updated_at = NOW()
    WHERE id = 1
    RETURNING *;
  `;

  const values = [
    sorter_name,
    state,
    center_name,
    data_incoming,
    source,
    source_id,
    source_type,
    secondary_api_token,
    bag_seal_api_token,
  ];

  const res = await pool.query(query, values);
  return res.rows[0];
}

// ✅ Delete all settings (maintenance/debug)
async function deleteAllSettings() {
  await pool.query(`DELETE FROM settings`);
}

module.exports = {
  createDefaultSettings,
  getSettings,
  updateSettings,
  deleteAllSettings,
};
