// models/BagDecision.j
const pool = require("../config/pg");
const IORedis = require("ioredis");

const redis = new IORedis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
});

// ───────────────────────────────────────────
// Cache Config
// ───────────────────────────────────────────
const BAG_RULES_CACHE_KEY = "bagRules:v1";
const BAG_RULES_TTL = 60; // seconds

// ───────────────────────────────────────────
// Standard Reject Bag
// ───────────────────────────────────────────
const REJECT_BAG = {
  bag_id: "R001",
  prefix: "REJECT",
  mot: null,
  cn: null,
  client: null,
  reason: null,
};

// ───────────────────────────────────────────
// Utils
// ───────────────────────────────────────────
const normalize = (v) =>
  typeof v === "string" ? v.trim().toUpperCase() : v ?? null;

// ───────────────────────────────────────────
// Load bag rules
// ───────────────────────────────────────────
async function loadBagsFromDb() {
  const res = await pool.query(
    `SELECT bag_id, prefix, mot, cn, client FROM bags`
  );
  return res.rows;
}

async function getBagRules() {
  const cached = await redis.get(BAG_RULES_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const rules = await loadBagsFromDb();
  await redis.set(
    BAG_RULES_CACHE_KEY,
    JSON.stringify(rules),
    "EX",
    BAG_RULES_TTL
  );
  return rules;
}

function invalidateBagCache() {
  return redis.del(BAG_RULES_CACHE_KEY);
}

// ───────────────────────────────────────────
// Matcher & Scoring
// ───────────────────────────────────────────
function matchValue(ruleValue, shipmentValue) {
  const rv = normalize(ruleValue);
  const sv = normalize(shipmentValue);

  if (!rv) return false;
  if (rv === "ANY") return true;
  return rv === sv;
}

function scoreRule(rule, mot, cn, client) {
  let score = 0;
  if (matchValue(rule.mot, mot)) score++;
  if (matchValue(rule.cn, cn)) score++;
  if (matchValue(rule.client, client)) score++;
  return score;
}

async function findBestBag({ mot, cn, client }) {
  const rules = await getBagRules();
  let best = null;
  let bestScore = -1;

  for (const r of rules) {
    const s = scoreRule(r, mot, cn, client);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }

  return bestScore > 0 ? best : null;
}

// ───────────────────────────────────────────
// Final Shipment Bag Resolver (Main Export)
// ───────────────────────────────────────────
async function resolveShipmentBag(payload) {
  const mot = normalize(payload.mot);
  const cn = normalize(payload.cn);
  const rcn = normalize(payload.rcn);
  const client = normalize(payload.client || payload.cl);
  const st = normalize(payload.st);
  const scn = normalize(payload.scn);
  const zn = normalize(payload.zn);
  const expected = payload.expected;
  const xray = payload.xray;
  const xraycs = payload.xraycs;
  const ar = payload.ar;

  // 1️⃣ NSZ – No Service Zone
  if (scn === "NSZ" && st === "UD") {
    return { ...REJECT_BAG, reason: "NSZ" };
  }

  // 2️⃣ High Value (HV)
  if (xray === true && xraycs === false) {
    return { ...REJECT_BAG, reason: "HV" };
  }

  // 3️⃣ Air Restricted (AR)
  if (ar === true && mot === "E" && !(zn === "A" || zn === "B")) {
    return { ...REJECT_BAG, reason: "AR" };
  }

  // 4️⃣ Unexpected (UNX)
  if (expected === false) {
    return { ...REJECT_BAG, reason: "UNX" };
  }

  // 5️⃣ Determine Forward vs Return Destination
  const dest = st === "UD" ? cn : rcn;
  if (!dest) {
    return { ...REJECT_BAG, reason: "NO_DEST" };
  }

  // 6️⃣ Best Bag Lookup
  const bag = await findBestBag({ mot, cn: dest, client });
  if (!bag) return { ...REJECT_BAG, reason: "LMM" };

  return { ...bag, reason: "OK" };
}

module.exports = {
  resolveShipmentBag,
  invalidateBagCache,
  findBestBag,
};
