const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const rawDb = new DatabaseSync(path.join(DATA_DIR, 'kontrolix.db'));
rawDb.exec('PRAGMA journal_mode = WAL;');

// Thin wrapper so the rest of the app can keep using the better-sqlite3-style
// `db.prepare(sql).run(...)/.get(...)/.all(...)` and `db.exec(sql)` API.
const db = {
  exec: (sql) => rawDb.exec(sql),
  prepare: (sql) => rawDb.prepare(sql),
};

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  steps TEXT NOT NULL,        -- JSON array of step definitions
  trigger_type TEXT NOT NULL DEFAULT 'manual', -- manual | cron | webhook
  trigger_config TEXT,        -- JSON: { schedule } or { secret }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | success | failed | aborted
  trigger_source TEXT,        -- manual | cron | webhook
  started_at TEXT,
  finished_at TEXT,
  current_step INTEGER DEFAULT 0,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL DEFAULT 'info', -- info | error | step
  message TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

-- One row per devCheck step execution. This is what makes Kontrolix's
-- optimizer different from static linters: it's built from containers
-- Kontrolix actually ran, not guessed limits.
CREATE TABLE IF NOT EXISTS run_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  image TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  outcome TEXT NOT NULL,          -- healthy | crashed | unhealthy
  exit_code INTEGER,
  oom_killed INTEGER DEFAULT 0,
  peak_memory_bytes INTEGER,
  peak_cpu_percent REAL,
  error_signature TEXT,           -- normalized first error line, for pattern grouping
  log_excerpt TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
`);

module.exports = db;
