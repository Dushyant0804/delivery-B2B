// utils/payloadValidator.js
//
// Shared between routes/sorterPayloadRoutes.js and plugins/sorterWorker.js
// so the two never validate the same payload two different ways.

const payloadSchema = {
  wbn: "string",
  oid: "string",
  ndc: "string",
  pt: "string",
  ss: "string",
  sl: "string",
  st: "string",
  cl: "string",
  ar: "boolean",
  mot: "string",
  xray: "boolean",
  xraycs: "boolean",
  zn: "string",
  cn: "string",
  rcn: "string",
  pdd: "string",
  rpdd: "string",
  adf_pin: "string",
  adf_rpin: "string",
  pin: "number",
  rpin: "number",
  cwh: "string",
  adf_loc: "string",
  adf_rloc: "string",
  city: "string",
  rcity: "string",
  adf_city: "string",
  adf_rcity: "string",
  pdt: "string",
  incoming_trip: "boolean",
  chute_id: "string",
  expected: "boolean", // optional
  pri: "boolean",
  offload: "boolean"
};

// wbn is the one field that must always be a valid, non-empty string —
// it's the DB upsert key and the Redis cache key, so a null/missing wbn
// would break both. Every other field can legitimately arrive as null
// (typeof null === "object", which never matches "string"/"boolean"/
// "number", so null was being wrongly rejected before this existed) —
// null is accepted for anything except wbn.
function validatePayload(item, schema = payloadSchema) {
  if (typeof item.wbn !== "string" || item.wbn === "") {
    return {
      valid: false,
      error: `Invalid or missing wbn: expected non-empty string, got ${typeof item.wbn}`
    };
  }

  for (const key in schema) {
    if (key === "wbn") continue; // already validated above

    const expectedType = schema[key];
    if (!(key in item)) continue;        // optional key, not present
    if (item[key] === null) continue;    // explicitly allowed to be null

    const actualType = typeof item[key];
    if (expectedType === "string" && item[key] === "") continue;
    if (actualType !== expectedType) {
      return {
        valid: false,
        error: `Invalid datatype for ${key}: expected ${expectedType}, got ${actualType}`
      };
    }
  }
  return { valid: true };
}

module.exports = { payloadSchema, validatePayload };