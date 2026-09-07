// plugins/settingsCache.js
const fp = require("fastify-plugin");

module.exports = fp(async function settingsCachePlugin(fastify, opts) {
  const pool = fastify.pg;
  let cachedSettings = {};

  async function loadSettingsFromDB() {
    try {
      const res = await pool.query("SELECT * FROM settings WHERE id = 1 LIMIT 1");
      if (res.rows.length > 0) {
        cachedSettings = res.rows[0];
      }
    } catch (err) {
      fastify.log.error(`❌ Settings background refresh failed: ${err.message}`);
    }
  }

  // 1. Initial load on server boot
  await loadSettingsFromDB();

  // 2. Automatic background timer every 5 seconds
  const interval = setInterval(loadSettingsFromDB, 5000);

  // 3. Getter returns memory reference directly (ultra fast)
  function getSettings() {
    return cachedSettings;
  }

  // 4. Force instant refresh (for PUT/POST settings routes)
  async function refreshSettings() {
    await loadSettingsFromDB();
    return cachedSettings;
  }

  fastify.decorate("getSettings", getSettings);
  fastify.decorate("refreshSettings", refreshSettings);

  // Clean up timer on server shutdown
  fastify.addHook("onClose", (instance, done) => {
    clearInterval(interval);
    done();
  });
});