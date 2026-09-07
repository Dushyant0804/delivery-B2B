// plugins/queues.js
const fp = require("fastify-plugin");
const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const { redisConfig } = require("../config/redis");
require("dotenv").config();

module.exports = fp(async function queuesPlugin(fastify, opts) {
  const connection = new IORedis(redisConfig);

  const ptlConfigQueue = new Queue("ptlConfigQueue", {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      attempts: 4,
      backoff: { type: "exponential", delay: 2000 },
    },
  });

  const sorterQueue = new Queue("sorterQueue", {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      attempts: 4,
      backoff: { type: "exponential", delay: 2000 },
    },
  });


  // MAIN SORT QUEUE
  const sortEngineQueue = new Queue("sortEngineQueue", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });


  // CONFIRMATION QUEUE for data deleting
  const confirmSortQueue = new Queue("confirmSortQueue", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

    // CONFIRMATION QUEUE for data deleting
  const liveFetchQueue = new Queue("liveFetchQueue", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });



  const bagSealEventQueue = new Queue("bag-seal-event", {
    connection,
    defaultJobOptions: {
      attempts: 12,                            // retry up to 12 times
      backoff: { type: "exponential", delay: 5000 }, // 5s, 10s, 20s, ...
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  const primaryApiQueue = new Queue("primaryApiQueue", {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false
    }
  });
  const calibrationQueue = new Queue("calibrationQueue", {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: true,
      removeOnFail: true
    }
  });

  // Secondary API (Delhivery secondary-sorter-event notification) —
  // triggered by the Secondary Sorting engine, not automatically after
  // Primary. See plugins/secondaryApiWorker.js.
  const secondaryApiQueue = new Queue("secondaryApiQueue", {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false
    }
  });

  // Primary Sorting (HHD) persistence — decoupled from the
  // /primary-sort/scan response; see plugins/primarySortPersistWorker.js
  const primarySortPersistQueue = new Queue("primarySortPersistQueue", {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  const dwsApiQueue = new Queue("dwsApiQueue", {
    connection,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });

  // OPTIONAL DLQ queues (if you want separate queues)
  const sortEngineDLQ = new Queue("sortEngineDLQ", { connection });
  const confirmEngineDLQ = new Queue("confirmEngineDLQ", { connection });

  fastify.decorate("queues", {
    dwsApiQueue,
    ptlConfigQueue,
    sorterQueue,
    sortEngineQueue,
    confirmSortQueue,
    liveFetchQueue,
    bagSealEventQueue,
    primaryApiQueue,
    calibrationQueue,
    secondaryApiQueue,
    primarySortPersistQueue,
    sortEngineDLQ,
    confirmEngineDLQ
  });

  console.log("🐂 BullMQ Queues registered");
});