const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const axios = require("axios");
const moment = require("moment-timezone");

module.exports = fp(async function calibrationWorker(fastify) {

  if (!fastify.pg) {
    throw new Error("❌ fastify.pg is not registered before calibrationWorker");
  }

  const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null
  });

  new Worker(
    "calibrationQueue",
    async (job) => {
      try {
        console.log("📦 Calibration job received:", job.id, job.data);

        const box = job.data;

        // ---------------- SETTINGS ----------------
        const { rows } = await fastify.pg.query(
          `SELECT * FROM settings WHERE id = 1`
        );

        const settings = rows[0];
        if (!settings) throw new Error("Settings not found");

        const timestamp = moment().tz("Asia/Kolkata");

        // ---------------- BOX VALUES ----------------
        const length = Number(box.length);
        const width  = Number(box.width);
        const height = Number(box.height);
        const weight = Number(box.weight);

        // ---------------- SETTINGS VALUES ----------------
        const defL  = Number(settings.calibration_length);
        const defW  = Number(settings.calibration_width);
        const defH  = Number(settings.calibration_height);
        const defWt = Number(settings.calibration_weight);

        const tolL  = Number(settings.calibration_length_tolerance);
        const tolW  = Number(settings.calibration_width_tolerance);
        const tolH  = Number(settings.calibration_height_tolerance);
        const tolWt = Number(settings.calibration_weight_tolerance);

        const check = (val, def, tol) =>
          val >= (def - tol) && val <= (def + tol);

        const lengthStatus = check(length, defL, tolL) ? "pass" : "fail";
        const widthStatus  = check(width,  defW, tolW) ? "pass" : "fail";
        const heightStatus = check(height, defH, tolH) ? "pass" : "fail";
        const weightStatus = check(weight, defWt, tolWt) ? "pass" : "fail";

        const finalResult =
          [lengthStatus, widthStatus, heightStatus, weightStatus]
            .every(v => v === "pass")
            ? "pass"
            : "fail";

            // ---------------- VARIANCE ----------------
const lengthVar = +(length - defL).toFixed(1);
const widthVar  = +(width  - defW).toFixed(1);
const heightVar = +(height - defH).toFixed(1);
const weightVar = +(weight - defWt).toFixed(1);

const dimensionTolerance =
  `L±${tolL}, W±${tolW}, H±${tolH}, WT±${tolWt}`;

// ---------------- DB INSERT ----------------
const insertRes = await fastify.pg.query(
  `
  INSERT INTO calibration_logs (
    wbn,
    length_mm, width_mm, height_mm, weight_g,
    calibrate_length_mm, calibrate_width_mm, calibrate_height_mm, calibrate_weight_g,
    length_status, width_status, height_status, weight_status,
    final_result,
    length_variance, width_variance, height_variance, weight_variance,
    dimension_tolerance, volume, real_volume, feedlane,
    created_at
  )
  VALUES (
    $1,$2,$3,$4,$5,
    $6,$7,$8,$9,
    $10,$11,$12,$13,
    $14,
    $15,$16,$17,$18,
    $19,$20,$21, $22,
    NOW()
  )
  RETURNING id
  `,
  [
    box.wbn,
    length, width, height, weight,
    defL, defW, defH, defWt,
    lengthStatus, widthStatus, heightStatus, weightStatus,
    finalResult,
    lengthVar, widthVar, heightVar, weightVar,
    dimensionTolerance,
    box.Volume,
    box.RealVolume, "FL1",
  ]
);

const logId = insertRes.rows[0].id;
console.log(`📝 Calibration DB inserted id=${logId}`);


        // ---------------- PAYLOAD (UNCHANGED) ----------------
        const payload = {
          version: "v1",
          data: {
            wbn: box.wbn,
            feedlane: "FL1",
            length: box.length,
            breadth: box.width,
            height: box.height,
            weight: box.weight,
            rv: box.RealVolume,
            boxvolume: box.Volume,
            time: timestamp.toISOString(),
            machineusername: settings.sorter_name,
            scanlocation: `${settings.center_name} (${settings.state})`,
            source: "PROFILER",
            defined_l: defL.toFixed(1),
            defined_b: defW.toFixed(1),
            defined_h: defH.toFixed(1),
            defined_wt: defWt.toFixed(1)
          },
          schema_name: "profiler-weight"
        };

        console.log("📤 Sending calibration payload");

        await axios.post(
          "https://stream.delhivery.com/v1",
          payload,
          {
            headers: {
              Accept: "application/json",
              Application: "PROFILER",
              Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InByb2ZpbGVyX3dlaWdodCIsInRva2VuX25hbWUiOiJwcm9maWxlcl93ZWlnaHQiLCJjZW50ZXIiOlsiSU5EMTIyMDAzQUFCIl0sInVzZXJfdHlwZSI6Ik5GIiwiYXBwX2lkIjo0NywiYXVkIjoiLmRlbGhpdmVyeS5jb20iLCJmaXJzdF9uYW1lIjoicHJvZmlsZXJfd2VpZ2h0Iiwic3ViIjoidW1zOjp1c2VyOjpjZjRhZDg0ZS03YjJlLTExZWItODUxZC0wNjZhOWYzNDdjZmUiLCJleHAiOjE5MzAwMzI2NTQsImFwcF9uYW1lIjoiU29ydGVyLURhdGEtSW50ZWdyYXRpb24iLCJhcGlfdmVyc2lvbiI6InYyIn0.o4Sba1waUjnYXR_B9TUKDo9odFbYvY_s8Q3NlKWU4dU",
              "Content-Type": "application/json"
            },
            timeout: 15000
          }
        );

        console.log(`✅ Calibration API success for ${box.wbn}`);

      } catch (err) {
        console.error("❌ Calibration worker failed:", err);
        throw err; // IMPORTANT → BullMQ marks job as failed
      }
    },
    {
      connection,
      concurrency: 2
    }
  );
});
