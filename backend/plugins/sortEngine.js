// plugins/sortEngine.js
// PTL-based sorting engine with LATE BAG BINDING via bag_mappings

const fp = require("fastify-plugin");
const { sharedClient: redis } = require("../config/redis");
const { chuteIdFromBagCode } = require("../config/chuteId");

module.exports = fp(async function sortEnginePlugin(fastify, opts) {
  const pool = fastify.pg;

  // ---------------------------------------------------
  // INTERNAL STATE
  // ---------------------------------------------------
  let rulesIndex = {};
  let anyFallback = [];
  let activeConfigId = null;

  // rejection_reason → bag_code
  let rejectMap = {};
  const defaultRejectBag = "D099";

  // REGULAR and DIRECT both route by PTL against the same ptl_ids pool —
  // only REJECTED is a separate (rejection_codes) pool.
  const ptlTypes = ["REGULAR", "DIRECT"];

  function nk(v) {
    if (v === undefined || v === null) return "ANY";
    const s = String(v).trim();
    return s === "" ? "ANY" : s.toUpperCase();
  }

  // ---------------------------------------------------
  // SETTINGS CACHE (box-dimension limits + chute-full cutoffs,
  // shared with liveFetchEngine's cache pattern)
  // ---------------------------------------------------
  let cachedSettings = null;
  let lastSettingsLoad = 0;
  const SETTINGS_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

  async function loadSettingsCached(force = false) {
    const now = Date.now();
    if (!force && cachedSettings && now - lastSettingsLoad < SETTINGS_REFRESH_MS) {
      return cachedSettings;
    }
    const res = await pool.query(`SELECT * FROM settings WHERE id = 1`);
    if (!res.rows.length) throw new Error("Settings row not found");
    cachedSettings = res.rows[0];
    lastSettingsLoad = now;
    return cachedSettings;
  }

  // ---------------------------------------------------
  // NORMALIZE BOX (cm → mm, weight → grams)
  // ---------------------------------------------------
function normalizeBox(box) {
  const toNum = (v) => {
    if (v === undefined || v === null) return null;
    if (String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const l = toNum(box.length);
  const w = toNum(box.width);
  const h = toNum(box.height);
  const wt = toNum(box.weight);

  if (l == null || w == null || h == null || wt == null) {
    return { incomplete: true };
  }

  return {
    incomplete: false,
    // Payload arrives in cm (confirmed against a real DWS payload —
    // e.g. length: 43.2 is a ~43cm box, not a 43mm one). This ×10 was
    // missing entirely before, despite this function's own header
    // comment saying "cm → mm" — every dimension was being compared
    // against mm-scale settings limits as if it were already mm,
    // which rejected normal-sized parcels as undersized on every axis.
    length_mm: Math.round(l * 10),
    width_mm: Math.round(w * 10),
    height_mm: Math.round(h * 10),
    weight_g: Math.round(wt),   // already grams
  };
}

  // ---------------------------------------------------
  // VALIDATE BOX LIMITS
  // ---------------------------------------------------
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function validateBoxLimits(boxMM, settings) {
    // settings.box_*_min/max are already stored in mm (weight in grams)
    // — compared directly against boxMM, which is also mm after
    // normalizeBox's cm→mm conversion on the incoming payload. No
    // conversion needed on this side; the earlier version of this
    // function incorrectly assumed settings were in cm and converted
    // them, which was wrong — the payload was the only side that
    // actually needed converting.
    const minL = num(settings.box_length_min);
    const maxL = num(settings.box_length_max);
    const minW = num(settings.box_width_min);
    const maxW = num(settings.box_width_max);
    const minH = num(settings.box_height_min);
    const maxH = num(settings.box_height_max);
    const minWt = num(settings.box_weight_min);
    const maxWt = num(settings.box_weight_max);

    if (
      (minL != null && boxMM.length_mm < minL) ||
      (minW != null && boxMM.width_mm < minW) ||
      (minH != null && boxMM.height_mm < minH) ||
      (minWt != null && boxMM.weight_g < minWt)
    ) {
      return "NDIM_UD";
    }

    if (
      (maxL != null && boxMM.length_mm > maxL) ||
      (maxW != null && boxMM.width_mm > maxW) ||
      (maxH != null && boxMM.height_mm > maxH) ||
      (maxWt != null && boxMM.weight_g > maxWt)
    ) {
      return "NDIM_OD";
    }

    return null;
  }

  // Only run dimension checks when the payload actually
  // carries box dims — keeps this a no-op for callers
  // (e.g. today's DB-fetch payload) that don't have them.
  function hasBoxDims(payload) {
    return (
      payload?.length !== undefined &&
      payload?.width !== undefined &&
      payload?.height !== undefined &&
      payload?.weight !== undefined
    );
  }

  // ---------------------------------------------------
  // BLOCKED-BAG CHECK — an operator manually blocked this bag via
  // Clear Bag (bag_sensors.btn{N} = 1) and hasn't cleared it yet.
  // Machine only, gated by the same skipChuteCheck flag Primary
  // Sorting HHD already uses. A direct Postgres read is fine here
  // (not Redis-mirrored like isChuteFull) — Block/Clear Bag is a rare
  // operator action, not a per-parcel write, so there's no throughput
  // reason to add a cache layer for it.
  // ---------------------------------------------------
  async function isBagBlocked(bagCode) {
    const chuteId = chuteIdFromBagCode(bagCode);
    if (!chuteId) return false;

    try {
      const res = await pool.query(`SELECT value FROM bag_sensors WHERE chute_id=$1`, [chuteId]);
      return res.rows.length > 0 && Number(res.rows[0].value) === 1;
    } catch (err) {
      // Same fail-open philosophy as isChuteFull — a DB hiccup should
      // never block sorting.
      console.error("❌ isBagBlocked check failed:", err);
      return false;
    }
  }

  // ---------------------------------------------------
  // CHUTE-FULL CHECK — Redis-backed, no Postgres on the hot path.
  // confirmSortWorker.js keeps chute:{bag_code} hashes (count/weight/
  // realvolume) in sync with bags_wbn on every confirmed drop; this
  // is a single HMGET per scan against that live counter.
  // ---------------------------------------------------
  async function isChuteFull(bagCode) {
    const settings = await loadSettingsCached();

    const maxCount = num(settings.cutoff_count);
    const maxWeight = num(settings.cutoff_weight);
    const maxRealVolume = num(settings.cutoff_realvolume);

    // No cutoffs configured at all — nothing to check.
    if (maxCount == null && maxWeight == null && maxRealVolume == null) {
      return false;
    }

    let stats;
    try {
      stats = await redis.hmget(`chute:${bagCode}`, "count", "weight", "realvolume");
    } catch (err) {
      // Redis hiccup should never block sorting — fail open.
      console.error("❌ isChuteFull redis read failed:", err);
      return false;
    }

    const count = Number(stats[0]) || 0;
    const weight = Number(stats[1]) || 0;
    const realvolume = Number(stats[2]) || 0;

    if (maxCount != null && count >= maxCount) return true;
    if (maxWeight != null && weight >= maxWeight) return true;
    if (maxRealVolume != null && realvolume >= maxRealVolume) return true;

    return false;
  }

  // ---------------------------------------------------
  // LOAD RULES FOR CONFIG
  // ---------------------------------------------------
  async function loadRowsForConfig(cfgId) {
    const q = `
    SELECT 
      br.id AS br_id,
      br.config_id,
      br.bag_id,
      br.cn,
      br.cn_branch_code,
      br.client,
      br.mot,
      br.ptl_id,
      br.bay_id
    FROM bag_rules br
    WHERE br.config_id = $1
  `;
    const res = await pool.query(q, [cfgId]);
    return res.rows;
  }

  // ---------------------------------------------------
  // BUILD RULE INDEX (CN / MOT / CLIENT → PTL)
  // ---------------------------------------------------
  function buildIndex(rows) {
    rulesIndex = {};
    anyFallback = [];

    for (const r of rows) {
      const cn = nk(r.cn);
      const mot = nk(r.mot);
      const client = nk(r.client);

      const entry = {
        cn,
        mot,
        client,
        ptl_id: String(r.ptl_id), // 🔥 PTL ONLY (0036)
        bay_id: r.bay_id || null,
        bag_id: r.bag_id,
        raw: r,
      };

      if (cn === "ANY" && mot === "ANY" && client === "ANY") {
        anyFallback.push(entry);
        continue;
      }

      if (!rulesIndex[cn]) rulesIndex[cn] = {};
      if (!rulesIndex[cn][mot]) rulesIndex[cn][mot] = {};
      if (!rulesIndex[cn][mot][client]) rulesIndex[cn][mot][client] = [];

      rulesIndex[cn][mot][client].push(entry);
    }
  }

  // ---------------------------------------------------
  // LOAD REJECT BAG MAP
  // ---------------------------------------------------
  async function loadRejectBags() {
    const q = `
      SELECT bag_code, rejection_codes
      FROM bag_mappings
      WHERE type = 'REJECTED'
    `;
    const res = await pool.query(q);

    rejectMap = {};

    for (const r of res.rows) {
      if (Array.isArray(r.rejection_codes)) {
        for (const code of r.rejection_codes) {
          rejectMap[String(code).toUpperCase()] = r.bag_code;
        }
      }
    }
  }

  function rejectBag(reason) {
    const key = String(reason || "").toUpperCase();
    return rejectMap[key] || defaultRejectBag;
  }

  // ---------------------------------------------------
  // RELOAD RULES (ACTIVE CONFIG ONLY)
  // ---------------------------------------------------
  async function reloadRules() {
    try {
      const cfg = await pool.query(`
        SELECT id
        FROM sorter_configs
        WHERE type='PTL' AND is_active = TRUE
        LIMIT 1
      `);

      if (cfg.rows.length === 0) {
        activeConfigId = null;
        rulesIndex = {};
        anyFallback = [];
        rejectMap = {};
        console.log("🔴 No active PTL config");
        return;
      }

      const cfgId = cfg.rows[0].id;

      await loadRejectBags();
      const rows = await loadRowsForConfig(cfgId);
      buildIndex(rows);

      activeConfigId = cfgId;
    } catch (err) {
      console.error("❌ reloadRules failed:", err);
      activeConfigId = null;
      rulesIndex = {};
      anyFallback = [];
      rejectMap = {};
    }
  }

  function isActive() {
    return !!activeConfigId;
  }

  // ---------------------------------------------------
  // MATCH HELPERS
  // ---------------------------------------------------
  function findBest(cnKey, motKey, clientKey) {
    const combos = [
      [cnKey, motKey, clientKey],
      [cnKey, motKey, "ANY"],
      [cnKey, "ANY", clientKey],
      [cnKey, "ANY", "ANY"],
    ];

    for (const [c, m, cl] of combos) {
      const arr = rulesIndex[c]?.[m]?.[cl];
      if (arr?.length) return arr[0];
    }
    return null;
  }
  function splitWbns(raw) {
    return String(raw)
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
  }

// ---------------------------------------------------
// SHARED PRE-CHECK: barcode format + box dimensions.
// Splits comma-separated wbn candidates and validates
// each individually — a candidate that matches the
// regex is kept, one that doesn't is dropped. Only
// rejects IBO if NONE of the candidates match.
// Returns { ok: false, result } on reject, or
// { ok: true, resolvedWbn, validWbns } on pass.
// ---------------------------------------------------
async function precheck(payload) {
  const rawWbn = payload?.wbn || null;

  function reject(reason, wbnOverride) {
    const bag = rejectBag(reason);
    return {
      ok: false,
      result: {
        wbn: wbnOverride !== undefined ? wbnOverride : rawWbn,
        ptl_id: bag,
        bag_code: bag,
        bay_id: null,
        status: "REJECT",
        reason,
        source: "DB Fetch",
      },
    };
  }

  // DNF — no barcode at all
  if (!rawWbn) return reject("DNF", null);

  const candidates = splitWbns(rawWbn);
  if (!candidates.length) return reject("DNF", null);

  // NO_READ — scanner explicitly reported a failed read
  if (candidates.some((w) => w.toUpperCase() === "NO_READ")) {
    return reject("DBO", rawWbn);
  }

  // BARCODE FORMAT VALIDATION — check each candidate
  // individually; keep only the ones that match.
  const validWbns = fastify.regexCache
    ? candidates.filter((w) => fastify.regexCache.validateWbn(w))
    : candidates;

  if (!validWbns.length) return reject("IBO", rawWbn);

  // One valid candidate → that's the resolved wbn from here on.
  // More than one → stays a joined list; the caller (cache lookup /
  // Delhivery API fallback) disambiguates which one is real.
  const resolvedWbn = validWbns.length === 1 ? validWbns[0] : validWbns.join(",");

  // DIMENSION CHECKS — only if this payload carries box dims
  if (hasBoxDims(payload)) {
    const boxMM = normalizeBox(payload);
    if (boxMM.incomplete) return reject("NDIM", resolvedWbn);

    const settings = await loadSettingsCached();
    const dimReject = validateBoxLimits(boxMM, settings);
    if (dimReject) return reject(dimReject, resolvedWbn);
  }

  return { ok: true, resolvedWbn, validWbns };
}

// ---------------------------------------------------
// MAIN SORT RESOLVER
// ---------------------------------------------------
async function resolveShipment(payload, opts = {}) {
  const { skipChuteCheck = false, awaitsConfirmation = true } = opts;
  const pre = await precheck(payload);
  if (!pre.ok) return pre.result;

  const wbn = pre.resolvedWbn;

  if (!isActive()) {
    return { wbn, bag_code: null, ptl_id: null, bay_id: null, status: "ERROR", reason: "NO_ACTIVE_CONFIG" };
  }

  function reject(reason) {
    const bag = rejectBag(reason);
    return { wbn, ptl_id: bag, bag_code: bag, bay_id: null, status: "REJECT", reason, source: "DB Fetch" };
  }

  // REJECTION CONDITIONS
  if (payload.expected === false) return reject("UNX");
  if (payload.xray && !payload.xraycs && payload.mot === 'E') return reject("HV");
  if (payload.rej === true) return reject("REJ");
  if (payload.nsz === true) return reject("NSZ");
  if (payload.ar === true && payload.mot === 'E') return reject("AR");

  // DESTINATION
  const st = String(payload.st || "").toUpperCase();
  const dest = (st === "RT" || st === "PU") ? payload.rcn : payload.cn;

  const cnKey = nk(dest);
  const motKey = nk(payload.mot);
  const clientKey = nk(payload.cl || payload.client);

  let matched =
    findBest(cnKey, motKey, clientKey) ||
    findBest(cnKey, motKey, "ANY") ||
    findBest(cnKey, "ANY", "ANY") ||
    anyFallback[0];

  if (!matched) return reject("LMM");

  // ---------------------------------------------------
  // 🔥 LATE BINDING: PTL → FINAL BAG
  // bag_mappings.ptl_id (scalar) was replaced by ptl_ids (array),
  // and REGULAR + DIRECT both route by PTL against the same pool.
  // ---------------------------------------------------
  const ptlId = String(matched.ptl_id || "");

  if (!ptlId || /^D\d+/i.test(ptlId)) {
    throw new Error(`INVALID PTL VALUE DETECTED: ${ptlId}`);
  }

  const mapRes = await pool.query(
    `SELECT bag_code FROM bag_mappings WHERE type = ANY($2::text[]) AND $1 = ANY(ptl_ids) LIMIT 1`,
    [ptlId, ptlTypes]
  );

  const resolvedBag = mapRes.rows.length > 0 ? mapRes.rows[0].bag_code : null;
  const finalBag = resolvedBag || defaultRejectBag;

  // ---------------------------------------------------
  // 🔥 BLOCKED-BAG + CHUTE-FULL CHECKS — only for an actually-resolved
  // target bag, Machine only (skipChuteCheck gates both). The
  // default-reject fallback above is never checked, same as every
  // other reject-bag route in this engine.
  // ---------------------------------------------------
  if (resolvedBag && !skipChuteCheck) {
    const blocked = await isBagBlocked(resolvedBag);
    if (blocked) {
      return reject("CHUTE_FULL");
    }

    const full = await isChuteFull(resolvedBag);
    if (full) {
      return reject("CHUTE_FULL");
    }
  }

  return {
    wbn,
    ptl_id: ptlId,
    bag_code: finalBag,
    bay_id: matched.bay_id || null,
    // Machine: no PLC confirmation has arrived yet at this point in the
    // flow — INDUCTED/NCONF marks "scanned + resolved, drop not yet
    // confirmed." confirmSortWorker.js overwrites this with the real
    // outcome once confirmation actually arrives. Primary Sorting HHD
    // is single-shot (no separate confirm phase), so it explicitly
    // passes awaitsConfirmation: false and keeps SORTED/null.
    status: awaitsConfirmation ? "INDUCTED" : "SORTED",
    reason: awaitsConfirmation ? "NCONF" : null,
    source: "DB Fetch",
    matchedRule: matched.raw,
  };
}

  // ---------------------------------------------------
  // DECORATOR
  // ---------------------------------------------------
  fastify.decorate("sorter", {
    reloadRules,
    resolveShipment,
    precheck,          // exposed so liveFetchEngine can gate the API call with the same checks
    isActive,
    rejectBag,
    _debug: {
      rulesIndex: () => rulesIndex,
      rejectMap: () => rejectMap,
      anyFallback: () => anyFallback,
    },
  });

  await reloadRules();

  const REFRESH = Number(process.env.SORTER_RULES_REFRESH_SECS || 10);
  setInterval(() => reloadRules().catch(() => { }), REFRESH * 1000);
});