// plugins/dwsApiWorker.js
const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const axios = require("axios");
const { redisConfig } = require("../config/redis");

module.exports = fp(async function dwsApiWorkerPlugin(fastify) {
  const pool = fastify.pg;

  const dwsWorker = new Worker(
    "dwsApiQueue",
    async (job) => {
      const {
        trackingId,
        wbn,
        length,
        width,
        height,
        weight,
        Volume,
        RealVolume,
      } = job.data;

      // 1. Settings & Token Check
      const settings = fastify.getSettings();
      const rawToken = settings?.weight_api_token || process.env.DELHIVERY_AUTH_TOKEN || "";

      if (!rawToken) {
        console.log(`⚠️ [DWS API Skipped] No token configured for WBN: ${wbn}`);
        return;
      }

      const cleanToken = String(rawToken).trim();
      const authHeader = cleanToken.toLowerCase().startsWith("bearer ")
        ? cleanToken
        : `Bearer ${cleanToken}`;

      const headers = {
        Authorization: authHeader,
        Accept: "application/json",
        Application: "PROFILER",
        "Content-Type": "application/json",
      };

      const centerName = settings?.center_name
        ? `${settings.center_name} (${settings.state || ""})`.trim()
        : "Noida_DeriSkaner_H (Uttar Pradesh)";

      // ======================================================
      // 2. STEP 1: GI API (ALWAYS FIRST)
      // ======================================================
      const giPayload = {
        center: centerName,
        ref_ids: [String(wbn || "").trim()],
        large: "true",
      };

      let giStatus = false; // Boolean as per DB schema
      let giResponse = null;
// https://track.delhivery.com/api/mob-loc/mi/
      try {
        const giRes = await axios.post("http://localhost:4000/api/mob-loc/mi/", giPayload, {
          timeout: 6000,
          headers,
        });

        giStatus = giRes.status === 200 || giRes.status === 201;
        giResponse = giRes.data;
      } catch (err) {
        giStatus = false;
        giResponse = {
          error: err.message,
          data: err.response?.data || null,
        };
        console.log(`❌ [GI API Error] WBN: ${wbn} - ${err.message}`);
      }

      // ======================================================
      // 3. STEP 2: WEIGHT API (ALWAYS SECOND)
      // ======================================================
      const weightPayload = {
        wbn: String(wbn || "").trim(),
        l: String(length ?? 0),
        b: String(width ?? 0),
        h: String(height ?? 0),
        wt: String(weight ?? 0),
        v: String(Volume ?? 0),
        rv: String(RealVolume ?? 0),
      };

      let weightStatus = false; // Boolean as per DB schema
      let weightResponse = null;

      try {
        const weightRes = await axios.post("http://localhost:4000/api/p/update/", weightPayload, {
          timeout: 6000,
          headers,
        });

        weightStatus = weightRes.status === 200 || weightRes.status === 201;
        weightResponse = weightRes.data;
      } catch (err) {
        weightStatus = false;
        weightResponse = {
          error: err.message,
          data: err.response?.data || null,
        };
        console.log(`❌ [Weight API Error] WBN: ${wbn} - ${err.message}`);
      }

      // ======================================================
      // 4. STEP 3: SINGLE DATABASE UPSERT (FIXED INDEXING)
      // ======================================================
      try {
        await pool.query(
          `INSERT INTO sorter_audit_log (
            tracking_id, wbn,
            gi_payload, gi_response, gi_status, gi_sent_at,
            weight_payload, weight_response, weight_status, weight_sent_at,
            created_at, updated_at
          ) VALUES (
            $1, $2,
            $3, $4, $5, NOW(),
            $6, $7, $8, NOW(),
            NOW(), NOW()
          )
          ON CONFLICT (tracking_id) DO UPDATE SET
            wbn = EXCLUDED.wbn,
            gi_payload = EXCLUDED.gi_payload,
            gi_response = EXCLUDED.gi_response,
            gi_status = EXCLUDED.gi_status,
            gi_sent_at = NOW(),
            weight_payload = EXCLUDED.weight_payload,
            weight_response = EXCLUDED.weight_response,
            weight_status = EXCLUDED.weight_status,
            weight_sent_at = NOW(),
            updated_at = NOW()`,
          [
            trackingId,
            wbn,
            JSON.stringify(giPayload),
            JSON.stringify(giResponse),
            giStatus,
            JSON.stringify(weightPayload),
            JSON.stringify(weightResponse),
            weightStatus,
          ]
        );

        console.log(`✅ [DWS Sequential Done] WBN: ${wbn} | GI: ${giStatus} -> Weight: ${weightStatus}`);
      } catch (dbErr) {
        console.log(`❌ [DWS Audit DB Error] WBN: ${wbn} - ${dbErr.message}`);
      }
    },
    {
      connection: redisConfig,
      concurrency: 5,
    }
  );

  fastify.addHook("onClose", async () => {
    await dwsWorker.close();
  });
});