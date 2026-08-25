// plugins/bagSealEventWorker.js
const fp = require("fastify-plugin");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");

module.exports = fp(async function bagSealEventWorkerPlugin(fastify) {
  const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
  });

  async function loadSettings(client) {
    const res = await client.query(`SELECT * FROM settings LIMIT 1`);
    if (!res.rows.length) throw new Error("Settings missing");

    const s = res.rows[0];
    if (!s.bag_seal_api_token) throw new Error("bag_seal_api_token missing");

    return {
      sorter_id: s.sorter_name,
      operator_user: "OperatorApp",
      token: s.bag_seal_api_token,
    };
  }

  new Worker(
    "bag-seal-event",
    async (job) => {
      const { bag_code, seal_number, operatorUser } = job.data || {};
      const client = await fastify.pg.connect();

      if (!bag_code || !seal_number) {
        client.release();
        return { success: false, error: "Invalid job data" };
      }

      try {
        // --------------------------------------------------
        // MARK PROCESSING
        // --------------------------------------------------
        await client.query(
          `
          UPDATE bag_close_status
          SET status='PROCESSING', updated_at=now()
          WHERE bag_code=$1
          `,
          [bag_code]
        );

        await client.query("BEGIN");

        // --------------------------------------------------
        // 1) Load bag from bags_wbn
        // --------------------------------------------------
        const bagRes = await client.query(
          `SELECT wbns, first_drop_at FROM bags_wbn WHERE bag_code=$1 LIMIT 1`,
          [bag_code]
        );

        if (!bagRes.rows.length) {
          throw new Error(`Bag ${bag_code} not found in bags_wbn`);
        }

        const { wbns, first_drop_at } = bagRes.rows[0];

        if (!Array.isArray(wbns) || wbns.length === 0) {
          throw new Error(`Bag ${bag_code} has no WBNs`);
        }

        // --------------------------------------------------
        // 2) Resolve BI & BT using ACTIVE CONFIG + BAGS
        // --------------------------------------------------
        const cfgRes = await client.query(
          `SELECT id FROM sorter_configs WHERE is_active=true LIMIT 1`
        );

        if (!cfgRes.rows.length) {
          throw new Error("No active sorter configuration found");
        }

        const activeConfigId = cfgRes.rows[0].id;

        const bagCfgRes = await client.query(
          `
          SELECT bagidentifier, bagtype
          FROM bags
          WHERE config_id=$1 AND bag_code=$2
          LIMIT 1
          `,
          [activeConfigId, bag_code]
        );

        if (!bagCfgRes.rows.length) {
          throw new Error(
            `Bag ${bag_code} not mapped in active config ${activeConfigId}`
          );
        }

        const { bagidentifier: bi, bagtype: bt } = bagCfgRes.rows[0];

        // --------------------------------------------------
        // 3) Resolve destination using sort_events
        // --------------------------------------------------
        let cnValues = [];
        let fallbackBranchCode = null;

        for (const wbn of wbns) {
          const evRes = await client.query(
            `
            SELECT details
            FROM sort_events
            WHERE wbn=$1 AND event_type='SORT_SUCCESS'
            ORDER BY id DESC
            LIMIT 1
            `,
            [wbn]
          );

          if (!evRes.rows.length) {
            throw new Error(`SORT_SUCCESS not found for WBN ${wbn}`);
          }

          const rule = evRes.rows[0].details?.result?.matchedRule;
          if (!rule) throw new Error(`matchedRule missing for WBN ${wbn}`);

          cnValues.push(rule.cn);
          if (!fallbackBranchCode) fallbackBranchCode = rule.cn_branch_code;
        }

        const allSameCn = cnValues.every((v) => v === cnValues[0]);
        const destination = allSameCn ? cnValues[0] : fallbackBranchCode;

        // --------------------------------------------------
        // 4) Load settings (token + sorter id)
        // --------------------------------------------------
        const settings = await loadSettings(client);

        // --------------------------------------------------
        // 5) Format SD time (Postgres timestamptz style)
        //     Example: 2023-06-22T05:44:46.558337+00:00
        // --------------------------------------------------
        const sd =
          first_drop_at instanceof Date
            ? first_drop_at.toISOString().replace("Z", "+00:00")
            : null;

        const payload = {
          schema_name: "falcon-bag-seal-event-new",
          version: "v1",
          data: [
            {
              action_source: "BAG_SEAL_EVENT",
              bi,                // from bags table
              bs: seal_number,
              bt,                // from bags table
              destination,
              ed: new Date().toISOString().replace("Z", "+00:00"),
              origin: bi,
              ptlid: bag_code,
              sd,
              sorter_id: settings.sorter_id,
              u: operatorUser || settings.operator_user,
              wbns,
            },
          ],
        };

        // --------------------------------------------------
        // 6) Call API
        // --------------------------------------------------
        const res = await fetch("https://dev-stream.delhivery.com/v1", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: settings.token,
          },
          body: JSON.stringify(payload),
        });

        const body = await res.json().catch(() => null);

        const ok =
          res.status === 200 &&
          body?.success === true &&
          Array.isArray(body.data?.accepted);

        if (!ok) {
          throw new Error("Bag seal API rejected");
        }

        // --------------------------------------------------
        // 7) Store audit
        // --------------------------------------------------
        await client.query(
          `
          INSERT INTO bagseal_events
            (bag_code, seal_number, wbns, destination, operator_user,
             first_drop_at, request_payload, response_payload, success)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
          `,
          [
            bag_code,
            seal_number,
            wbns,
            destination,
            operatorUser || settings.operator_user,
            first_drop_at,
            payload,
            body,
          ]
        );

        // --------------------------------------------------
        // MARK SUCCESS
        // --------------------------------------------------
        await client.query(
          `
          UPDATE bag_close_status
          SET status='SUCCESS',
              response_payload=$2,
              updated_at=now()
          WHERE bag_code=$1
          `,
          [bag_code, body]
        );

        // --------------------------------------------------
        // 7.5) TURN OFF PTL INDICATOR (Node-RED)
        // --------------------------------------------------
        try {
          const chuteNum = Number(bag_code.replace("D", ""));
          const indicatorKey = `indicator_chute${chuteNum}`;

          await fetch("http://localhost:1880/api/ptl-indicator", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              indicator: indicatorKey,
              value: true
            })
          });

        } catch (err) {
          // ⚠ Do NOT fail worker if indicator OFF fails
          console.error("⚠ Failed to turn OFF PTL indicator:", err.message);
        }

        // --------------------------------------------------
        // 8) Clear bag data
        // --------------------------------------------------
        await client.query(
          `
          UPDATE bags_wbn
          SET wbns='{}', first_drop_at=NULL, updated_at=NOW()
          WHERE bag_code=$1
          `,
          [bag_code]
        );

        await client.query(
          `
          UPDATE bag_mappings
          SET wbns='{}', updated_at=NOW()
          WHERE bag_code=$1
          `,
          [bag_code]
        );

        await client.query("COMMIT");

        return {
          success: true,
          bag_code,
          destination,
          count: wbns.length,
        };

      } catch (err) {
        await client.query("ROLLBACK");

        // --------------------------------------------------
        // LOG FAILURE BUT DO NOT THROW (QUEUE SAFE)
        // --------------------------------------------------
        try {
          await client.query(
            `
            UPDATE bag_close_status
            SET status='FAILED',
                message=$2,
                updated_at=now()
            WHERE bag_code=$1
            `,
            [bag_code, err.message]
          );
        } catch (logErr) {
          console.error("❌ Failed to log bag_close_status:", logErr);
        }

        console.error("❌ bagSealEventWorker error:", err.message);

        return {
          success: false,
          bag_code,
          error: err.message,
        };

      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: Number(process.env.BAG_SEAL_EVENT_CONC || 3),
    }
  );

  console.log("⚙ bagSealEventWorker running (config-based BI/BT, queue-safe)");
});
