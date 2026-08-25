const fp = require("fastify-plugin");

module.exports = fp(async function regexCachePlugin(fastify) {
  const pool = fastify.pg;

  let barcodeRegexes = [];

  async function reloadRegex() {
    try {
      const res = await pool.query(`
        SELECT barcode_regexes
        FROM settings
        WHERE id = 1
      `);

      const list = res.rows[0]?.barcode_regexes || [];

      barcodeRegexes = list
        .map(r => {
          try {
            return new RegExp(r);
          } catch {
            console.warn("⚠ Invalid regex skipped:", r);
            return null;
          }
        })
        .filter(Boolean);

      console.log(`✅ Loaded ${barcodeRegexes.length} barcode regex`);
    } catch (err) {
      console.error("❌ Failed to load regex:", err.message);
      barcodeRegexes = [];
    }
  }

  function validateWbn(wbn) {
    if (!barcodeRegexes.length) return true; // fail-open (config choice)
    return barcodeRegexes.some(rx => rx.test(wbn));
  }

  fastify.decorate("regexCache", {
    reloadRegex,
    validateWbn,
    _debug: () => barcodeRegexes.map(r => r.source)
  });

  // Initial load
  await reloadRegex();

  // Auto-refresh every 30s (or env-based)
  setInterval(reloadRegex, 30000);
});
