// server.js (Fastify + Kafka + PostgreSQL)
require("dotenv").config();
const path = require("path");
const { randomUUID } = require("crypto");
const { Worker } = require("worker_threads");
const fastify = require("fastify")({ logger: false });
const fastifyCors = require("@fastify/cors");
const fastifyStatic = require("@fastify/static");
const { WebSocketServer } = require("ws");
const { pool } = require("./config/pg");
const fastifyMultipart = require("@fastify/multipart");
const fastifyRedis = require("@fastify/redis");
const logger = require("./utils/logger");

// Per-infeed folders where each DWS machine saves images
const dwsImageDirs = {
 "01": process.env.DWS_IMAGE_DIR_1 || "D:\\Images\\Infeed1",
 "02": process.env.DWS_IMAGE_DIR_2 || "D:\\Images\\Infeed2",
};


// ===== Multipart must come BEFORE file upload routes =====
fastify.register(require("@fastify/multipart"), {
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});


fastify.register(fastifyRedis, {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
});

// ===== Register Queue + Worker =====
fastify.register(require("./plugins/queues"));

// rule loader
fastify.register(require("./plugins/sortEngine"));

// workers
fastify.register(require("./plugins/sortEngineWorker"));
fastify.register(require("./plugins/ptl-config-worker"));
fastify.register(require("./plugins/confirmSortWorker"));
fastify.register(require("./plugins/bagSealEventWorker"));
fastify.register(require("./plugins/primaryApiWorker"));
// fastify.register(require("./plugins/operatorAuthWorker"));
fastify.register(require("./plugins/regexCache"));
fastify.register(require("./plugins/calibrationWorker"));
fastify.register(require("./plugins/dwsApiWorker"));
fastify.register(require("./plugins/secondaryApiWorker"));


// ===== Routes =====
const userRoutes = require("./routes/userRoutes");
const settingsRoutes = require("./routes/settings");
const sorterPayloadRoutes = require("./routes/sorterPayloadRoutes");
const ptlUploadRoutes = require("./routes/config-ptl-upload");
const ptlListRoutes = require("./routes/config-ptl-list");
const ptlActivateRoutes = require("./routes/config-ptl-activate");
const ptlDeleteRoutes = require("./routes/config-ptl-delete");
const ptlDownloadRoutes = require("./routes/config-ptl-download");
const ptlViewRoutes = require("./routes/config-ptl-view");
const sortDebugRoutes = require("./routes/sortDebugRoutes");
const ptlDeactivateRoutes = require("./routes/config-ptl-deactivate");
const bagMappingsRoutes = require("./routes/bagMappings");
const primarySortRoutes = require("./routes/primarySort");
const bagSensorsRoutes = require("./routes/bagSensors");
const operatorBagCloseRoutes = require("./routes/operatorBagClose");
const bagsRoutes = require("./routes/bags");
const bagsOverviewRoutes = require("./routes/bagsOverview");
const operatorAuthRoutes = require("./routes/operatorAuth");
const operatorUsersRoutes = require("./routes/operatorUsers");
const sortedPayloadsRoutes = require("./routes/sortedPayloads");
const productionReportRoutes = require("./routes/productionReportRoutes");
const calibrationLogsRoutes = require("./routes/calibrationLogs");
const operatorsManagementRoutes = require("./routes/operatorsManagement");
const bagsealEventsRoutes = require("./routes/bagsealEventsRoutes");
const parcelRoutes = require("./routes/parcelRoutes");
const sampleConfigDownloadRoutes = require("./routes/sampleConfigDownload");
const bagReadyCheckRoutes = require("./routes/bagReadyCheck");
const bagResetRoute = require("./routes/bagResetRoute");
const alarmHistoryRoutes = require("./routes/alarmHistoryRoutes");
const clearBagRoutes = require("./routes/clearBag");
const secondarySortRoutes = require("./routes/secondarySort");
const primarySortingReportRoutes = require("./routes/primarysortingreport");
const secondarySortingReportRoutes = require("./routes/secondarysortingreport");
const sortedPayloadsReport = require("./routes/sortedPayloadsReport");
const sortedPayloadErrorsReportRoutes = require("./routes/sortedPayloadErrorsReport");


