// config/pendingCache.js
// pending:{wbn} is what Secondary Sorting reads (and pops) to resolve a
// scan without hitting Postgres on its hot path. Written by BOTH the
// Machine path (sortEngineWorker.js) and Primary Sorting HHD — same
// shape, same TTL, same client — hence factored out here rather than
// duplicated in two files.

const { sharedClient } = require("./redis");

const PENDING_TTL_SECONDS = Number(process.env.PENDING_TTL_SECONDS || 86400); // 24h safety net

// Redis has no native "hash GETDEL" — this is HGETALL + DEL as one
// atomic Lua call, so a concurrent request can never observe a
// half-deleted key. Used by Secondary Sorting to consume a pending
// scan exactly once.
const POP_SCRIPT = `
local key = KEYS[1]
local data = redis.call('HGETALL', key)
if next(data) == nil then
  return nil
end
redis.call('DEL', key)
return data
`;

async function popPendingCache(wbn) {
  if (!wbn) return null;
  try {
    const key = `pending:${wbn}`;
    const raw = await sharedClient.eval(POP_SCRIPT, 1, key);
    if (!raw) return null;

    // ioredis returns the Lua table as a flat array: [field, value, field, value, ...]
    const obj = {};
    for (let i = 0; i < raw.length; i += 2) {
      obj[raw[i]] = raw[i + 1];
    }
    return obj; // { status, ptl_id, bay_id, reason }
  } catch (err) {
    console.error("❌ popPendingCache failed:", err);
    return null;
  }
}

async function writePendingCache(wbn, { status, ptlId, bagId, reason }) {
  if (!wbn) return;
  try {
    const key = `pending:${wbn}`;
    await sharedClient.hset(key, {
      status: status || "",
      ptl_id: ptlId || "",
      bay_id: bagId || "",
      reason: reason || "",
    });
    await sharedClient.expire(key, PENDING_TTL_SECONDS);
  } catch (err) {
    console.error("❌ writePendingCache failed:", err);
  }
}

module.exports = { writePendingCache, popPendingCache, PENDING_TTL_SECONDS };