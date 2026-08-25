const path = require("path");
const fs = require("fs");
const { parse } = require("csv-parse");
const pump = require("pump");

// ------------------------
// EXPECTED CSV HEADERS (STRICT ORDER)
// ------------------------
const EXPECTED_HEADERS = [
  "NDC_CODE",
  "MAPPED_NDC_CODE",
  "MODE",
  "PRIORITY",
  "VOLUME",
  "CLIENT",
  "BAG_TYPE",
  "BAG_IDENTIFIER",
  "PTL_ID",
  "PTL_CUTOFF_TIME",
];

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
// Header Cleaner
// ------------------------
function cleanHeader(header) {
  return header
    .normalize("NFKD")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

const ptlUploadRoute = (fastify) => {
  fastify.post("/configs/ptl/upload", async (req, reply) => {
    try {
      const file = await req.file();

      if (!file) {
        return reply.code(400).send({
          success: false,
          reason: "CSV file is required",
        });
      }

      if (!file.mimetype.includes("csv")) {
        return reply.code(415).send({
          success: false,
          reason: "Only CSV files are allowed",
        });
      }

      // ---------------------------------------------------
      // SAVE FILE USING STREAM
      // ---------------------------------------------------
      const uploadDir = path.join(process.cwd(), "configfiles");

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const safeName = file.filename.replace(/[^\w.-]/g, "_");
      const fileName = `${Date.now()}-${safeName}`;
      const filePath = path.join(uploadDir, fileName);

      const writeStream = fs.createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        pump(file.file, writeStream, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (!fs.existsSync(filePath)) {
        throw new Error("File save failed");
      }

      // ---------------------------------------------------
      // READ FILE FROM DISK
      // ---------------------------------------------------
      const buffer = fs.readFileSync(filePath);

      // ---------------------------------------------------
      // Load bag mappings
      // ptl_id (scalar) was replaced by ptl_ids (array) — a bag_code can
      // now hold multiple PTL IDs, and REGULAR + DIRECT both route by PTL
      // the same way, so both feed ptlToBag.
      // ---------------------------------------------------
      const bm = await fastify.pg.query(`
        SELECT bag_code, type, ptl_ids
        FROM bag_mappings
      `);

      const ptlToBag = {};
      const rejectedBags = {};

      for (const m of bm.rows) {
        const type = (m.type || "").toUpperCase().trim();

        if ((type === "REGULAR" || type === "DIRECT") && Array.isArray(m.ptl_ids)) {
          for (const rawId of m.ptl_ids) {
            ptlToBag[normalizePTL(rawId)] = m.bag_code;
          }
        }

        if (type === "REJECTED") {
          rejectedBags[m.bag_code] = true;
        }
      }

      // ---------------------------------------------------
      // PARSE CSV + HEADER VALIDATION
      // ---------------------------------------------------
      const rows = [];
      let detectedHeaders = [];

      try {
        await new Promise((resolve, reject) => {
          parse(buffer, {
            trim: true,
            skip_empty_lines: true,
            columns: (headerRow) => {
              detectedHeaders = headerRow.map(cleanHeader);

              // ---- HEADER COUNT CHECK ----
              if (detectedHeaders.length !== EXPECTED_HEADERS.length) {
                return reject(
                  new Error(
                    `Invalid header count. Expected ${EXPECTED_HEADERS.length}, got ${detectedHeaders.length}`
                  )
                );
              }

              // ---- HEADER ORDER + NAME CHECK ----
              for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
                if (detectedHeaders[i] !== EXPECTED_HEADERS[i]) {
                  return reject(
                    new Error(
                      `Header mismatch at column ${i + 1}: expected "${EXPECTED_HEADERS[i]}", got "${detectedHeaders[i]}"`
                    )
                  );
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
        fs.unlinkSync(filePath);

        return reply.code(422).send({
          success: false,
          status: "ERROR",
          message: "CSV header validation failed",
          reason: err.message,
          expectedHeaders: EXPECTED_HEADERS,
          detectedHeaders,
        });
      }

      // ---------------------------------------------------
      // ROW-LEVEL VALIDATION
      // ---------------------------------------------------
      const validationErrors = [];

      rows.forEach((row, index) => {
        const rowNum = index + 2;
        const rawPTL = row["PTL_ID"];
        const ptl = normalizePTL(rawPTL);

        if (!ptl) return;

        if (!ptlToBag[ptl]) {
          validationErrors.push({
            row: rowNum,
            field: "PTL_ID",
            value: rawPTL,
            message: `PTL "${rawPTL}" → "${ptl}" is not mapped in Bag Manager`,
          });
          return;
        }

        const bagCode = ptlToBag[ptl];
        if (rejectedBags[bagCode]) {
          validationErrors.push({
            row: rowNum,
            field: "PTL_ID",
            value: rawPTL,
            message: `PTL "${ptl}" maps to REJECTED bag ${bagCode}`,
          });
        }
      });

      // ---------------------------------------------------
      // STOP IF VALIDATION FAILED
      // ---------------------------------------------------
      if (validationErrors.length > 0) {
        fs.unlinkSync(filePath);

        return reply.code(422).send({
          success: false,
          status: "ERROR",
          errors: validationErrors,
          message: "PTL validation failed",
        });
        
      }

      // ---------------------------------------------------
      // INSERT CONFIG + QUEUE WORKER
      // ---------------------------------------------------
      const result = await fastify.pg.query(
        `
        INSERT INTO sorter_configs
          (name, type, status, file_path, original_filename)
        VALUES ($1, 'PTL', 'PROCESSING', $2, $3)
        RETURNING id
        `,
        [fileName, filePath, file.originalname]
      );

      const configId = result.rows[0].id;

      await fastify.queues.ptlConfigQueue.add("import-csv", {
        configId,
        filePath,
      });

      return reply.send({
        success: true,
        status: "PROCESSING",
        configId,
      });

    } catch (err) {
      console.error("🔥 Upload ERROR:", err);
      return reply.code(500).send({
        success: false,
        reason: err.message,
      });
    }
  });
};

module.exports = ptlUploadRoute;