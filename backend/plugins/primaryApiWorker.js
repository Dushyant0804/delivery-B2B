// plugins/primaryApiWorker.js
// Dedicated Primary Confirmation Sorter Event Worker (Primary API + Audit Sync)

const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const fetch = require("node-fetch");
const { redisConfig } = require("../config/redis");

module.exports = fp(async function primaryApiWorker(fastify) {
  const connection = new IORedis(redisConfig);

  // Converts DB timestamp into IST (+05:30) ISO format
  function toISTTimestamp(value) {
    let d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) {
      d = new Date();
    }
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().replace("Z", "+05:30");
  }

  function calcMinTH(l, b, h, w) {
    const sides = [Number(l), Number(b), Number(h)].sort((a, b) => a - b);
    const C = sides[0] < 1;
    const B = sides[1] < 5;
    const A = sides[2] < 15;
    const W = Number(w) < 20;
    return A || B || C || W;
  }

  function calcPackageType(l, b, h, realVol) {
    const vol = Number(l) * Number(b) * Number(h);
    if (!vol || !realVol) return "NON-BOX";
    return realVol / vol > 0.8 ? "BOX" : "NON-BOX";
  }

  new Worker(
    "primaryApiQueue",
    async (job) => {
      // 🔥 Job now sends "sort" instead of "status" — same SORTED/REJECTED-style
      // string values, just a renamed field.
      const { wbn, bag_code, sort, reason, tracking_id } = job.data;
      const client = await fastify.pg.connect();

      try {
        const s = typeof fastify.getSettings === "function" ? fastify.getSettings() : {};

        // Fetch bin data by unique tracking_id
        const binRes = await client.query(
          `SELECT * FROM primary_bin_data WHERE ${tracking_id ? "tracking_id = $1" : "wbn = $1 ORDER BY id DESC LIMIT 1"}`,
          [tracking_id || wbn]
        );

        if (!binRes.rows.length) return;

        const b = binRes.rows[0];
        const effectiveTrackingId = tracking_id || b.tracking_id;
        const sorterLoc = `${s.center_name || ""} (${s.state || ""})`.trim();
        const sorterId = s.sorter_name || null;

        // ======================================================
        // 1️⃣ PRIMARY API PAYLOAD PREPARATION
        // ======================================================
        const payloadStatus = sort === "SORTED" ? "success" : "fail";
        const rejectionType = sort === "SORTED" ? null : (reason || null);

        const min_th = calcMinTH(b.length, b.width, b.height, b.weight);
        const package_type = calcPackageType(b.length, b.width, b.height, b.real_volume);

        const primaryPayload = {
          schema_name: "falcon-primary-sorter-event-new",
          version: "v1",
          data: [
            {
              action_source: "FALCON_PRIMARY_SORTER_EVENT",
              bay_id: bag_code,
              cycle_time: 0,
              feedlane: "FL1",
              length: b.length,
              width: b.width,
              height: b.height,
              weight: b.weight,
              real_vol: b.real_volume,
              rejection_type: rejectionType,
              status: payloadStatus,
              inscan_timestamp: toISTTimestamp(b.scantime),
              primary_sort_timestamp: toISTTimestamp(b.sorttime),
              inscan_mode: b.mode,
              sorter_id: sorterId,
              sorter_location: sorterLoc,
              tracking_id: String(effectiveTrackingId),
              wbn: wbn,
              package_type,
              min_th,
            },
          ],
        };

        // ======================================================
        // 2️⃣ DISPATCH PRIMARY API
        // ======================================================
        let primarySuccess = false;
        let primaryResponse = null;

        if (s.primary_api === true && s.primary_api_token) {
          try {
            const rawToken = String(s.primary_api_token).trim();
            const authToken = rawToken.toLowerCase().startsWith("bearer ")
              ? rawToken
              : `Bearer ${rawToken}`;
// https://stream.delhivery.com/v1
            const res = await fetch("http://localhost:4000/v1", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authToken,
              },
              body: JSON.stringify(primaryPayload),
              timeout: 6000,
            });

            primaryResponse = await res.json().catch(() => ({}));
            primarySuccess =
              res.status === 200 &&
              primaryResponse?.success === true &&
              Array.isArray(primaryResponse.data?.accepted);
          } catch (e) {
            primaryResponse = { error: e.message };
          }
        }

        // ======================================================
        // 3️⃣ UPDATE SORTER AUDIT LOG (WITH PRIMARY & CONFIRMATION FIELDS)
        // ======================================================
        await client.query(
          `UPDATE sorter_audit_log
           SET bag_code = $1,
               ptl_id = $2,
               sorter_id = $3,
               sorter_location = $4,
               rejection_type = $5,
               primary_status = $6,
               primary_payload = $7,
               primary_response = $8,
               primary_sent_at = NOW(),
               updated_at = NOW()
           WHERE tracking_id = $9`,
          [
            bag_code || b.expected_bag || null,
            b.ptl_id || null,
            sorterId,
            sorterLoc,
            rejectionType,
            primarySuccess,
            primaryPayload ? JSON.stringify(primaryPayload) : null,
            primaryResponse ? JSON.stringify(primaryResponse) : null,
            effectiveTrackingId,
          ]
        );

        return {
          primarySuccess,
          wbn,
          bag_code,
          tracking_id: effectiveTrackingId,
        };
      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: Number(process.env.PRIMARY_API_CONC || 5),
    }
  );

  console.log("⚙ Primary Confirmation Worker (Primary API + Audit Log) started");
});