const { FastifyAdapter } = require("@bull-board/fastify");
const { removeUndefinedFields } = require("bullmq");

// ===== PostgreSQL Connection =====
// Pool now comes from config/pg.js — single source of truth for
// connection settings, and points at PgBouncer (port 6432) rather
// than Postgres directly.

// Test DB
(async () => {
  try {
    const res = await pool.query("SELECT current_database(), current_user;");
    console.log(`🟢 PostgreSQL OK → DB: ${res.rows[0].current_database}, User: ${res.rows[0].current_user}`);
  } catch (err) {
    console.error("❌ PostgreSQL connection failed:", err.message);
  }
})();

fastify.decorate("pg", pool);
// register setting cache
fastify.register(require("./config/settingsCache"));
// ======================================================
// 🔥 Rebuild Alarm State On Server Start
// ======================================================
async function resolveStaleAlarms() {
  const client = await fastify.pg.connect();
  try {
    const result = await client.query(`
      UPDATE alarm_history
      SET
        resolved_at      = NOW(),
        duration_seconds = EXTRACT(EPOCH FROM (NOW() - arrived_at))::INTEGER
      WHERE resolved_at IS NULL
    `);
    if (result.rowCount > 0) {
      console.log(`⚠️  Resolved ${result.rowCount} stale alarm(s) from previous session`);
    }
  } catch (err) {
    console.error("❌ resolveStaleAlarms error:", err);
  } finally {
    client.release();
  }
}

// ======================================================
// IMAGE RETRY — per-infeed directory, matched by tracking_id
// (wbn alone isn't unique enough — NO_READ scans repeat)
// ======================================================
function tryImageWithRetry(infeed, wbn, trackingId, maxWaitMs = 5000, intervalMs = 500) {
  const fs = require("fs");
  const uploadDir = path.join(__dirname, "uploads");
  const dwsImageDir = dwsImageDirs[infeed];
  const elapsed = { val: 0 };

  const timer = setInterval(async () => {
    elapsed.val += intervalMs;

    try {
      const files = fs.readdirSync(dwsImageDir);
      const matches = files.filter((f) => f.startsWith(wbn));

      if (matches.length > 0) {
        clearInterval(timer);

        matches.sort((a, b) => b.localeCompare(a));
        const latestFile = matches[0];

        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        const destFile = `${wbn}-${Date.now()}.jpg`;
        const srcPath = path.join(dwsImageDir, latestFile);
        const destPath = path.join(uploadDir, destFile);
        fs.copyFileSync(srcPath, destPath);

        const newImagepath = `/uploads/${destFile}`;

        const client = await fastify.pg.connect();
        try {
          await client.query(
            `UPDATE primary_bin_data
             SET imagepath = $1
             WHERE tracking_id = $2
             AND imagepath = 'image_missing'`,
            [newImagepath, trackingId]
          );
        } finally {
          client.release();
        }

        const update = JSON.stringify({
          type: "IMAGE_UPDATE",
          wbn,
          imagepath: newImagepath,
        });
        binClients[infeed].forEach((c) => {
          if (c.readyState === 1) c.send(update);
        });

        console.log(`🖼️  Image found after retry for ${wbn} [infeed ${infeed}]: ${newImagepath}`);
      } else if (elapsed.val >= maxWaitMs) {
        clearInterval(timer);
        console.log(`⚠️  No image found for ${wbn} [infeed ${infeed}] after ${maxWaitMs}ms — staying as image_missing`);
      }
    } catch (e) {
      clearInterval(timer);
      console.error(`❌ Image retry error for ${wbn} [infeed ${infeed}]:`, e.message);
    }
  }, intervalMs);
}


