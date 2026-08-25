const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

async function ptlViewRoute(fastify, opts) {
  fastify.get("/configs/ptl/:id/view", async (request, reply) => {
    try {
      const id = Number(request.params.id);

      if (!id) {
        return reply.code(400).send({
          error: "Invalid config id",
        });
      }

      // -------------------------------------------------
      // Get file path from DB
      // -------------------------------------------------
      const { rows } = await fastify.pg.query(
        `SELECT file_path, original_filename FROM sorter_configs WHERE id=$1`,
        [id]
      );

      if (!rows.length || !rows[0].file_path) {
        return reply.code(404).send({
          error: "Config file not found. Please re-upload the config.",
        });
      }

      const filePath = rows[0].file_path;
      const baseDir = path.join(process.cwd(), "configfiles");

      if (!filePath.startsWith(baseDir)) {
        return reply.code(403).send({
          error: "Invalid file path",
        });
      }

      // -------------------------------------------------
      // Check file exists on disk
      // -------------------------------------------------
      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({
          error: "Config file missing on server. Please re-upload the config.",
        });
      }

      // -------------------------------------------------
      // Read file safely
      // -------------------------------------------------
      const data = fs.readFileSync(filePath);

      if (!data || !data.length) {
        return reply.code(400).send({
          error: "Config file is empty.",
        });
      }

      // -------------------------------------------------
      // Parse CSV (safe)
      // -------------------------------------------------
      let records;
      try {
        records = parse(data, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
          relax_column_count: true,
          trim: true,
        });
      } catch (err) {
        return reply.code(400).send({
          error: "Invalid CSV format. Unable to preview file.",
        });
      }

      if (!records.length) {
        return reply.send({
          totalRows: 0,
          columns: [],
          rows: [],
        });
      }

      // -------------------------------------------------
      // Limit rows for preview (IMPORTANT)
      // -------------------------------------------------
      const MAX_PREVIEW_ROWS = 500;
      const previewRows = records.slice(0, MAX_PREVIEW_ROWS);

      return reply.send({
        totalRows: records.length,
        columns: Object.keys(previewRows[0]),
        rows: previewRows,
      });

    } catch (err) {
      fastify.log.error("PTL View Error:", err);
      return reply.code(500).send({
        error: "Failed to load config preview",
      });
    }
  });
}

module.exports = ptlViewRoute;
