// routes/primarySort.js
// POST /primary-sort/scan  { username, wbn }
//
// Computes the sort decision synchronously (needed for the response),
// then hands persistence (primary_sorting upsert, primary_bin_data
// insert, pending:{wbn} cache, Delhivery notify) off to
// primarySortPersistQueue — the response does NOT wait for any of that
// to complete, only for the decision itself plus the (fast) enqueue call.

async function primarySortRoutes(fastify, opts) {
  fastify.post("/primary-sort/scan", async (req, reply) => {
    const { username, wbn } = req.body || {};

    if (!username || !wbn) {
      return reply.code(400).send({ error: true, message: "username and wbn are required" });
    }

    const result = await fastify.primarySorter.resolvePrimaryScan({ username, wbn });

    try {
      await fastify.queues.primarySortPersistQueue.add("persist", {
        username,
        wbn: result.wbn,
        result,
      });
    } catch (err) {
      // Enqueue failing means this scan's DB/API side effects are lost —
      // worth knowing about loudly, but not worth failing the operator's
      // response over, since the decision itself is still correct.
      console.log({ err }, "❌ Failed to enqueue primarySortPersistQueue job");
    }

    return reply.send({ success: true, ...result });
  });
}

module.exports = primarySortRoutes;