// ===== Register REST Routes =====
fastify.register(userRoutes, { prefix: "/api/users" });
fastify.register(settingsRoutes, { prefix: "/api/settings" });
fastify.register(sorterPayloadRoutes, { prefix: "/api/sorter-payloads" });
fastify.register(ptlUploadRoutes, { prefix: "/api" });
fastify.register(ptlListRoutes, { prefix: "/api" });
fastify.register(ptlActivateRoutes, { prefix: "/api" });
fastify.register(ptlDeleteRoutes, { prefix: "/api" });
fastify.register(ptlDownloadRoutes, { prefix: "/api" });
fastify.register(ptlViewRoutes, { prefix: "/api" });
fastify.register(ptlDeactivateRoutes, { prefix: "/api" });
fastify.register(sortDebugRoutes, { prefix: "/api" });
fastify.register(bagMappingsRoutes, { prefix: "/api" });
fastify.register(primarySortRoutes, { prefix: "/api" });
fastify.register(bagSensorsRoutes, { prefix: "/api" });
fastify.register(operatorBagCloseRoutes, { prefix: "/api" });
fastify.register(bagsRoutes, { prefix: "/api" });
fastify.register(bagsOverviewRoutes, { prefix: "/api" });
fastify.register(operatorAuthRoutes, { prefix: "/api" });
fastify.register(operatorUsersRoutes, { prefix: "/api" });
fastify.register(sortedPayloadsRoutes, { prefix: "/api" });
fastify.register(productionReportRoutes, { prefix: "/api" });
fastify.register(calibrationLogsRoutes, { prefix: "/api" });
fastify.register(operatorsManagementRoutes, { prefix: "/api" });
fastify.register(bagsealEventsRoutes, { prefix: "/api" });
fastify.register(parcelRoutes, { prefix: "/api" });
fastify.register(sampleConfigDownloadRoutes, { prefix: "/api" });
fastify.register(bagReadyCheckRoutes, { prefix: "/api" });
fastify.register(bagResetRoute, { prefix: "/api" });
fastify.register(alarmHistoryRoutes, { prefix: "/api" });
fastify.register(clearBagRoutes, { prefix: "/api" });
fastify.register(secondarySortRoutes, { prefix: "/api" });
fastify.register(primarySortingReportRoutes, { prefix: "/api" });
fastify.register(secondarySortingReportRoutes, { prefix: "/api" });
fastify.register(sortedPayloadsReport, { prefix: "/api" });
fastify.register(sortedPayloadErrorsReportRoutes, { prefix: "/api" });



// ======================================================
// 5) WebSocket Setup (FIXED for Fastify)
// ======================================================
const server = fastify.server;
const wss = new WebSocketServer({ noServer: true });

const PING_INTERVAL = 30000; // 30 seconds

function heartbeat() {
  this.isAlive = true;
}

// Mark connection alive on pong
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);
});

// Ping clients periodically
const wsPingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log("💀 WS terminated (no pong)");
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(); // 🔥 KEEP CONNECTION ALIVE
  });
}, PING_INTERVAL);

// Connected clients — separate sets per infeed so broadcasts
// never cross between the two physical conveyors
const binClients = {
  "01": new Set(),
  "02": new Set(),
};
const confirmationClients = new Set();
const sortResultClients = new Set();
const machineStatusClients = new Set();
const alarmState = new Map();

// Upgrade handler (CRITICAL FIX)
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(
    request.url,
    `http://${request.headers.host}`
  ).pathname;

  if (
    pathname === "/bin-data-1" ||
    pathname === "/bin-data-2" ||
    pathname === "/confirmation-data" ||
    pathname === "/sort-result" ||
    pathname === "/bag-sensors" ||
    pathname === "/machine-status"
  ) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }

});

