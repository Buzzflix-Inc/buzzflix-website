-- Buzz Run leaderboard (D1 database buzzflix-buzz-run). Already applied; rerun is safe.
-- npx wrangler d1 execute buzzflix-buzz-run --remote --file worker/schema.sql
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS scores_rank ON scores (score DESC, created_at ASC);
