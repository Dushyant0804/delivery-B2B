// plugins/secondaryApiWorker.js
// Dedicated Secondary Sorter Event Worker (Secondary API Only)

const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const fetch = require("node-fetch");
const { redisConfig } = require("../config/redis");

module.exports = fp(async function secondaryApiWorker(fastify) {
  const connection = new IORedis(redisConfig);

  function utcTS() {
    return new Date().toISOString().replace("Z", "+00:00");
  }

  new Worker(
    "secondaryApiQueue",
    async (job) => {
      // 🔥 Job now sends "sort" instead of "status" — same SORTED/REJECTED-style
      // string values, just renamed to match the primaryApiWorker convention and
      // the primary_bin_data table's actual "sort" column.
      const { wbn, bag_code, ptl_id, sort, reason, tracking_id } = job.data;
      const client = await fastify.pg.connect();

      try {
        // 1️⃣ Settings Check
        const s = await fastify.getSettings();

        if (s.secondary_api !== true || !s.secondary_api_token) {
          // Secondary API not enabled — skip execution
          return;
        }

        // 2️⃣ Resolve Target Audit Row (by tracking_id priority, wbn fallback)
        const auditRes = await client.query(
          `SELECT id, tracking_id FROM sorter_audit_log 
           WHERE ${tracking_id ? "tracking_id = $1" : "wbn = $1 ORDER BY id DESC"} 
           LIMIT 1`,
          [tracking_id || wbn]
        );

        if (!auditRes.rows.length) {
          console.warn(`⚠️ [Secondary API Skipped] No sorter_audit_log row found for WBN=${wbn} / trackingId=${tracking_id}`);
          return;
        }

        const auditRowId = auditRes.rows[0].id;
        const sorterLoc = `${s.center_name || ""} (${s.state || ""})`.trim();

        // 3️⃣ Payload Preparation
        const payloadStatus = sort === "SORTED" ? "success" : "fail";
        const rejectionType = sort === "SORTED" ? null : (reason || null);

        const secondaryPayload = {
          schema_name: "mechatronics-secondary-sorter-event-new",
          version: "v1",
          data: [
            {
              action_source: "FALCON_SECONDARY_SORTER_EVENT",
              bay_id: bag_code,
              operator_id: s.machine_username || "MECHATRONICS3D-1",
              primary_sort_timestamp: utcTS(),
              ptl_id: ptl_id || null,
              rejection_type: rejectionType,
              scanned_bay_id: bag_code,
              secondary_sort_timestamp: utcTS(),
              sorter_id: s.sorter_name || null,
              sorter_location: sorterLoc,
              status: payloadStatus,
              awb: String(wbn).trim(),
            },
          ],
        };

        // 4️⃣ Dispatch Secondary API
        let secondarySuccess = false;
        let secondaryResponse = null;

        try {
          const rawToken = String(s.secondary_api_token).trim();
          const authToken = rawToken.toLowerCase().startsWith("bearer ")
            ? rawToken
            : `Bearer ${rawToken}`;
// https://stream.delhivery.com/v1
          const res2 = await fetch("http://localhost:4000/v1", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authToken,
            },
            body: JSON.stringify(secondaryPayload),
            timeout: 6000,
          });

          secondaryResponse = await res2.json().catch(() => ({}));
          secondarySuccess =
            res2.status === 200 &&
            secondaryResponse?.success === true &&
            Array.isArray(secondaryResponse.data?.accepted);
        } catch (e) {
          secondaryResponse = { error: e.message };
        }

        // 5️⃣ Update Audit Log with Secondary Event Result
        await client.query(
          `UPDATE sorter_audit_log
           SET secondary_status = $1,
               secondary_payload = $2,
               secondary_response = $3,
               secondary_sent_at = NOW(),
               updated_at = NOW()
           WHERE id = $4`,
          [
            secondarySuccess,
            secondaryPayload ? JSON.stringify(secondaryPayload) : null,
            secondaryResponse ? JSON.stringify(secondaryResponse) : null,
            auditRowId,
          ]
        );

        return {
          secondarySuccess,
          wbn,
          bag_code,
          auditRowId,
        };
      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: Number(process.env.SECONDARY_API_CONC || 3),
    }
  );

  console.log("⚙ Secondary API Worker (Cleaned & Optimized) started");
});