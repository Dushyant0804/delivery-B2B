const path = require("path");
const fs = require("fs");

async function ptlDownloadRoute(fastify, opts) {
  fastify.get("/configs/ptl/:id/download", async (request, reply) => {
    try {
      const id = Number(request.params.id);

      if (!id) {
        return reply.code(400).send({ error: "Invalid config id" });
      }

      const { rows } = await fastify.pg.query(
        `SELECT file_path, original_filename FROM sorter_configs WHERE id=$1`,
        [id]
      );

      if (!rows.length || !rows[0].file_path) {
        return reply.code(404).send({ error: "File path not found in database" });
      }

      const filePath = rows[0].file_path;

      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({
          error: "File missing on server. Please re-upload the config.",
        });
      }

      const fileName = path.basename(filePath);

      // ✅ Redirect to static served file
      return reply.redirect(`/config-files/${encodeURIComponent(fileName)}`);

    } catch (err) {
      console.log(err)
      fastify.log.error("PTL Download Error:", err);
      return reply.code(500).send({ error: "Failed to download file" });
    }
  });
}

module.exports = ptlDownloadRoute;
