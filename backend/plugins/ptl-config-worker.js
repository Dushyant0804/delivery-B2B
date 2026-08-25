// plugins/ptl-config-worker.js
const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const fs = require("fs");
const { parse } = require("csv-parse");
const IORedis = require("ioredis");

// ------------------------
// PTL Normalizer
// ------------------------
function normalizePTL(ptl) {
  if (!ptl) return "";
  return ptl
    .toString()
    .normalize("NFKD")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^'+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\d]/g, "")
    .trim()
    .padStart(4, "0");
}

// ------------------------
// Bay ID — first two digits of the normalized (4-digit) PTL.
// e.g. 3202 -> "32", 82 -> "0082" -> "00", 815 -> "0815" -> "08"
// ------------------------
function bayIdFromPtl(normalizedPtl) {
  return normalizedPtl.slice(0, 2);
}

// ------------------------
// Header Cleaner
// ✔ KEEP UNDERSCORES
// ✔ REMOVE ZERO-WIDTH
// ✔ TRIM
// ✔ UPPERCASE
// ------------------------
function cleanHeader(h) {
  return h
    .normalize("NFKD")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

module.exports = fp(async function ptlWorkerPlugin(fastify) {
  const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
  });

  new Worker(
    "ptlConfigQueue",
    async (job) => {
      const { configId, filePath } = job.data;

      const client = await fastify.pg.connect();

      try {
        await client.query("BEGIN");

        // -------------------------------------------------------
        // Load bag_mappings from DB
        // ptl_id (scalar) was replaced by ptl_ids (array); REGULAR and
        // DIRECT both route by PTL the same way, so both feed ptlToBag.
        // -------------------------------------------------------
        const bm = await client.query(`
          SELECT bag_code, type, ptl_ids, rejection_codes
          FROM bag_mappings
        `);

        const ptlToBag = {};
        const rejectedBag = {};

        for (const m of bm.rows) {
          const type = (m.type || "").toUpperCase().trim();

          if ((type === "REGULAR" || type === "DIRECT") && Array.isArray(m.ptl_ids)) {
            for (const rawId of m.ptl_ids) {
              const norm = normalizePTL(rawId);
              ptlToBag[norm] = m.bag_code;
            }
          }

          if (type === "REJECTED") {
            rejectedBag[m.bag_code] = m;
          }
        }

        // -------------------------------------------------------
        // PASS 1 — Collect unique bag meta
        // -------------------------------------------------------
        const bagMeta = new Map();

        const stream1 = fs
          .createReadStream(filePath)
          .pipe(
            parse({
              trim: true,
              skip_empty_lines: true,
              columns: (header) => header.map(cleanHeader),
            })
          );

        for await (const row of stream1) {
          const ptl = normalizePTL(row["PTL_ID"]);
          if (!ptl) continue;

          const bagCode = ptlToBag[ptl];
          if (!bagCode) continue;

          if (!bagMeta.has(bagCode)) {
            bagMeta.set(bagCode, {
              priority: row["PRIORITY"] || null,
              volume: row["VOLUME"] || null,
              cutoffRaw: row["PTL_CUTOFF_TIME"] || null,
              bagType: row["BAG_TYPE"] || null,
              bagIdentifier: row["BAG_IDENTIFIER"] || null,
            });
          }
        }

        // -------------------------------------------------------
        // Insert into bags table
        // -------------------------------------------------------
        const bagIdMap = new Map();

        for (const [bagCode, meta] of bagMeta.entries()) {
          let cutoffArr = null;

          if (meta.cutoffRaw) {
            const parts = meta.cutoffRaw.split(";").filter(Boolean);
            const formatted = parts.map((t) => `${t.slice(0, 2)}:${t.slice(2, 4)}`);
            cutoffArr = `{${formatted.join(",")}}`;
          }

          const res = await client.query(
            `INSERT INTO bags
              (config_id, bag_code, priority, volume, cutoff_times_raw, cutoff_times, bagtype, bagidentifier)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
              configId,
              bagCode,
              meta.priority,
              meta.volume,
              meta.cutoffRaw,
              cutoffArr,
              meta.bagType,
              meta.bagIdentifier,
            ]
          );

          bagIdMap.set(bagCode, res.rows[0].id);
        }

        // -------------------------------------------------------
        // PASS 2 — Insert bag_rules
        // -------------------------------------------------------
        const stream2 = fs
          .createReadStream(filePath)
          .pipe(
            parse({
              trim: true,
              skip_empty_lines: true,
              columns: (header) => header.map(cleanHeader),
            })
          );

        for await (const row of stream2) {
          const ptl = normalizePTL(row["PTL_ID"]);
          if (!ptl) continue;

          const bagCode = ptlToBag[ptl];
          if (!bagCode) continue;

          const bayId = bayIdFromPtl(ptl);

          await client.query(
            `INSERT INTO bag_rules
              (config_id, bag_id, ptl_id, bay_id, cn, cn_branch_code, client, mot, bag_identifier)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              configId,
              bagIdMap.get(bagCode),
              ptl,
              bayId,
              row["NDC_CODE"] || null,
              row["MAPPED_NDC_CODE"] || null,
              row["CLIENT"] || null,
              row["MODE"] || null,
              row["BAG_IDENTIFIER"] || null,
            ]
          );
        }

        // -------------------------------------------------------
        // Mark config READY
        // -------------------------------------------------------
        await client.query(
          `UPDATE sorter_configs
           SET status='READY', error_message=NULL
           WHERE id=$1`,
          [configId]
        );

        await client.query("COMMIT");
        console.log("🎉 PTL Import Completed Successfully:", configId);

      } catch (err) {
        await client.query("ROLLBACK");

        await client.query(
          `UPDATE sorter_configs
           SET status='ERROR', error_message=$2
           WHERE id=$1`,
          [configId, err.message]
        );

        console.error("❌ PTL Worker FAILED:", err.message);

      } finally {
        client.release();
        // ❗ DO NOT DELETE FILE — needed for VIEW / DOWNLOAD
      }
    },
    {
      connection,
      concurrency: 1,
    }
  );

  console.log("⚙ PTL Config Worker started");
});