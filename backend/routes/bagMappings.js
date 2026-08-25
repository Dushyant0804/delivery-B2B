// routes/bagMappings.js

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const IORedis = require("ioredis");

const redis = new IORedis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
});

// Deletes chute:{bag_code} live-counter hashes so a manual WBN clear
// doesn't leave sortEngine.js's Redis-backed chute-full check stuck
// thinking a bag is still full after it's been physically emptied.
async function clearChuteKeys(bagCode) {
  try {
    if (bagCode) {
      await redis.del(`chute:${bagCode}`);
      return;
    }
    // No bagCode = clear all chute:* keys (clear-all-wbns), via SCAN
    // rather than KEYS so this never blocks Redis on a large keyspace.
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "chute:*", "COUNT", 200);
      cursor = nextCursor;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    console.error("❌ clearChuteKeys failed:", err);
  }
}

const allowedTypes = ["REGULAR", "DIRECT", "REJECTED"];
// REGULAR and DIRECT both store PTL bindings in ptl_ids and share one
// global-uniqueness pool for PTL IDs — only REJECTED is a separate pool.
const ptlTypes = ["REGULAR", "DIRECT"];
const allowedRejectionCodes = [
  "DBO", "IBO", "MSE", "NDIM_UD", "NDIM_OD",
  "UK", "MR", "DNF", "UNX", "HV",
  "REJ", "NSZ", "AR", "LMM", "DUP", "API_FAIL", "CHUTE_FULL"
];

function isValidBagCode(code) {
  return /^D\d{3}$/.test(code) || /^R\d{3}$/.test(code);
}

// Normalizes a single PTL id: strips non-digits, left-pads to 4 digits.
// Returns null for anything that isn't a usable numeric id.
function normalizePtlId(ptlId) {
  if (ptlId == null) return null;
  const digits = String(ptlId).trim().replace(/[^\d]/g, "");
  if (!digits) return null;
  return digits.padStart(4, "0");
}

// Accepts either an array of ptl ids or a single value (string/number) for
// convenience, normalizes each entry, and dedupes. Returns null on any
// invalid entry so the caller can reject with a clear message.
function normalizePtlIdList(input) {
  if (input == null) return null;

  const rawList = Array.isArray(input) ? input : [input];
  if (rawList.length === 0) return null;

  const clean = [];
  for (const raw of rawList) {
    const norm = normalizePtlId(raw);
    if (!norm) return null; // signal invalid entry
    if (!clean.includes(norm)) clean.push(norm);
  }

  return clean.length ? clean : null;
}

