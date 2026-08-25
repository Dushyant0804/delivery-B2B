// routes/operatorBagClose.js
const fp = require("fastify-plugin");

const BAG_CODE_RE = /^D(0[0-9]{2}|[1-9][0-9]{2})$/;

function chuteIdFor(bag_code) {
  return "btn" + Number(bag_code.replace("D", ""));
}

async function operatorBagCloseRoutes(fastify, opts) {

  // =========================================================
  // ✅ GET BAG SEAL STATUS — count/weight/realvolume/type/blocked,
  // combined in one call for the Bag Close/Seal page's top card.
  // Nothing existing returned all of this together.
  // =========================================================
  fastify.get("/operator/bag-seal/:bag_code/status", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { bag_code } = req.params;

      if (!bag_code || !BAG_CODE_RE.test(bag_code)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag code. Expected D001 to D999",
        });
      }

      const mapRes = await client.query(
        `SELECT type FROM bag_mappings WHERE bag_code=$1 LIMIT 1`,
        [bag_code]
      );

      if (!mapRes.rows.length) {
        return reply.code(400).send({ success: false, error: "Bag not mapped" });
      }

      const type = mapRes.rows[0].type;

      const wbnRes = await client.query(
        `SELECT count, weight, realvolume FROM bags_wbn WHERE bag_code=$1 LIMIT 1`,
        [bag_code]
      );
      const stats = wbnRes.rows[0] || { count: 0, weight: 0, realvolume: 0 };

      const chuteId = chuteIdFor(bag_code);
      const sensorRes = await client.query(
        `SELECT value FROM bag_sensors WHERE chute_id=$1 LIMIT 1`,
        [chuteId]
      );
      const blocked = sensorRes.rows.length > 0 && Number(sensorRes.rows[0].value) === 1;

      return reply.send({
        success: true,
        bag_code,
        type,
        count: Number(stats.count) || 0,
        weight: Number(stats.weight) || 0,
        realvolume: Number(stats.realvolume) || 0,
        blocked,
      });
    } catch (err) {
      fastify.log.error("GET /operator/bag-seal/:bag_code/status error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  // =========================================================
  // ✅ BLOCK — same physical action as Clear Bag's block (sensor=1),
  // but scoped to DIRECT bags only, enforced server-side regardless
  // of what the frontend already checked.
  // =========================================================
  fastify.post("/operator/bag-seal/:bag_code/block", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { bag_code } = req.params;

      if (!bag_code || !BAG_CODE_RE.test(bag_code)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag code. Expected D001 to D999",
        });
      }

      const mapRes = await client.query(
        `SELECT type FROM bag_mappings WHERE bag_code=$1 LIMIT 1`,
        [bag_code]
      );

      if (!mapRes.rows.length) {
        return reply.code(400).send({ success: false, error: "Bag not mapped" });
      }

      if (mapRes.rows[0].type !== "DIRECT") {
        return reply.code(400).send({
          success: false,
          error: "Only Direct bags can be closed/sealed",
        });
      }

      const chuteId = chuteIdFor(bag_code);
      await client.query(
        `UPDATE bag_sensors SET value=1, updated_at=NOW() WHERE chute_id=$1`,
        [chuteId]
      );

      return reply.send({ success: true, bag_code, blocked: true });
    } catch (err) {
      fastify.log.error("POST /operator/bag-seal/:bag_code/block error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  // =========================================================
  // ✅ UNBLOCK — pure sensor reset (value=0), no wbns/count/weight
  // reset. Deliberately NOT the same as Clear Bag's /clear — sealing
  // a full bag keeps its contents; this just lets the physical
  // position accept parcels again once ready.
  // =========================================================
  fastify.post("/operator/bag-seal/:bag_code/unblock", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { bag_code } = req.params;

      if (!bag_code || !BAG_CODE_RE.test(bag_code)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag code. Expected D001 to D999",
        });
      }

      const chuteId = chuteIdFor(bag_code);
      await client.query(
        `UPDATE bag_sensors SET value=0, updated_at=NOW() WHERE chute_id=$1`,
        [chuteId]
      );

      return reply.send({ success: true, bag_code, blocked: false });
    } catch (err) {
      fastify.log.error("POST /operator/bag-seal/:bag_code/unblock error:", err);
      return reply.code(500).send({ success: false, error: err.message });
    } finally {
      client.release();
    }
  });

  // =========================================================
  // ✅ BAG CLOSE (existing route — only change is step 6 below)
  // =========================================================
  fastify.post("/operator/bag-close", async (req, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { bag_code, seal_number, operatorUser } = req.body || {};

      const finalOperatorUser =
        operatorUser && operatorUser.trim()
          ? operatorUser.trim()
          : "UNKNOWN_OPERATOR";

      // -----------------------------
      // 0) Validate Operator
      // -----------------------------
      // const opRes = await client.query(
      //   `SELECT id FROM operators WHERE username=$1 LIMIT 1`,
      //   [finalOperatorUser]
      // );

      // if (!opRes.rows.length) {
      //   return reply.code(401).send({
      //     success: false,
      //     error: "Invalid operator. Please login again.",
      //   });
      // }

      // -----------------------------
      // 1) Validate bag_code
      // -----------------------------
      if (!bag_code || !BAG_CODE_RE.test(bag_code)) {
        return reply.code(400).send({
          success: false,
          error: "Invalid bag code. Expected D001 to D999",
        });
      }

      // -----------------------------
      // 2) Validate seal number basic
      // -----------------------------
      const sealStr = String(seal_number || "").trim();

      if (!sealStr) {
        return reply.code(400).send({
          success: false,
          error: "Bag seal number is required",
        });
      }

      // -----------------------------
      // 3) Regex Validation from Settings
      // -----------------------------
      const settingRes = await client.query(
        `SELECT bagseal_regexes FROM settings LIMIT 1`
      );

      const regexList = settingRes.rows[0]?.bagseal_regexes || [];

      let regexMatched = false;

      for (const r of regexList) {
        try {
          const reg = new RegExp(r);
          if (reg.test(sealStr)) {
            regexMatched = true;
            break;
          }
        } catch (e) {
          fastify.log.error("Invalid seal regex in settings:", r);
        }
      }

      if (!regexMatched) {
        return reply.code(400).send({
          success: false,
          error: "Bag seal number is not correct",
        });
      }

      // -----------------------------
      // 4) Check Seal Already Used
      // -----------------------------
      const usedRes = await client.query(
        `SELECT id FROM bagseal_events WHERE seal_number=$1 LIMIT 1`,
        [sealStr]
      );

      if (usedRes.rows.length) {
        return reply.code(400).send({
          success: false,
          error: "Please try new bag seal number",
        });
      }

      // -----------------------------
      // 5) Validate Bag Sensor
      // -----------------------------
      const chuteId = chuteIdFor(bag_code);

      const sensorRes = await client.query(
        `SELECT value FROM bag_sensors WHERE chute_id = $1 LIMIT 1`,
        [chuteId]
      );

      if (!sensorRes.rows.length) {
        return reply.code(400).send({
          success: false,
          error: `Sensor ${chuteId} not found`,
        });
      }

      if (sensorRes.rows[0].value !== 1) {
        return reply.code(400).send({
          success: false,
          error: "This bag is not ready to close",
        });
      }



      // -----------------------------
      // 6) ONLY DIRECT BAGS CAN BE CLOSED
      // Was REJECTED-only before — now Regular bags are blocked here
      // too, matching the Bag Seal page's own pre-check. Server-side
      // enforcement doesn't trust the frontend's check alone.
      // -----------------------------
      const bagTypeRes = await client.query(
        `SELECT type FROM bag_mappings WHERE bag_code=$1 LIMIT 1`,
        [bag_code]
      );

      if (!bagTypeRes.rows.length) {
        return reply.code(400).send({
          success: false,
          error: "Bag not mapped",
        });
      }

      if (bagTypeRes.rows[0].type !== "DIRECT") {
        await client.query(
          `
          INSERT INTO bag_close_status
            (bag_code, seal_number, operator_user, status, message)
          VALUES ($1,$2,$3,'REJECTED','Only Direct bags can be closed')
          ON CONFLICT (bag_code)
          DO UPDATE SET status='REJECTED', message='Only Direct bags can be closed', updated_at=now()
          `,
          [bag_code, sealStr, finalOperatorUser]
        );

        return reply.code(400).send({
          success: false,
          error: "Only Direct bags can be closed",
        });
      }

      // -----------------------------
      // 7) Ensure Queue Exists
      // -----------------------------
      if (!fastify.queues?.bagSealEventQueue) {
        return reply.code(503).send({
          success: false,
          error: "Bag seal queue unavailable (Redis down)",
        });
      }

      // -----------------------------
      // 8) INSERT INITIATED STATUS
      // -----------------------------
      await client.query(
        `
        INSERT INTO bag_close_status
          (bag_code, seal_number, operator_user, status)
        VALUES ($1,$2,$3,'INITIATED')
        ON CONFLICT (bag_code)
        DO UPDATE SET
          status='INITIATED',
          updated_at=now()
        `,
        [bag_code, sealStr, finalOperatorUser]
      );

      // -----------------------------
      // 9) ENQUEUE JOB
      // -----------------------------
      try {
        await fastify.queues.bagSealEventQueue.add(
          "bag-seal-event",
          {
            bag_code,
            seal_number: sealStr,
            operatorUser: finalOperatorUser,
          },
          {
            attempts: 3,
            backoff: { type: "fixed", delay: 5000 },
          }
        );
      } catch (err) {
        await client.query(
          `
          UPDATE bag_close_status
          SET status='FAILED', message='Redis enqueue failed'
          WHERE bag_code=$1
          `,
          [bag_code]
        );

        return reply.code(503).send({
          success: false,
          error: "Failed to enqueue bag close job (Redis down)",
        });
      }

      // -----------------------------
      // 10) OPERATOR ACK
      // -----------------------------
      return reply.send({
        success: true,
        message: "Bag close initiated successfully",
        bag_code,
      });

    } catch (err) {
      fastify.log.error("POST /operator/bag-close error:", err);
      return reply.code(500).send({
        success: false,
        error: err.message,
      });
    } finally {
      client.release();
    }
  });
}

module.exports = operatorBagCloseRoutes;