// Broadcast helper
fastify.decorate("broadcastSortResult", (result) => {
  const msg = JSON.stringify(result);
  for (const ws of sortResultClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
});

// ======================================================
// BIN DATA HANDLER — shared by both infeed WS endpoints
// ======================================================
async function handleBinData(infeed, ws, data) {
  console.log(`📥 BIN Event [infeed ${infeed}]:`, data);

  const {
    id,
    wbn: scannedWbn,
    length,
    width,
    height,
    weight,
    Volume,
    RealVolume,
    mode
  } = data;

  if (!scannedWbn) return;

  // Unique per-scan id — this is what the sort worker uses to
  // update the right primary_bin_data row later (wbn alone isn't
  // unique: NO_READ scans, for example, all share the same value).
  const trackingId = randomUUID();
  const dwsImageDir = dwsImageDirs[infeed];

  // ------------------------------------------------
  // IMAGE MATCHING (per-infeed image directory)
  // ------------------------------------------------
  let imagepath = "image_missing";

  try {
    const fs = require("fs");
    const files = fs.readdirSync(dwsImageDir);
    const matchingFiles = files.filter((f) => f.startsWith(scannedWbn));

    if (matchingFiles.length > 0) {
      matchingFiles.sort((a, b) => b.localeCompare(a));
      const latestFile = matchingFiles[0];

      const uploadDir = path.join(__dirname, "uploads");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

      const destFile = `${scannedWbn}-${Date.now()}.jpg`;
      const sourcePath = path.join(dwsImageDir, latestFile);
      const destPath = path.join(uploadDir, destFile);

      fs.copyFileSync(sourcePath, destPath);
      imagepath = `/uploads/${destFile}`;
    } else {
      setImmediate(() => tryImageWithRetry(infeed, scannedWbn, trackingId));
    }
  } catch (e) {
    console.error("❌ Image match error:", e);
  }

  // ------------------------------------------------
  // DB INSERT
  // scanned_wbn = raw as-scanned value, written once, never touched again.
  // wbn starts equal to it; the sort worker overwrites wbn with the
  // final validated value once precheck/resolveShipment resolves it.
  // ------------------------------------------------
  const client = await fastify.pg.connect();
  try {
    await client.query(
      `INSERT INTO primary_bin_data
       (wbn, scanned_wbn, length, width, height, weight, volume, real_volume, imagepath, mode, tracking_id, infeed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [scannedWbn, scannedWbn, length, width, height, weight, Volume, RealVolume, imagepath, mode, trackingId, infeed]
    );
  } finally {
    client.release();
  }


const settings = await fastify.getSettings();

  // 🧪 CALIBRATION ROUTING (FIRST PRIORITY)
  if (settings.calibration_wbn && scannedWbn === settings.calibration_wbn) {
    await fastify.queues.calibrationQueue.add("calibration", data);
    console.log("🧪 Calibration box routed:", scannedWbn);
    return; // 🔥 DO NOT PROCESS AS NORMAL PARCEL
  }

  fastify.queues.dwsApiQueue.add("dws-process", {
      trackingId,
      wbn: scannedWbn,
      infeed,
      length,
      width,
      height,
      weight,
      Volume,
      RealVolume,
      imagepath,
    }),


  await fastify.queues.sortEngineQueue.add("shipSort", {
    id,
    wbn: scannedWbn,
    trackingId,
    infeed,
    length,
    width,
    height,
    weight,
    Volume,
    RealVolume,
  });
  return
}

// ======================================================
// 6) WebSocket Routing
// ======================================================
wss.on("connection", async (ws, req) => {
  const wsPath = new URL(req.url, `http://${req.headers.host}`).pathname;

  // ----------------------------------------------------
  // BIN DATA WS — dual infeed
  // ----------------------------------------------------
  if (wsPath === "/bin-data-1" || wsPath === "/bin-data-2") {
    const infeed = wsPath === "/bin-data-1" ? "01" : "02";
    console.log(`📦 WS Connected: ${wsPath}`);
    binClients[infeed].add(ws);

    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);
        // ❤️ heartbeat support
        if (data?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        await handleBinData(infeed, ws, data);
      } catch (err) {
        console.error(`❌ ${wsPath} WS error:`, err);
        ws.send(JSON.stringify({ error: true, message: err.message }));
      }
    });

    ws.on("close", () => {
      console.log(`❌ WS Closed: ${wsPath}`);
      binClients[infeed].delete(ws);
    });

    return;
  }

  // ----------------------------------------------------
  // SORT RESULT WS (UNCHANGED)
  // ----------------------------------------------------
  if (wsPath === "/sort-result") {
    console.log("📦 WS Connected: /sort-result");
    sortResultClients.add(ws);
    ws.on("close", () => sortResultClients.delete(ws));
    return;
  }

  // ----------------------------------------------------
  // CONFIRMATION WS
  // ----------------------------------------------------
  if (wsPath === "/confirmation-data") {
    console.log("📝 WS Connected: /confirmation-data");
    confirmationClients.add(ws);
    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);
        console.log(":outbox_tray: CONFIRMATION Event:", data);
        const id = data.id;
        const wbn = data.wbn || data.barcode;
        const sort = data.sort; // "SORTED" or "REJECTED" — the only field we use for the sort column
        const bag_code = data.bag_code;
        if (!wbn) {
          console.warn(":warning: Received confirmation without WBN:", data);
          return;
        }
        // Both SORTED and REJECTED continue through the pipeline (REJECTED
        // still needs its reason/status recorded in the DB) — no early
        // ignore gate here anymore.
        if (!bag_code) {
          console.warn(":warning: Missing bag_code in confirmation:", data);
          ws.send(JSON.stringify({ id, wbn, status: "NO_BAG_CODE" }));
          return;
        }

        // 🔥 PLC confirmation payload doesn't include tracking_id at all — that's
        // expected. primaryApiWorker / secondaryApiWorker both fall back to a
        // wbn-based lookup (ORDER BY id DESC LIMIT 1) whenever tracking_id is
        // missing, so we just pass data.tracking_id through as-is (undefined is
        // fine — it's a property read, not a bare identifier, so it can't throw).
        //
        // The "status" field PLC also sends is unused/ignored everywhere below —
        // "sort" (data.sort, values "SORTED"/"REJECTED") is the single source of
        // truth for the sort column across all three queues.
        await fastify.queues.primaryApiQueue.add("primary", {
          wbn: data.wbn,
          bag_code: data.bag_code,
          sort,                       // SORTED or REJECTED
          reason: data.reason,
          tracking_id: data.tracking_id,
        });
        // ----------------------------------------------------
        // 2) ENQUEUE NEW confirmSort queue
        // ----------------------------------------------------
        await fastify.queues.confirmSortQueue.add("confirm", {
          id,
          wbn,
          bag_code,
          sort,
          reason: data.reason || null
        });

        await fastify.queues.secondaryApiQueue.add("secondary-event", {
          wbn,
          bag_code,
          ptl_id: data.ptl_id,
          sort,
          reason: data.reason,
          tracking_id: data.tracking_id,
        });
        // ----------------------------------------------------
        // 3) Send response to PLC
        // ----------------------------------------------------
        ws.send(JSON.stringify({ id, wbn, status: "CONFIRM_QUEUED" }));
      } catch (err) {
        console.error(":x: confirmation WS error:", err);
      }
    });

    ws.on("close", () => confirmationClients.delete(ws));
    return;
  }

  // ----------------------------------------------------
  // MACHINE STATUS WS (ALARMS + HISTORY)
  // ----------------------------------------------------
  if (wsPath === "/machine-status") {
    console.log("🚨 WS Connected: /machine-status");
    machineStatusClients.add(ws);

    if (alarmState.size > 0) {
      const snapshot = {};
      alarmState.forEach((val, key) => { snapshot[key] = val; });
      ws.send(JSON.stringify({
        type: "ALARM_UPDATE",
        data: snapshot,
        time: new Date().toISOString(),
      }));
      console.log(`📡 Sent alarm snapshot (${alarmState.size} codes) to new client`);
    }

    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);

        if (data?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        const alarmDictionary = require("./config/alarmDictionary");
        const client = await fastify.pg.connect();

        try {
          for (const code in data) {
            const newState = Number(data[code]);
            const oldState = alarmState.get(code) || 0;

            if (oldState === 0 && newState === 1) {
              const message = alarmDictionary[code]?.message || "UNKNOWN";
              await client.query(
                `INSERT INTO alarm_history (code, message, arrived_at)
                 VALUES ($1, $2, NOW())`,
                [code, message]
              );
              console.log(`🟢 Alarm Arrived: ${code}`);
            }

            if (oldState === 1 && newState === 0) {
              await client.query(
                `UPDATE alarm_history
                 SET
                   resolved_at      = NOW(),
                   duration_seconds = EXTRACT(EPOCH FROM (NOW() - arrived_at))::INTEGER
                 WHERE code = $1
                 AND resolved_at IS NULL`,
                [code]
              );
              console.log(`🔴 Alarm Resolved: ${code}`);
            }

            alarmState.set(code, newState);
          }
        } finally {
          client.release();
        }

        const payload = JSON.stringify({
          type: "ALARM_UPDATE",
          data,
          time: new Date().toISOString(),
        });

        machineStatusClients.forEach((c) => {
          if (c.readyState === 1) c.send(payload);
        });

      } catch (err) {
        console.error("❌ /machine-status WS error:", err);
      }
    });

    ws.on("close", () => {
      console.log("❌ WS Closed: /machine-status");
      machineStatusClients.delete(ws);
    });

    return;
  }

  // ----------------------------------------------------
  // BAG SENSORS WS (UNCHANGED)
  // ----------------------------------------------------
  if (wsPath === "/bag-sensors") {
    console.log("WS Connected: /bag-sensors");
    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);  // contains btn1..btn96 + snr1..snr96
        console.log(data);
        const client = await fastify.pg.connect();
        try {
          await client.query("BEGIN");
          for (let i = 1; i <= 96; i++) {
            let btnKey = `btn${i}`;
            let snrKey = `snr${i}`;
            await client.query(
              `UPDATE bag_sensors
             SET value = $1, updated_at = NOW()
             WHERE chute_id = $2`,
              [data[btnKey] ?? 0, btnKey]
            );
            await client.query(
              `UPDATE bag_sensors
             SET value = $1, updated_at = NOW()
             WHERE chute_id = $2`,
              [data[snrKey] ?? 0, snrKey]
            );
          }
          await client.query("COMMIT");
          ws.send(JSON.stringify({ status: "UPDATED" }));
        } catch (err) {
          await client.query("ROLLBACK");
          console.error("DB Update Error:", err);
          ws.send(JSON.stringify({ error: err.message }));
        } finally {
          client.release();
        }
      } catch (err) {
        console.error("bag-sensors WS error:", err);
      }
    });
    ws.on("close", () => console.log("WS Closed: /bag-sensors"));
    return;
  }
});


