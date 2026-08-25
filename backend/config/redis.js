// config/redis.js
// Single source of truth for Dragonfly/Redis connection settings.
//
// Two different things are exported on purpose:
//
// - redisConfig: plain options object. Every BullMQ Worker (sortEngineQueue,
//   confirmSortQueue, ptlConfigQueue, etc.) must build its OWN IORedis
//   instance from this — `new IORedis(redisConfig)` — never share one
//   connection across multiple Workers. A Worker's blocking job-poll can
//   otherwise queue up behind (or hold up) whatever else shares that socket.
//
// - sharedClient: a singleton IORedis instance for plain, non-blocking
//   cache reads/writes only — GET/SET/HMGET/HSET/DEL/EXPIRE, that kind of
//   thing. Safe to share everywhere, since none of these block. require()'s
//   module cache means every file that imports this gets the same instance.

const IORedis = require("ioredis");

const redisConfig = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
};

const sharedClient = new IORedis(redisConfig);

sharedClient.on("error", (err) => {
  console.error("❌ Shared Dragonfly/Redis client error:", err);
});

module.exports = { redisConfig, sharedClient };