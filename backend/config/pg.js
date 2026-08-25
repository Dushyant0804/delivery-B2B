// config/pg.js
// Single source of truth for Postgres connection settings. Every file —
// Fastify plugins/routes (via fastify.pg), worker_threads (which can't
// reach fastify.decorate at all, since they're a separate JS realm), or
// any future standalone script — should pull its pool from here instead
// of instantiating its own `new Pool({...})`. Swapping to PgBouncer, or
// retuning pool size, then becomes a one-file change.
//
// PG_PORT defaults to PgBouncer's port (6432), NOT Postgres's native
// 5432 — the app should never talk to Postgres directly once PgBouncer
// is in front of it.

const { Pool } = require("pg");

const pgConfig = {
  host: process.env.PG_HOST || "127.0.0.1",
  port: process.env.PG_PORT || 6432,
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "your_password",
  database: process.env.PG_DB || "sorter",
  max: Number(process.env.PG_POOL_MAX) || 70,
  idleTimeoutMillis: 30000,
};

// Singleton — require()'s module cache means every file that imports
// this gets the exact same pool instance, not a new one each time.
const pool = new Pool(pgConfig);

pool.on("error", (err) => {
  console.error("❌ Unexpected PG pool error:", err);
});

module.exports = { pool, pgConfig };