async function bagMappingsRoutes(fastify, opts) {
  const pool = fastify.pg;

  // ----------------------------------------------------
  // GET all mappings
  // ----------------------------------------------------
  fastify.get("/bag-mappings", async (req, reply) => {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(Math.min(parseInt(limit, 10) || 100, 500), 1);
    const offset = (pageNum - 1) * limitNum;

    const countRes = await pool.query(`SELECT count(*)::int AS total FROM bag_mappings`);
    const total = countRes.rows[0].total;

    const { rows } = await pool.query(
      `
      SELECT id, bag_code, type, ptl_ids, rejection_codes, updated_at
      FROM bag_mappings
      ORDER BY updated_at DESC, id DESC
      LIMIT $1 OFFSET $2
      `,
      [limitNum, offset]
    );

    return reply.send({
      success: true,
      page: pageNum,
      limit: limitNum,
      total,
      rows
    });
  });

  // ----------------------------------------------------
  // POST create new mapping
  // ----------------------------------------------------
  fastify.post("/bag-mappings", async (req, reply) => {
    // Accepts either `ptl_ids: [...]` or a single `ptl_id`/`ptl_ids` value
    // for manual single-entry convenience.
    const { bag_code, type, ptl_id, ptl_ids, rejection_codes } = req.body || {};

    // Bag code validation
    if (!bag_code || !isValidBagCode(bag_code)) {
      return reply.code(400).send({ success: false, error: "Invalid bag_code. Expected D001.." });
    }

    const bagCode = bag_code.toUpperCase();
    const t = String(type || "").toUpperCase();

    if (!allowedTypes.includes(t)) {
      return reply.code(400).send({ success: false, error: "Invalid type. Must be REGULAR or REJECTED." });
    }

    // Check if bag_code already exists with ANY type
    const exists = await pool.query(
      `SELECT id, type FROM bag_mappings WHERE bag_code=$1`,
      [bagCode]
    );
    if (exists.rows.length > 0) {
      return reply.code(400).send({
        success: false,
        error: `Bag ${bagCode} is already configured as ${exists.rows[0].type}.`
      });
    }

    // Prepare values
    let finalPtlIds = null;
    let finalRejCodes = null;

    if (ptlTypes.includes(t)) {
      finalPtlIds = normalizePtlIdList(ptl_ids ?? ptl_id);
      if (!finalPtlIds) {
        return reply.code(400).send({ success: false, error: `ptl_ids is required for ${t} type and must contain only numeric PTL IDs.` });
      }

      // ptl_ids must be unique across REGULAR + DIRECT bags combined
      const ptlExists = await pool.query(
        `SELECT bag_code FROM bag_mappings WHERE type = ANY($2::text[]) AND ptl_ids && $1::text[]`,
        [finalPtlIds, ptlTypes]
      );
      if (ptlExists.rows.length > 0) {
        return reply.code(400).send({
          success: false,
          error: `One or more PTL IDs are already assigned to bag ${ptlExists.rows[0].bag_code}.`
        });
      }
    }

    if (t === "REJECTED") {
      if (!Array.isArray(rejection_codes) || rejection_codes.length === 0) {
        return reply.code(400).send({ success: false, error: "REJECTED type requires rejection_codes." });
      }

      const cleanCodes = rejection_codes
        .map(c => String(c).toUpperCase().trim())
        .filter(Boolean);

      // Validate allowed codes
      for (const c of cleanCodes) {
        if (!allowedRejectionCodes.includes(c)) {
          return reply.code(400).send({ success: false, error: `Invalid rejection code: ${c}` });
        }
      }

      // Ensure these codes are unused anywhere else
      const conflict = await pool.query(
        `
        SELECT bag_code, rejection_codes
        FROM bag_mappings
        WHERE type='REJECTED'
          AND rejection_codes && $1::text[]
        `,
        [cleanCodes]
      );

      if (conflict.rows.length > 0) {
        return reply.code(400).send({
          success: false,
          error: `Rejection code(s) ${cleanCodes.join(", ")} already used by bag ${conflict.rows[0].bag_code}.`
        });
      }

      finalRejCodes = cleanCodes;
    }

    // Insert
    try {
      const { rows } = await pool.query(
        `
        INSERT INTO bag_mappings (bag_code, type, ptl_ids, rejection_codes, updated_at)
        VALUES ($1,$2,$3,$4,NOW())
        RETURNING *
        `,
        [bagCode, t, finalPtlIds, finalRejCodes]
      );

      return reply.code(201).send({ success: true, row: rows[0] });
    } catch (err) {
      fastify.log.error("bag-mappings POST error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------
  // PUT update mapping (STRICT RULES)
  // ----------------------------------------------------
  fastify.put("/bag-mappings/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) return reply.code(400).send({ success: false, error: "Invalid id." });

    const { bag_code, type, ptl_id, ptl_ids, rejection_codes } = req.body || {};

    // Load existing row
    const current = await pool.query(
      `SELECT * FROM bag_mappings WHERE id=$1`,
      [id]
    );
    if (current.rows.length === 0) {
      return reply.code(404).send({ success: false, error: "Row not found." });
    }

    const row = current.rows[0];
    // ❌ BLOCK EDIT IF BAG HAS PARCELS
    if (row.wbns && row.wbns.length > 0) {
      return reply.code(409).send({
        success: false,
        error: `Cannot edit bag ${row.bag_code}. It currently contains ${row.wbns.length} parcel(s).`
      });
    }

    // bag_code cannot change
    if (row.bag_code !== bag_code.toUpperCase()) {
      return reply.code(400).send({
        success: false,
        error: "bag_code cannot be changed once created."
      });
    }

    // type: REGULAR <-> DIRECT swaps are allowed (identical storage shape).
    // Anything involving REJECTED must stay locked — switching would mean
    // discarding ptl_ids for rejection_codes or vice versa.
    const newType = String(type || "").toUpperCase();
    const oldType = row.type;
    const typeChanging = oldType !== newType;

    if (typeChanging) {
      const bothPtlTypes = ptlTypes.includes(oldType) && ptlTypes.includes(newType);
      if (!bothPtlTypes) {
        return reply.code(400).send({
          success: false,
          error: "Only switching between REGULAR and DIRECT is allowed. A bag can't change to/from REJECTED."
        });
      }
    }

    let finalPtlIds = null;
    let finalRejCodes = null;

    // REGULAR / DIRECT update
    if (ptlTypes.includes(newType)) {
      finalPtlIds = normalizePtlIdList(ptl_ids ?? ptl_id);
      if (!finalPtlIds) {
        return reply.code(400).send({
          success: false,
          error: `ptl_ids is required for ${newType} type and must contain only numeric PTL IDs.`
        });
      }

      // Unique PTL validation across REGULAR + DIRECT bags (excluding this row)
      const ptlExists = await pool.query(
        `
        SELECT bag_code FROM bag_mappings
        WHERE type = ANY($3::text[]) AND id <> $2 AND ptl_ids && $1::text[]
        `,
        [finalPtlIds, id, ptlTypes]
      );
      if (ptlExists.rows.length > 0) {
        return reply.code(400).send({
          success: false,
          error: `One or more PTL IDs already used by bag ${ptlExists.rows[0].bag_code}.`
        });
      }
    }

    // REJECTED update
    if (newType === "REJECTED") {
      if (!Array.isArray(rejection_codes) || rejection_codes.length === 0) {
        return reply.code(400).send({
          success: false,
          error: "rejection_codes required for REJECTED type."
        });
      }

      const cleanCodes = rejection_codes
        .map(c => String(c).toUpperCase().trim())
        .filter(Boolean);

      // Validate codes
      for (const c of cleanCodes) {
        if (!allowedRejectionCodes.includes(c)) {
          return reply.code(400).send({
            success: false,
            error: `Invalid rejection code: ${c}`
          });
        }
      }

      // Ensure unique globally (excluding this row)
      const conflict = await pool.query(
        `
        SELECT bag_code FROM bag_mappings
        WHERE type='REJECTED'
          AND id <> $2
          AND rejection_codes && $1::text[]
        `,
        [cleanCodes, id]
      );

      if (conflict.rows.length > 0) {
        return reply.code(400).send({
          success: false,
          error: `Rejection code(s) ${cleanCodes.join(", ")} already used by bag ${conflict.rows[0].bag_code}.`
        });
      }

      finalRejCodes = cleanCodes;
    }

    // Update row
    try {
      const { rows } = await pool.query(
        `
        UPDATE bag_mappings
        SET type=$1, ptl_ids=$2, rejection_codes=$3, updated_at=NOW()
        WHERE id=$4
        RETURNING *
        `,
        [newType, finalPtlIds, finalRejCodes, id]
      );

      return reply.send({ success: true, row: rows[0] });
    } catch (err) {
      fastify.log.error("bag-mappings PUT error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------
  // GET sample CSV for the bulk bag-mapping upload
  // Expects sample_ptl_mapping.csv to live in the same
  // configfiles folder as the PTL config sample.
  // ----------------------------------------------------
  fastify.get("/bag-mappings/sample/download", async (req, reply) => {
    const filePath = path.join(process.cwd(), "configfiles", "sample_ptl_mapping.csv");

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: "Sample file not found" });
    }

    reply.header("Content-Disposition", `attachment; filename="sample_ptl_mapping.csv"`);
    reply.type("text/csv");
    return reply.send(fs.createReadStream(filePath));
  });

  // ----------------------------------------------------
  // POST bulk-create/merge bag mappings via CSV
  // Columns (header names, any order): BAG_CODE, TYPE, PTL_ID
  // TYPE: Regular / Direct -> REGULAR (goes into ptl_ids)
  //       Rejection        -> REJECTED (goes into rejection_codes)
  //
  // The WHOLE file is rejected (nothing written) if:
  //   - a bag_code appears under more than one type in the file
  //   - a bag_code already exists in the DB under a different type
  //   - a PTL_ID / rejection code collides with a different bag_code,
  //     either within the file or already in the DB
  //
  // Otherwise: bag_codes that already exist get new PTL_IDs / codes
  // merged in (deduped); bag_codes that don't exist yet get created.
  // ----------------------------------------------------
  fastify.post("/bag-mappings/upload-csv", async (req, reply) => {
    const file = await req.file();

    if (!file) {
      return reply.code(400).send({ success: false, error: "CSV file is required" });
    }
    if (!file.mimetype.includes("csv")) {
      return reply.code(415).send({ success: false, error: "Only CSV files are allowed" });
    }

    const buffer = await file.toBuffer();

    // ---------------- Parse CSV ----------------
    const EXPECTED_HEADERS = ["BAG_CODE", "TYPE", "PTL_ID"];
    const rows = [];
    let detectedHeaders = [];

    try {
      await new Promise((resolve, reject) => {
        parse(buffer, {
          trim: true,
          skip_empty_lines: true,
          columns: (headerRow) => {
            detectedHeaders = headerRow.map((h) =>
              String(h)
                .normalize("NFKD")
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .trim()
                .toUpperCase()
            );
            for (const h of EXPECTED_HEADERS) {
              if (!detectedHeaders.includes(h)) {
                return reject(new Error(`Missing required column: ${h}`));
              }
            }
            return detectedHeaders;
          },
        })
          .on("data", (row) => rows.push(row))
          .on("end", resolve)
          .on("error", reject);
      });
    } catch (err) {
      return reply.code(422).send({
        success: false,
        status: "ERROR",
        message: "CSV header validation failed",
        reason: err.message,
        expectedHeaders: EXPECTED_HEADERS,
        detectedHeaders,
      });
    }

    // ---------------- Row-level parse + normalize ----------------
    const validationErrors = [];
    // bagCode -> { type, values: Set<string>, rows: number[] }
    const groups = new Map();
    // value -> bagCode, catches a PTL_ID / rejection code claimed by two
    // different bag_codes within this same file
    const valueOwner = new Map();

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;

      const bagCodeRaw = row["BAG_CODE"];
      const typeRaw = String(row["TYPE"] || "").trim().toLowerCase();
      const valueRaw = row["PTL_ID"];

      const bagCode = String(bagCodeRaw || "").trim().toUpperCase();
      if (!bagCode || !isValidBagCode(bagCode)) {
        validationErrors.push({ row: rowNum, field: "BAG_CODE", value: bagCodeRaw, message: `Invalid BAG_CODE "${bagCodeRaw}"` });
        return;
      }

      let type;
      if (typeRaw === "regular") type = "REGULAR";
      else if (typeRaw === "direct") type = "DIRECT";
      else if (typeRaw === "rejection" || typeRaw === "rejected") type = "REJECTED";
      else {
        validationErrors.push({ row: rowNum, field: "TYPE", value: typeRaw, message: `Invalid TYPE "${typeRaw}". Expected Regular, Direct, or Rejection.` });
        return;
      }

      let value;
      if (ptlTypes.includes(type)) {
        value = normalizePtlId(valueRaw);
        if (!value) {
          validationErrors.push({ row: rowNum, field: "PTL_ID", value: valueRaw, message: `Invalid PTL_ID "${valueRaw}"` });
          return;
        }
      } else {
        value = String(valueRaw || "").trim().toUpperCase();
        if (!allowedRejectionCodes.includes(value)) {
          validationErrors.push({ row: rowNum, field: "PTL_ID", value: valueRaw, message: `Invalid rejection code "${valueRaw}"` });
          return;
        }
      }

      // Mixed-type conflict for the same bag_code within this file
      const existingGroup = groups.get(bagCode);
      if (existingGroup && existingGroup.type !== type) {
        validationErrors.push({
          row: rowNum,
          field: "TYPE",
          value: typeRaw,
          message: `Bag ${bagCode} appears as both ${existingGroup.type} and ${type} in this file. A bag must be one or the other.`,
        });
        return;
      }

      // Value claimed by a different bag_code within this file
      const owner = valueOwner.get(value);
      if (owner && owner !== bagCode) {
        validationErrors.push({
          row: rowNum,
          field: "PTL_ID",
          value: valueRaw,
          message: `"${value}" is already assigned to bag ${owner} earlier in this file.`,
        });
        return;
      }
      valueOwner.set(value, bagCode);

      if (!existingGroup) {
        groups.set(bagCode, { type, values: new Set([value]), rows: [rowNum] });
      } else {
        existingGroup.values.add(value);
        existingGroup.rows.push(rowNum);
      }
    });

    if (validationErrors.length > 0) {
      return reply.code(422).send({
        success: false,
        status: "ERROR",
        message: "CSV validation failed",
        errors: validationErrors,
      });
    }

    // ---------------- Cross-check against existing DB rows ----------------
    const existingRes = await pool.query(
      `SELECT bag_code, type, ptl_ids, rejection_codes FROM bag_mappings`
    );
    const existingByBagCode = new Map(existingRes.rows.map((r) => [r.bag_code, r]));

    for (const [bagCode, group] of groups.entries()) {
      const existing = existingByBagCode.get(bagCode);

      if (existing && existing.type !== group.type) {
        validationErrors.push({
          row: group.rows[0],
          field: "TYPE",
          value: bagCode,
          message: `Bag ${bagCode} is already configured as ${existing.type} in the system.`,
        });
        continue;
      }

      const newValues = [...group.values];

      if (ptlTypes.includes(group.type)) {
        const conflict = await pool.query(
          `SELECT bag_code FROM bag_mappings WHERE type = ANY($3::text[]) AND bag_code <> $2 AND ptl_ids && $1::text[]`,
          [newValues, bagCode, ptlTypes]
        );
        if (conflict.rows.length > 0) {
          validationErrors.push({
            row: group.rows[0],
            field: "PTL_ID",
            value: newValues.join(","),
            message: `One or more PTL IDs for bag ${bagCode} are already assigned to bag ${conflict.rows[0].bag_code}.`,
          });
        }
      } else {
        const conflict = await pool.query(
          `SELECT bag_code FROM bag_mappings WHERE type='REJECTED' AND bag_code <> $2 AND rejection_codes && $1::text[]`,
          [newValues, bagCode]
        );
        if (conflict.rows.length > 0) {
          validationErrors.push({
            row: group.rows[0],
            field: "PTL_ID",
            value: newValues.join(","),
            message: `One or more rejection codes for bag ${bagCode} are already assigned to bag ${conflict.rows[0].bag_code}.`,
          });
        }
      }
    }

    if (validationErrors.length > 0) {
      return reply.code(422).send({
        success: false,
        status: "ERROR",
        message: "CSV validation failed against existing bag mappings",
        errors: validationErrors,
      });
    }

    // ---------------- All clear — upsert ----------------
    const client = await pool.connect();
    let created = 0;
    let updated = 0;

    try {
      await client.query("BEGIN");

      for (const [bagCode, group] of groups.entries()) {
        const existing = existingByBagCode.get(bagCode);
        const newValues = [...group.values];

        if (existing) {
          if (ptlTypes.includes(group.type)) {
            const merged = Array.from(new Set([...(existing.ptl_ids || []), ...newValues]));
            await client.query(
              `UPDATE bag_mappings SET ptl_ids=$1, updated_at=NOW() WHERE bag_code=$2`,
              [merged, bagCode]
            );
          } else {
            const merged = Array.from(new Set([...(existing.rejection_codes || []), ...newValues]));
            await client.query(
              `UPDATE bag_mappings SET rejection_codes=$1, updated_at=NOW() WHERE bag_code=$2`,
              [merged, bagCode]
            );
          }
          updated++;
        } else {
          if (ptlTypes.includes(group.type)) {
            await client.query(
              `INSERT INTO bag_mappings (bag_code, type, ptl_ids, rejection_codes, updated_at) VALUES ($1,$2,$3,NULL,NOW())`,
              [bagCode, group.type, newValues]
            );
          } else {
            await client.query(
              `INSERT INTO bag_mappings (bag_code, type, ptl_ids, rejection_codes, updated_at) VALUES ($1,'REJECTED',NULL,$2,NOW())`,
              [bagCode, newValues]
            );
          }
          created++;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      fastify.log.error("bag-mappings upload-csv error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }

    return reply.send({
      success: true,
      message: `Processed ${groups.size} bag(s): ${created} created, ${updated} updated.`,
      created,
      updated,
    });
  });

  // ----------------------------------------------------
  // DELETE mapping
  // ----------------------------------------------------
  fastify.delete("/bag-mappings/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) {
      return reply.code(400).send({ success: false, error: "Invalid id." });
    }

    // 1️⃣ Load bag mapping
    const bm = await pool.query(
      `SELECT bag_code, wbns FROM bag_mappings WHERE id=$1`,
      [id]
    );

    if (bm.rows.length === 0) {
      return reply.code(404).send({ success: false, error: "Bag not found." });
    }

    const { bag_code, wbns } = bm.rows[0];

    // ❌ BLOCK DELETE IF PARCELS EXIST
    if (wbns && wbns.length > 0) {
      return reply.code(409).send({
        success: false,
        error: `Cannot delete bag ${bag_code}. It contains ${wbns.length} parcel(s).`
      });
    }

    // 2️⃣ BLOCK DELETE IF USED IN ANY CONFIG
    const used = await pool.query(
      `SELECT 1 FROM bags WHERE bag_code=$1 LIMIT 1`,
      [bag_code]
    );

    if (used.rowCount > 0) {
      return reply.code(409).send({
        success: false,
        error: `Cannot delete bag ${bag_code}. It is used in one or more configurations.`
      });
    }

    // 3️⃣ SAFE TO DELETE
    await pool.query(`DELETE FROM bag_mappings WHERE id=$1`, [id]);

    return reply.send({ success: true });
  });


  // GET WBN list for a specific bag_code
  fastify.get("/bag-mappings/bag-wbns/:bag_code", async (req, reply) => {
    try {
      const bagCode = String(req.params.bag_code || "").toUpperCase();

      if (!/^D\d{3}$/.test(bagCode)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag_code format. Expected: D001, D050, D099"
        });
      }

      const { rows } = await fastify.pg.query(
        `
      SELECT 
        id,
        bag_code,
        type,
        ptl_ids,
        rejection_codes,
        COALESCE(wbns, '{}') AS wbns,
        updated_at
      FROM bag_mappings
      WHERE bag_code = $1
      LIMIT 1
      `,
        [bagCode]
      );

      if (rows.length === 0) {
        return reply.code(404).send({
          success: false,
          error: `Bag ${bagCode} not found`
        });
      }

      return reply.send({
        success: true,
        bag: {
          id: rows[0].id,
          bag_code: rows[0].bag_code,
          type: rows[0].type,
          ptl_ids: rows[0].ptl_ids,
          rejection_codes: rows[0].rejection_codes,
          wbns: rows[0].wbns,
          updated_at: rows[0].updated_at
        }
      });

    } catch (err) {
      fastify.log.error("GET /bag-wbns/:bag_code error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message
      });
    }
  });

  // REMOVE WBN from a bag
  fastify.post("/bag-mappings/remove-wbn", async (req, reply) => {
    try {
      const { bag_code, wbn } = req.body || {};

      if (!bag_code || !/^D\d{3}$/.test(bag_code)) {
        return reply.code(400).send({ success: false, error: "Invalid bag_code" });
      }
      if (!wbn) {
        return reply.code(400).send({ success: false, error: "WBN is required" });
      }

      // Check bag exists
      const res = await fastify.pg.query(
        `SELECT wbns FROM bag_mappings WHERE bag_code=$1 LIMIT 1`,
        [bag_code]
      );

      if (res.rows.length === 0) {
        return reply.code(404).send({ success: false, error: "Bag not found" });
      }

      const wbns = res.rows[0].wbns || [];
      if (!wbns.includes(wbn)) {
        return reply.code(400).send({
          success: false,
          error: `WBN ${wbn} not found inside bag ${bag_code}`,
        });
      }

      // Remove WBN
      const updated = wbns.filter((x) => x !== wbn);

      await fastify.pg.query(
        `UPDATE bag_mappings SET wbns=$1, updated_at=NOW() WHERE bag_code=$2`,
        [updated, bag_code]
      );

      return reply.send({
        success: true,
        message: `WBN ${wbn} removed from ${bag_code}`,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  fastify.post("/bag-mappings/add-wbn", async (req, reply) => {
    const { bag_code, wbn } = req.body || {};

    if (!bag_code || !/^D\d{3}$/.test(bag_code)) {
      return reply.code(400).send({ error: "Invalid bag code" });
    }

    if (!wbn) {
      return reply.code(400).send({ error: "Invalid WBN" });
    }

    const res = await fastify.pg.query(
      `UPDATE bag_mappings
     SET wbns = array_append(wbns, $1), updated_at = NOW()
     WHERE bag_code=$2
     RETURNING wbns`,
      [wbn, bag_code]
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ error: "Bag not found" });
    }

    return reply.send({ success: true, message: `Added ${wbn} to bag ${bag_code}` });
  });

  fastify.post("/bag-mappings/clear-wbns", async (req, reply) => {
  const { bag_code } = req.body || {};

  if (!bag_code || !/^D\d{3}$/.test(bag_code)) {
    return reply.code(400).send({
      success: false,
      error: "Invalid bag_code",
    });
  }

  // Check bag exists
  const bm = await fastify.pg.query(
    `SELECT id FROM bag_mappings WHERE bag_code=$1`,
    [bag_code]
  );

  if (bm.rowCount === 0) {
    return reply.code(404).send({
      success: false,
      error: "Bag not found",
    });
  }

  // 1️⃣ Clear bag_mappings.wbns
  await fastify.pg.query(
    `
    UPDATE bag_mappings
    SET wbns='{}', updated_at=NOW()
    WHERE bag_code=$1
    `,
    [bag_code]
  );

  // 2️⃣ Clear bags_wbn table
  await fastify.pg.query(
    `
    UPDATE bags_wbn
    SET wbns='{}',
        count=0,
        weight=0,
        realvolume=0,
        first_drop_at=NULL,
        updated_at=NOW()
    WHERE bag_code=$1
    `,
    [bag_code]
  );

  // Redis chute:{bag_code} counter reset — keeps sortEngine.js's live
  // chute-full check honest after an operator physically empties a bag.
  await clearChuteKeys(bag_code);

  return reply.send({
    success: true,
    message: `Cleared all WBNs for bag ${bag_code}`,
  });
});

fastify.post("/bag-mappings/clear-all-wbns", async (req, reply) => {
  try {

    // 1️⃣ Clear all bag_mappings wbns
    await fastify.pg.query(`
      UPDATE bag_mappings
      SET wbns = '{}',
          updated_at = NOW()
    `);

    // 2️⃣ Clear all bags_wbn
    await fastify.pg.query(`
      UPDATE bags_wbn
      SET wbns = '{}',
          count = 0,
          weight = 0,
          realvolume = 0,
          first_drop_at = NULL,
          updated_at = NOW()
    `);

    // 3️⃣ Clear all chute:* Redis counters
    await clearChuteKeys();

    return reply.send({
      success: true,
      message: "All bags cleared successfully"
    });

  } catch (err) {
    fastify.log.error("CLEAR ALL BAGS ERROR:", err);
    return reply.code(500).send({
      success: false,
      error: err.message
    });
  }
});


}



module.exports = bagMappingsRoutes;