fastify.get("/debug/queues", (req, reply) => {
  return reply.send({ queues: fastify.queues });
});

const serverAdapter = new FastifyAdapter();

fastify.after(() => {
  const { createBullBoard } = require("@bull-board/api");
  const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");

  if (!fastify.queues) {
    fastify.log.error("❌ Queues not registered, Bull Board disabled");
    return;
  }

  const { ptlConfigQueue,
    sorterQueue,
    sortEngineQueue,
    sortEngineDLQ,
    confirmEngineDLQ,
    primaryApiQueue,
    secondaryApiQueue,
    bagSealEventQueue,
    confirmSortQueue,
    calibrationQueue,
    primarySortPersistQueue,
    dwsApiQueue } = fastify.queues;

  createBullBoard({
    queues: [
      new BullMQAdapter(ptlConfigQueue),
      new BullMQAdapter(sorterQueue),
      new BullMQAdapter(sortEngineQueue),
      new BullMQAdapter(sortEngineDLQ),
      new BullMQAdapter(confirmEngineDLQ),
      new BullMQAdapter(confirmSortQueue),
      new BullMQAdapter(primaryApiQueue),
      new BullMQAdapter(secondaryApiQueue),
      new BullMQAdapter(bagSealEventQueue),
      new BullMQAdapter(calibrationQueue),
      new BullMQAdapter(primarySortPersistQueue),
      new BullMQAdapter(dwsApiQueue),
    ],
    serverAdapter,
  });

  fastify.register(serverAdapter.registerPlugin(), {
    prefix: "/admin/queues", // Dashboard URL
  });

  fastify.log.info("📊 Bull Board running at /admin/queues");
});

// ===== CORS =====
fastify.register(fastifyCors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

fastify.register(require("@fastify/static"), {
  root: path.join(process.cwd(), "configfiles"),
  prefix: "/config-files/",
  decorateReply: false   // 🔥 THIS FIXES THE ERROR
});

fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "uploads"),
  prefix: "/uploads/",
  decorateReply: false
});

// ===== Static Frontend Build =====
fastify.register(fastifyStatic, {
  root: path.join(__dirname, "../wms-frontend/build"),
  prefix: "/",
});

// ===== Fallback to SPA =====
fastify.setNotFoundHandler((req, reply) => {
  reply.sendFile("index.html");
});

// ===== Start Server =====
fastify.listen({ port: 5001, host: "0.0.0.0" }, async (err, addr) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🚀 Server running at ${addr}`);
  logger.info(`🚀 Server running at ${addr}`);
  await resolveStaleAlarms();
});

fastify.addHook("onClose", (instance, done) => {
  clearInterval(wsPingInterval);
  done();
});