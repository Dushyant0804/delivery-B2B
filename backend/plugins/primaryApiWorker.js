// plugins/primaryApiWorker.js
const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { createCanvas, loadImage } = require("canvas");
const moment = require("moment-timezone");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { redisConfig } = require("../config/redis");

module.exports = fp(async function primaryApiWorker(fastify) {

  const connection = new IORedis(redisConfig);

  // Converts a DB timestamp (scantime/sorttime — stored UTC in Postgres)
  // into an IST wall-clock ISO string with a +05:30 suffix. Same
  // shift-then-relabel pattern used throughout this project's other IST
  // helpers: shift the UTC instant forward 5.5h, then print those
  // (now-IST) component values with an explicit +05:30 label instead of
  // toISOString()'s default "Z". If the DB value is missing/invalid
  // (e.g. sorttime not yet set — a precheck-level reject like IBO never
  // reaches the branch that sets it), falls back to the current moment,
  // still correctly converted to IST — not a UTC-labeled "now" pretending
  // to be a real DB value.
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

      const { wbn, bag_code, status, reason, ptl_id, mode } = job.data;
      const client = await fastify.pg.connect();

      try {

        /**************************************
         1️⃣ Load SETTINGS + BIN DATA
        **************************************/
        const sRes = await client.query(`SELECT * FROM settings LIMIT 1`);
        const s = sRes.rows[0];
        if (!s) return;

        const binRes = await client.query(
          `SELECT * FROM primary_bin_data WHERE wbn = $1 ORDER BY id DESC LIMIT 1`,
          [wbn]
        );

        if (!binRes.rows.length) return;

        const b = binRes.rows[0];
        const tracking_id = b.id;
        const sorterLoc = `${s.center_name} (${s.state})`;

        /**************************************
         2️⃣ INSERT BASE AUDIT ROW
        **************************************/
        const insert = await client.query(
          `INSERT INTO sorter_audit_log
            (wbn, tracking_id, bag_code, ptl_id, sorter_id, sorter_location, rejection_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [wbn, tracking_id, bag_code, ptl_id, s.sorter_name, sorterLoc, reason]
        );

        const sorter_id = insert.rows[0].id;

        /**************************************
         3️⃣ PRIMARY API
        **************************************/
        const payloadStatus = status === "SORTED" ? "success" : "fail";
        const rejectionType = status === "SORTED" ? null : (reason || null);

        const min_th = calcMinTH(b.length, b.width, b.height, b.weight);
        const package_type = calcPackageType(
          b.length, b.width, b.height, b.real_volume
        );

        const primaryPayload = {
          schema_name: "falcon-primary-sorter-event-new",
          version: "v1",
          data: [{
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
            sorter_id: s.sorter_name,
            sorter_location: `${s.center_name} (${s.state})`,
            tracking_id: String(tracking_id),
            wbn: wbn,
            package_type,
            min_th
          }]
        };

        let primarySuccess = false;
        let primaryResponse = null;

        if (s.primary_api === true && s.primary_api_token) {
          try {
            const res = await fetch("https://stream.delhivery.com/v1", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": s.primary_api_token
              },
              body: JSON.stringify(primaryPayload)
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

        await client.query(
          `UPDATE sorter_audit_log
           SET primary_status = $1,
               primary_payload = $2,
               primary_response = $3,
               primary_sent_at = NOW()
           WHERE id = $4`,
          [primarySuccess, primaryPayload, primaryResponse, sorter_id]
        );

        /**************************************
         4️⃣ MACRO API
        **************************************/
        let macroSuccess = false;
        let macroResponse = null;

        try {
          const macroUrl = `http://10.4.237.10:81/macro/${encodeURIComponent(wbn)}`;

          const res3 = await fetch(macroUrl, {
            method: "GET",
            headers: {
              Accept: "text",
              Connection: "keep-alive",
            }
          });

          const text = await res3.text(); // API returns TEXT

          macroResponse = text;
          console.log(macroResponse);
          macroSuccess = res3.status === 200;

        } catch (e) {
          macroResponse = `ERROR: ${e.message}`;
        }

        await client.query(
          `UPDATE sorter_audit_log
           SET macro_status = $1,
               macro_response = $2,
               macro_sent_at = NOW()
           WHERE id = $3`,
          [macroSuccess, macroResponse, sorter_id]
        );

        /**************************************
         5️⃣ GI API
        **************************************/
        let giSuccess = false;
        let giResponse = null;

        const giPayload = {
          center: `${s.center_name} (${s.state})`,
          ref_ids: [wbn],
          large: "false",
        };

        if (s.gi_api === true && s.weight_api_token) {
          try {
            const giRes = await fetch(
              "https://track.delhivery.com/api/mob-loc/mi/",
              {
                method: "POST",
                headers: {
                  Authorization: s.weight_api_token,
                  Accept: "application/json",
                  Application: "SORTER",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(giPayload),
                timeout: 5000,
              }
            );


            giResponse = await giRes.json().catch(() => ({}));
            giSuccess = giRes.status === 200;

          } catch (e) {
            giResponse = { error: e.message };
          }

          await client.query(
            `UPDATE sorter_audit_log
             SET gi_status = $1,
                 gi_payload = $2,
                 gi_response = $3,
                 gi_sent_at = NOW()
             WHERE id = $4`,
            [giSuccess, giPayload, giResponse, sorter_id]
          );
        }

        /**************************************
         6️⃣ WEIGHT API
        **************************************/
        let weightSuccess = false;
        let weightResponse = null;

        const weightPayload = {
          wbn: wbn,
          l: b.length.toString(),
          b: b.width.toString(),     // ✅ width instead of breadth
          h: b.height.toString(),
          wt: b.weight.toString(),
          v: b.volume?.toString(),
          rv: b.real_volume?.toString(),
        };
        if (s.weight_api === true && s.weight_api_token) {
          try {
            const wRes = await fetch(
              "https://track.delhivery.com/api/p/update/",
              {
                method: "POST",
                headers: {
                  Authorization: s.weight_api_token,
                  Accept: "application/json",
                  Application: "SORTER",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(weightPayload),
                timeout: 5000,
              }

            );


            weightResponse = await wRes.json().catch(() => ({}));
            weightSuccess =
              wRes.status === 200 &&
              weightResponse?.success === true;

          } catch (e) {
            weightResponse = { error: e.message };
          }

          await client.query(
            `UPDATE sorter_audit_log
             SET weight_status = $1,
                 weight_payload = $2,
                 weight_response = $3,
                 weight_sent_at = NOW()
             WHERE id = $4`,
            [weightSuccess, weightPayload, weightResponse, sorter_id]
          );
        }


        /**************************************
         7️⃣ S3 IMAGE UPLOAD (NON-BLOCKING)
        **************************************/
        let s3Status = false;
        let s3Path = "";

        try {
          const image = await loadImage(`http://127.0.0.1:5001${b.imagepath}`);
          const canvas = createCanvas(image.width, image.height);
          const ctx = canvas.getContext("2d");

          ctx.drawImage(image, 0, 0, image.width, image.height);

          const ist = moment().tz("Asia/Kolkata");

          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(0, 0, canvas.width, 160);

          ctx.fillStyle = "#00FF00";
          ctx.font = "18px monospace";

          ctx.fillText(`AWB: ${wbn}`, 10, 30);
          ctx.fillText(`Dimensions: ${b.length} x ${b.width} x ${b.height} cm`, 10, 60);
          ctx.fillText(`Weight: ${b.weight} gm`, 10, 90);
          ctx.fillText(`Real Volume: ${b.real_volume}`, 10, 120);
          ctx.fillText(`Profiler ID: ${s.machine_username}`, 10, 150);
          ctx.fillText(`Center: ${sorterLoc}`, 10, 180);

          const buffer = canvas.toBuffer("image/jpeg");

          const filename = `${wbn}-${ist.format("YYYY_MM_DD-HH_mm_ss")}.jpg`;

          const folder =
            `profiler/mechatronics/${s.center_name} (${s.state})/` +
            `${ist.year()}/${ist.month() + 1}/${ist.date()}`;

          const key = `${folder}/${filename}`;

          const s3 = new S3Client({
            region: "ap-south-1",
            credentials: {
              accessKeyId: s.access_key_id,
              secretAccessKey: s.secret_access_key,
            }
          });

          await s3.send(new PutObjectCommand({
            Bucket: s.bucket_name,
            Key: key,
            Body: buffer,
            ContentType: "image/jpeg"
          }));

          s3Status = true;
          s3Path = `s3://${s.bucket_name}/${key}`;

        } catch (err) {
          console.log("s3 upload failed:", err.message);
        }

        await client.query(
          `UPDATE sorter_audit_log
           SET image_status = $1,
               s3_path = $2,
               image_uploaded_at = NOW()
           WHERE id = $3`,
          [s3Status, s3Path, sorter_id]
        );

        return {
          primarySuccess,
          s3Status,
          wbn,
          bag_code,
          tracking_id
        };

      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: 3
    }
  );

  console.log("⚙ Primary + Macro/GI/Weight + S3 Worker started (QUEUE SAFE)");
});