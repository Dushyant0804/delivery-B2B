const { Pool } = require("pg");
require("dotenv").config();
const axios = require("axios");

const pool = new Pool({
  connectionString: process.env.PG_URI,
});

async function settingsRoutes(fastify, options) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
id SERIAL PRIMARY KEY,
      sorter_name VARCHAR(255),
      state VARCHAR(255),
      center_name VARCHAR(255),
      data_incoming BOOLEAN DEFAULT FALSE,
      live_fetching BOOLEAN DEFAULT FALSE,
      source VARCHAR(255),
      source_id VARCHAR(255),
      source_type VARCHAR(255),
      primary_api_token TEXT,
      secondary_api_token TEXT,
      bag_seal_api_token TEXT,
      bagseal_bi VARCHAR(255),
      bagseal_bt VARCHAR(255),
      primary_api BOOLEAN DEFAULT FALSE,
      secondary_api BOOLEAN DEFAULT FALSE,
      bagseal_api BOOLEAN DEFAULT FALSE,
      calibration_api BOOLEAN DEFAULT FALSE,
      calibration_wbn VARCHAR(255),
      calibration_length NUMERIC,
      calibration_width NUMERIC,
      calibration_height NUMERIC,
      calibration_weight NUMERIC,
      calibration_RealVolume NUMERIC,
      calibration_length_tolerance NUMERIC,
      calibration_width_tolerance NUMERIC,
      calibration_height_tolerance NUMERIC,
      calibration_weight_tolerance NUMERIC,
      calibration_RealVolume_tolerance NUMERIC,
      calibration_threshold NUMERIC,
      box_length_min NUMERIC,
      box_length_max NUMERIC,
      box_width_min NUMERIC,
      box_width_max NUMERIC,
      box_height_min NUMERIC,
      box_height_max NUMERIC,
      box_weight_min NUMERIC,
      box_weight_max NUMERIC,

      -- Regex Arrays
      barcode_regexes TEXT[] DEFAULT '{}',
      bagseal_regexes TEXT[] DEFAULT '{}',
      cutoff_realvolume NUMERIC,
      cutoff_weight NUMERIC,
      cutoff_count NUMERIC,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ✅ GET Settings (auto-create if missing)
  fastify.get("/settings-get", async (req, reply) => {
    try {
      const res = await pool.query("SELECT * FROM settings WHERE id = 1");

      if (res.rows.length === 0) {
        console.log("⚠️ No settings found — creating default row...");
        const insert = await pool.query(`
          INSERT INTO settings (
            sorter_name, state, center_name, data_incoming,
            live_fetching, source, source_id, source_type, secondary_api_token, primary_api_token,
            bag_seal_api_token, bagseal_bi, bagseal_bt, primary_api, secondary_api, bagseal_api, gi_api, weight_api, weight_api_token
          )
          VALUES ('', '', '', false, false, '', '', '', '', '', '', '', '', false, false, false, false, false, '')
          RETURNING *;
        `);
        return reply.send(insert.rows[0]);
      }

      reply.send(res.rows[0]);
    } catch (err) {
      console.error("❌ Error fetching settings:", err);
      reply.code(500).send({ error: "Failed to fetch settings" });
    }
  });

  // ✅ PUT Update Settings
  fastify.put("/settings-update", async (req, reply) => {
    const {
      sorter_name,
      state,
      center_name,
      data_incoming,
      live_fetching,
      source,
      source_id,
      source_type,
      secondary_api_token,
      primary_api_token,
      bag_seal_api_token,
      bagseal_bi,
      bagseal_bt,
      primary_api,
      secondary_api,
      bagseal_api,
      calibration_api,
      calibration_wbn,
      calibration_length,
      calibration_width,
      calibration_height,
      calibration_weight,
      calibration_real_volume,
      calibration_length_tolerance,
      calibration_width_tolerance,
      calibration_height_tolerance,
      calibration_weight_tolerance,
      calibration_real_volume_tolerance,
      calibration_threshold,
      box_length_min,
      box_length_max,
      box_width_min,
      box_width_max,
      box_height_min,
      box_height_max,
      box_weight_min,
      box_weight_max,
      barcode_regexes,
      bagseal_regexes,
      cutoff_realvolume,
      cutoff_weight,
      cutoff_count,
      gi_api,
      weight_api,
      weight_api_token
    } = req.body;

    try {
      const updateQuery = `
UPDATE settings SET
  sorter_name = $1,
  state = $2,
  center_name = $3,
  data_incoming = $4,
  live_fetching = $5,
  source = $6,
  source_id = $7,
  source_type = $8,
  secondary_api_token = $9,
  primary_api_token = $10,
  bag_seal_api_token = $11,
  bagseal_bi = $12,
  bagseal_bt = $13,
  primary_api = $14,
  secondary_api = $15,
  bagseal_api = $16,
  calibration_api = $17,
  calibration_wbn = $18,

  calibration_length = $19,
  calibration_width = $20,
  calibration_height = $21,
  calibration_weight = $22,
  calibration_real_volume = $23,

  calibration_length_tolerance = $24,
  calibration_width_tolerance = $25,
  calibration_height_tolerance = $26,
  calibration_weight_tolerance = $27,
  calibration_real_volume_tolerance = $28,

  calibration_threshold = $29,

  box_length_min = $30,
  box_length_max = $31,
  box_width_min = $32,
  box_width_max = $33,
  box_height_min = $34,
  box_height_max = $35,
  box_weight_min = $36,
  box_weight_max = $37,

  barcode_regexes = $38,
  bagseal_regexes = $39,
  cutoff_realvolume = $40,
  gi_api = $41,
  weight_api = $42,
  weight_api_token = $43,
  cutoff_weight = $44,
  cutoff_count = $45,

  updated_at = NOW()
WHERE id = 1
RETURNING *;
`;
      const values = [
        sorter_name,
        state,
        center_name,
        data_incoming,
        live_fetching,
        source,
        source_id,
        source_type,
        secondary_api_token,
        primary_api_token,
        bag_seal_api_token,
        bagseal_bi,
        bagseal_bt,
        primary_api,
        secondary_api,
        bagseal_api,
        calibration_api,
        calibration_wbn,

        calibration_length,
        calibration_width,
        calibration_height,
        calibration_weight,
        calibration_real_volume,

        calibration_length_tolerance,
        calibration_width_tolerance,
        calibration_height_tolerance,
        calibration_weight_tolerance,
        calibration_real_volume_tolerance,

        calibration_threshold,

        box_length_min,
        box_length_max,
        box_width_min,
        box_width_max,
        box_height_min,
        box_height_max,
        box_weight_min,
        box_weight_max,

        barcode_regexes || [],
        bagseal_regexes || [],
        cutoff_realvolume,
        gi_api,
      weight_api,
      weight_api_token,
      cutoff_weight,
      cutoff_count,
      ];

      const result = await pool.query(updateQuery, values);


      // ✅ If update didn’t affect anything, create default row and update again
      if (result.rows.length === 0) {
        console.log("⚠️ No row to update — creating one and retrying update...");
        await pool.query(`
          INSERT INTO settings (
    sorter_name, state, center_name, data_incoming,
    live_fetching, source, source_id, source_type, secondary_api_token, primary_api_token, 
    bag_seal_api_token, bagseal_bi, bagseal_bt, primary_api, secondary_api, 
    bagseal_api, calibration_api, calibration_wbn,
    calibration_length, calibration_width, calibration_height, calibration_weight,
    calibration_real_volume, calibration_length_tolerance, calibration_width_tolerance, calibration_height_tolerance,
    calibration_weight_tolerance, calibration_real_volume_tolerance, calibration_threshold, box_length_min, box_length_max, box_width_min, box_width_max,
    box_height_min, box_height_max, box_weight_min, box_weight_max, barcode_regexes, bagseal_regexes, cuttoff_volume, gi_api, weight_api, weight_api_token, cutoff_weight, cutoff_count
) VALUES (
    '', '', '', false, false, 
    '', '', '', '', '', 
    '', '', '', false, false, 
    false, false, '', 
    NULL, NULL, NULL, NULL, -- Use NULL for numeric columns
    NULL, NULL, NULL, NULL, 
    NULL, NULL, NULL, NULL, NULL, 
    NULL, NULL, NULL, NULL, '{}', '{}', NULL, false, false, '', NULL, NULL
);
        `);
        const retry = await pool.query(updateQuery, values);
        return reply.send(retry.rows[0]);
      }

      reply.send(result.rows[0]);
    } catch (err) {
      console.error("❌ Error updating settings:", err);
      reply.code(500).send({ error: "Failed to update settings" });
    }
  });

  // 🔁 PUSH LATEST SETTINGS TO NODE-RED
  fastify.post("/settings-push-nodered", async (req, reply) => {
    try {
      const res = await pool.query("SELECT * FROM settings WHERE id = 1");

      if (res.rows.length === 0) {
        return reply.code(400).send({ error: "Settings not found" });
      }

      const settings = res.rows[0];

      try {
        await axios.post(
          "http://127.0.0.1:1880/settings-update",
          settings,
          {
            timeout: 3000,
            headers: { "Content-Type": "application/json" }
          }
        );

        console.log("✅ Settings pushed to Node-RED");
        return reply.send({ success: true });

      } catch (nrErr) {
        console.error("❌ Node-RED push failed:", nrErr.message);
        return reply.code(502).send({
          success: false,
          error: "Node-RED not reachable",
        });
      }

    } catch (err) {
      console.error("❌ Push route error:", err);
      reply.code(500).send({ error: "Failed to push settings" });
    }
  });
}

module.exports = settingsRoutes;
