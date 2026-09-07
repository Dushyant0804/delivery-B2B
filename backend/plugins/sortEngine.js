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

  // REGULAR and DIRECT both route by PTL against the same ptl_ids pool
  const ptlTypes = ["REGULAR", "DIRECT"];

  function nk(v) {
    if (v === undefined || v === null) return "ANY";
    const s = String(v).trim();
    return s === "" ? "ANY" : s.toUpperCase();
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
      length_mm: Math.round(l * 10), // cm -> mm
      width_mm: Math.round(w * 10),  // cm -> mm
      height_mm: Math.round(h * 10), // cm -> mm
      weight_g: Math.round(wt),      // already grams
    };
  }

  // ---------------------------------------------------
  // VALIDATE BOX LIMITS
  // ---------------------------------------------------
  function validateBoxLimits(boxMM, settings) {
    const minL = num(settings?.box_length_min);
    const maxL = num(settings?.box_length_max);
    const minW = num(settings?.box_width_min);
    const maxW = num(settings?.box_width_max);
    const minH = num(settings?.box_height_min);
    const maxH = num(settings?.box_height_max);
    const minWt = num(settings?.box_weight_min);
    const maxWt = num(settings?.box_weight_max);

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

  function hasBoxDims(payload) {
    return (
      payload?.length !== undefined &&
      payload?.width !== undefined &&
      payload?.height !== undefined &&
      payload?.weight !== undefined
    );
  }

  // ---------------------------------------------------
  // BLOCKED-BAG CHECK (Hardware/Sensor level)
  // ---------------------------------------------------
  async function isBagBlocked(bagCode) {
    const chuteId = chuteIdFromBagCode(bagCode);
    if (!chuteId) return false;

    try {
      const res = await pool.query(`SELECT value FROM bag_sensors WHERE chute_id=$1`, [chuteId]);
      return res.rows.length > 0 && Number(res.rows[0].value) === 1;
    } catch (err) {
      console.error("❌ isBagBlocked check failed:", err.message);
      return false;
    }
  }

  // ---------------------------------------------------
  // CHUTE-FULL CHECK (Redis Counter)
  // ---------------------------------------------------
  async function isChuteFull(bagCode) {
    const settings = await fastify.getSettings();

    const maxCount = num(settings.cutoff_count);
    const maxWeight = num(settings.cutoff_weight);
    const maxRealVolume = num(settings.cutoff_realvolume);

    if (maxCount == null && maxWeight == null && maxRealVolume == null) {
      return false;
    }

    let stats;
    try {
      stats = await redis.hmget(`chute:${bagCode}`, "count", "weight", "realvolume");
    } catch (err) {
      console.error("❌ isChuteFull redis read failed:", err.message);
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
        br.ntc,
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
  // BUILD RULE INDEX
  // ---------------------------------------------------
  function buildIndex(rows) {
    rulesIndex = {};
    anyFallback = [];

    for (const r of rows) {
      const ntc = nk(r.ntc);
      const mot = nk(r.mot);
      const client = nk(r.client);

      const entry = {
        ntc,
        mot,
        client,
        ptl_id: String(r.ptl_id),
        bay_id: r.bay_id || null,
        bag_id: r.bag_id,
        raw: r,
      };

      if (ntc === "ANY" && mot === "ANY" && client === "ANY") {
        anyFallback.push(entry);
        continue;
      }

      if (!rulesIndex[ntc]) rulesIndex[ntc] = {};
      if (!rulesIndex[ntc][mot]) rulesIndex[ntc][mot] = {};
      if (!rulesIndex[ntc][mot][client]) rulesIndex[ntc][mot][client] = [];

      rulesIndex[ntc][mot][client].push(entry);
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
  // RELOAD RULES
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
      console.error("❌ reloadRules failed:", err.message);
      activeConfigId = null;
      rulesIndex = {};
      anyFallback = [];
      rejectMap = {};
    }
  }

  function isActive() {
    return !!activeConfigId;
  }

  function findBest(ntcKey, motKey, clientKey) {
    const combos = [
      [ntcKey, motKey, clientKey],
      [ntcKey, motKey, "ANY"],
      [ntcKey, "ANY", clientKey],
      [ntcKey, "ANY", "ANY"],
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
  // SHARED PRE-CHECK
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
          status: "REJECTED",
          reason,
          source: "LIVE_FETCH",
        },
      };
    }

    if (!rawWbn) return reject("DNF", null);

    const candidates = splitWbns(rawWbn);
    if (!candidates.length) return reject("DNF", null);

    if (candidates.some((w) => w.toUpperCase() === "NO_READ")) {
      return reject("DBO", rawWbn);
    }

    const validWbns = fastify.regexCache
      ? candidates.filter((w) => fastify.regexCache.validateWbn(w))
      : candidates;

    if (!validWbns.length) return reject("IBO", rawWbn);

    const resolvedWbn = validWbns.length === 1 ? validWbns[0] : validWbns.join(",");

    if (hasBoxDims(payload)) {
      const boxMM = normalizeBox(payload);
      if (boxMM.incomplete) return reject("NDIM", resolvedWbn);

      const settings = typeof fastify.getSettings === "function" ? fastify.getSettings() : {};
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
      return { wbn, bag_code: null, ptl_id: null, bay_id: null, status: "REJECTED", reason: "NO_ACTIVE_CONFIG", source: "LIVE_FETCH" };
    }

    function reject(reason) {
      const bag = rejectBag(reason);
      return { wbn, ptl_id: bag, bag_code: bag, bay_id: null, status: "REJECTED", reason, source: "LIVE_FETCH" };
    }

    // Business Rejection Rules
    if (payload.expected === false) return reject("UNX");
    if (payload.xray && !payload.xraycs && payload.mot === "E") return reject("HV");
    if (payload.rej === true) return reject("REJ");
    if (payload.nsz === true) return reject("NSZ");
    if (payload.ar === true && payload.mot === "E") return reject("AR");

    // Destination determination
    const st = String(payload.st || "").toUpperCase();
    const dest = st === "RT" || st === "PU" ? payload.rcn : payload.ntc;

    const ntcKey = nk(dest);
    const motKey = nk(payload.mot);
    const clientKey = nk(payload.cl || payload.client);

    let matched =
      findBest(ntcKey, motKey, clientKey) ||
      findBest(ntcKey, motKey, "ANY") ||
      findBest(ntcKey, "ANY", "ANY") ||
      anyFallback[0];

    if (!matched) return reject("LMM");

    // Late Binding: PTL -> Bag Code
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

    // Blocked & Full Chute Verification
    if (resolvedBag && !skipChuteCheck) {
      const blocked = await isBagBlocked(resolvedBag);
      if (blocked) return reject("CHUTE_FULL");

      const full = await isChuteFull(resolvedBag);
      if (full) return reject("CHUTE_FULL");
    }

    return {
      wbn,
      ptl_id: ptlId,
      bag_code: finalBag,
      bay_id: matched.bay_id || null,
      // Internal DB state: INDUCTED (not yet confirmed) vs HHD instant SORTED
      status: awaitsConfirmation ? "INDUCTED" : "SORTED",
      reason: awaitsConfirmation ? "NCONF" : null,
      source: "LIVE_FETCH",
      matchedRule: matched.raw,
    };
  }

  // ---------------------------------------------------
  // DECORATOR
  // ---------------------------------------------------
  fastify.decorate("sorter", {
    reloadRules,
    resolveShipment,
    precheck,
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
  setInterval(() => reloadRules().catch(() => {}), REFRESH * 1000);
});