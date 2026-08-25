// plugins/primarySortEngine.js
// Primary Sorting (HHD) — resolves { username, wbn } against bulk-loaded
// sorted_payloads data. No live Delhivery API fallback (unlike the
// Machine path) — a wbn not found in the bulk data rejects as DNF.
//
// Reuses sortEngine.js's precheck()/resolveShipment() as-is for barcode
// validation and CN/MOT/client rule matching + late PTL binding — this
// file does NOT duplicate that logic. Dimension checks are already a
// no-op here (hasBoxDims() only trips when dims are merged into the
// payload, which never happens on this path); chute-full is explicitly
// opted out via { skipChuteCheck: true }, since Primary Sorting never
// touches a physical bag.
//
// DECISION ONLY. This file has no side effects — it doesn't write to
// Postgres or Redis, doesn't call any queue. routes/primarySort.js
// calls resolvePrimaryScan(), gets the decision back, and hands
// persistence off to primarySortPersistQueue (processed by
// plugins/primarySortPersistWorker.js) — the HTTP response never
// waits on any of that.

const fp = require("fastify-plugin");
const { sharedClient } = require("../config/redis");

module.exports = fp(async function primarySortEnginePlugin(fastify, opts) {
  const pool = fastify.pg;

  // ---------------------------------------------------
  // Bulk payload lookup — Redis payload:{wbn} first (same cache key
  // namespace the Machine path uses), sorted_payloads as fallback.
  // No live API call, per spec.
  // ---------------------------------------------------
  async function loadBulkPayload(wbn) {
    try {
      const raw = await sharedClient.get(`payload:${wbn}`);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* fall through to Postgres */ }

    const res = await pool.query(
      `SELECT payload FROM sorted_payloads WHERE wbn=$1 LIMIT 1`,
      [wbn]
    );
    return res.rows.length ? res.rows[0].payload : null;
  }

  // ---------------------------------------------------
  // MAIN ENTRY — called from routes/primarySort.js. Pure decision,
  // no writes.
  // ---------------------------------------------------
  async function resolvePrimaryScan({ username, wbn }) {
    // Barcode format / empty / NO_READ — reuses sortEngine.js's
    // precheck() unmodified. Its dimension-check branch is already a
    // no-op here since we never pass dims.
    const pre = await fastify.sorter.precheck({ wbn });
    if (!pre.ok) {
      return { username, ...pre.result };
    }

    const resolvedWbn = pre.resolvedWbn;

    // Bulk data lookup — DNF if not found, per spec (no live API here)
    const payload = await loadBulkPayload(resolvedWbn);
    if (!payload) {
      const bag = fastify.sorter.rejectBag("DNF");
      return {
        username,
        wbn: resolvedWbn,
        ptl_id: bag,
        bag_code: bag,
        bay_id: null,
        status: "REJECT",
        reason: "DNF",
      };
    }

    // Same CN/MOT/client matching + late PTL binding as the Machine —
    // chute-full skipped (Primary Sorting never touches a physical bag),
    // and awaitsConfirmation: false keeps this SORTED/null instead of
    // INDUCTED/NCONF — HHD is single-shot, there's no separate PLC
    // confirmation phase to wait for.
    const fullPayload = { ...payload, wbn: payload.wbn || resolvedWbn };
    const result = await fastify.sorter.resolveShipment(fullPayload, {
      skipChuteCheck: true,
      awaitsConfirmation: false,
    });

    return { username, ...result };
  }

  fastify.decorate("primarySorter", { resolvePrimaryScan });
});