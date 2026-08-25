const path = require("path");
const fs = require("fs");

async function sampleConfigDownloadRoute(fastify) {
  fastify.get("/configs/ptl/sample/download", async (req, reply) => {
    try {
      const filePath = path.join(
        process.cwd(),
        "configfiles",
        "sample_csv.csv"
      );

      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({
          error: "Sample CSV file not found on server",
        });
      }

      reply.header("Content-Type", "text/csv");
      reply.header(
        "Content-Disposition",
        'attachment; filename="sample_csv.csv"'
      );

      return reply.send(fs.createReadStream(filePath));
    } catch (err) {
      fastify.log.error("Sample CSV Download Error:", err);
      return reply.code(500).send({
        error: "Failed to download sample CSV",
      });
    }
  });
}

module.exports = sampleConfigDownloadRoute;
