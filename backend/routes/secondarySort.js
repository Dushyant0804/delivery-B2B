// routes/secondarySort.js
// Secondary Sorting: operator picks a bay_id, scans parcels already
// resolved by Primary Sorting or the Machine, and builds up a virtual
// bag until they physically seal it.
//
// Session identity is virtualbagseal, NOT bay_id — two operators can
// work the same bay_id concurrently, each with their own isolated
// session and their own Redis idempotency key (vbag:{virtualbagseal}).

const { randomUUID } = require("crypto");
const { sharedClient } = require("../config/redis");
const { popPendingCache } = require("../config/pendingCache");

const VBAG_TTL_SECONDS = Number(process.env.VBAG_TTL_SECONDS || 86400); // 24h safety net

function normalizeBayId(bayId) {
  const digits = String(bayId ?? "").trim().replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(2, "0");
}

async function secondarySortRoutes(fastify, opts) {
  const pool = fastify.pg;

  // ----------------------------------------------------
  // POST create a new session — operator picks bay_id, taps Next
  // ----------------------------------------------------
  fastify.post("/secondary-sort/session", async (req, reply) => {
    const { username, bay_id } = req.body || {};

    if (!username) {
      return reply.code(400).send({ success: false, error: "username is required" });
    }

    const normalizedBay = normalizeBayId(bay_id);
    if (!normalizedBay) {
      return reply.code(400).send({ success: false, error: "Invalid bay_id" });
    }

    const virtualbagseal = randomUUID();

    const res = await pool.query(
      `INSERT INTO secondary_sorting_sessions (username, bay_id, virtualbagseal)
       VALUES ($1,$2,$3)
       RETURNING id, username, bay_id, virtualbagseal, originalbagseal, wbns, count, firstscan, sealed_at, created_at`,
      [username, normalizedBay, virtualbagseal]
    );

    return reply.send({ success: true, session: res.rows[0] });
  });

  // ----------------------------------------------------
  // GET session state — used to hydrate the scanning page (e.g. after
  // a reload) and to populate the wbns list modal
  // ----------------------------------------------------
  fastify.get("/secondary-sort/session/:id", async (req, reply) => {
    const sessionId = Number(req.params.id);
    if (!sessionId) {
      return reply.code(400).send({ success: false, error: "Invalid session id" });
    }

    const res = await pool.query(
      `SELECT * FROM secondary_sorting_sessions WHERE id=$1`,
      [sessionId]
    );

    if (!res.rows.length) {
      return reply.code(404).send({ success: false, error: "Session not found" });
    }

    return reply.send({ success: true, session: res.rows[0] });
  });

  // ----------------------------------------------------
  // POST scan a wbn into the session's virtual bag
  //
  // Decision order:
  //   1. Already in THIS bag (vbag:{virtualbagseal}) -> idempotent
  //      repeat, return the same result, no count change
  //   2. Pop pending:{wbn} (Redis) -> Postgres fallback on miss
  //   3. Not found anywhere -> PRIMARY_FAILED
  //   4. Found but secondary_scantime already set -> ALREADY_PICKED
  //      (a genuine cross-bag duplicate)
  //   5. Upstream status != SORTED -> surface the original reason
  //      as-is (HV, DNF, UNX, ...)
  //   6. SORTED but bay_id doesn't match this session's bay -> WRST
  //   7. SORTED and bay matches -> ADDED (the only outcome that
  //      touches wbns/count)
  // ----------------------------------------------------
  fastify.post("/secondary-sort/session/:id/scan", async (req, reply) => {
    const sessionId = Number(req.params.id);
    const wbn = String(req.body?.wbn || "").trim().toUpperCase();

    if (!sessionId || !wbn) {
      return reply.code(400).send({ success: false, error: "session id and wbn are required" });
    }

    const sessRes = await pool.query(
      `SELECT * FROM secondary_sorting_sessions WHERE id=$1`,
      [sessionId]
    );

    if (!sessRes.rows.length) {
      return reply.code(404).send({ success: false, error: "Session not found" });
    }

    const session = sessRes.rows[0];

    if (session.sealed_at) {
      return reply.code(409).send({ success: false, error: "This bag has already been sealed" });
    }

    const vbagKey = `vbag:${session.virtualbagseal}`;

    // 1) Repeat scan within THIS bag — idempotent, no count change
    const cachedPtl = await sharedClient.hget(vbagKey, wbn);
    if (cachedPtl !== null) {
      return reply.send({
        success: true,
        outcome: "DUPLICATE_IN_BAG",
        message: "Already scanned into this bag",
        ptl_id: cachedPtl,
        bay_id: session.bay_id,
        count: session.count,
      });
    }

    // 2) Resolve — pending cache first, Postgres fallback on miss
    let resolved = await popPendingCache(wbn);
    let fallbackRowId = null;

    if (!resolved) {
      const rowRes = await pool.query(
        `SELECT id, ptl_id, bay_id, sort AS status, reason, secondary_scantime
         FROM primary_bin_data WHERE wbn=$1 ORDER BY id DESC LIMIT 1`,
        [wbn]
      );

      if (!rowRes.rows.length) {
        return reply.send({
          success: true,
          outcome: "PRIMARY_FAILED",
          message: "Not sorted yet — run this parcel through Primary Sorting or the Machine first",
          count: session.count,
        });
      }

      const row = rowRes.rows[0];

      if (row.secondary_scantime) {
        return reply.send({
          success: true,
          outcome: "ALREADY_PICKED",
          message: "This parcel has already been picked up",
          ptl_id: row.ptl_id,
          count: session.count,
        });
      }

      resolved = {
        status: row.status,
        ptl_id: row.ptl_id,
        bay_id: row.bay_id,
        reason: row.reason,
      };
      fallbackRowId = row.id;
    }

    // 3) Upstream reject — surface the original reason as-is. INDUCTED
    // counts as a proceed-state alongside SORTED: a Machine-origin
    // parcel that hasn't had PLC confirmation yet still has a real
    // PTL/bay assignment, and Secondary Sorting doesn't care about
    // confirmation state — only Primary Sorting HHD's parcels come
    // through as SORTED directly (no confirm phase to await).
    if (resolved.status !== "SORTED" && resolved.status !== "INDUCTED") {
      return reply.send({
        success: true,
        outcome: "REJECT",
        message: resolved.reason || "Rejected upstream",
        reason: resolved.reason,
        count: session.count,
      });
    }

    // 4) Wrong bay
    const resolvedBay = normalizeBayId(resolved.bay_id);
    if (resolvedBay !== session.bay_id) {
      return reply.send({
        success: true,
        outcome: "WRST",
        message: `Wrong bay — this parcel belongs to bay ${resolvedBay ?? "?"}`,
        ptl_id: resolved.ptl_id,
        count: session.count,
      });
    }

    // 5) SUCCESS — the only path that touches wbns/count
    const updateRes = await pool.query(
      `UPDATE secondary_sorting_sessions
       SET wbns = array_append(wbns, $1),
           count = count + 1,
           firstscan = COALESCE(firstscan, NOW())
       WHERE id = $2
       RETURNING count`,
      [wbn, sessionId]
    );

    const newCount = updateRes.rows[0].count;

    // Mark secondary_scantime on the primary_bin_data row this came from
    if (fallbackRowId) {
      await pool.query(
        `UPDATE primary_bin_data SET secondary_scantime=NOW() WHERE id=$1`,
        [fallbackRowId]
      );
    } else {
      await pool.query(
        `UPDATE primary_bin_data SET secondary_scantime=NOW()
         WHERE id = (SELECT id FROM primary_bin_data WHERE wbn=$1 ORDER BY id DESC LIMIT 1)`,
        [wbn]
      );
    }

    try {
      await sharedClient.hset(vbagKey, wbn, resolved.ptl_id || "");
      await sharedClient.expire(vbagKey, VBAG_TTL_SECONDS);
    } catch (err) {
      console.error("❌ vbag redis write failed:", err);
    }

    // Delhivery notify — fire and forget, never blocks the operator's feedback
    fastify.queues.secondaryApiQueue
      .add("secondary", {
        wbn,
        bag_code: session.bay_id,
        ptl_id: resolved.ptl_id,
        status: "SORTED",
        reason: null,
      })
      .catch((err) => console.error("❌ secondaryApiQueue enqueue failed:", err));

    return reply.send({
      success: true,
      outcome: "ADDED",
      ptl_id: resolved.ptl_id,
      bay_id: session.bay_id,
      count: newCount,
    });
  });

  // ----------------------------------------------------
  // POST seal — records the real physical bagseal, closes the session
  // ----------------------------------------------------
  fastify.post("/secondary-sort/session/:id/seal", async (req, reply) => {
    const sessionId = Number(req.params.id);
    const originalbagseal = String(req.body?.originalbagseal || "").trim();

    if (!sessionId || !originalbagseal) {
      return reply.code(400).send({ success: false, error: "originalbagseal is required" });
    }

    const sessRes = await pool.query(
      `SELECT * FROM secondary_sorting_sessions WHERE id=$1`,
      [sessionId]
    );

    if (!sessRes.rows.length) {
      return reply.code(404).send({ success: false, error: "Session not found" });
    }

    const session = sessRes.rows[0];

    if (session.sealed_at) {
      return reply.code(409).send({ success: false, error: "This bag has already been sealed" });
    }

    if (session.count === 0) {
      return reply.code(400).send({ success: false, error: "Cannot seal an empty bag" });
    }

    const upd = await pool.query(
      `UPDATE secondary_sorting_sessions
       SET originalbagseal=$1, sealed_at=NOW()
       WHERE id=$2
       RETURNING *`,
      [originalbagseal, sessionId]
    );

    try {
      await sharedClient.del(`vbag:${session.virtualbagseal}`);
    } catch (err) {
      console.error("❌ Failed to clear vbag redis key:", err);
    }

    return reply.send({ success: true, session: upd.rows[0] });
  });
}

module.exports = secondarySortRoutes;