-- Applications and the staff area (D1 database buzzflix-applications, binding APPS in wrangler.jsonc).
-- Kept apart from the Buzz Run leaderboard so applicant data has its own database. Rerunning is safe.
-- npx wrangler d1 execute buzzflix-applications --remote --file worker/applications-schema.sql

-- One row per submitted application. id is the form's submission_id (a UUID), so a retried submit can't save twice.
-- resume_key and portfolio_key name the PDFs in the R2 bucket buzzflix-application-documents, or are NULL.
-- status: new, reviewing, interview, approved, denied or withdrawn. assigned_to is a staff email or NULL.
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  year TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  school TEXT NOT NULL,
  program_year TEXT NOT NULL,
  experience TEXT NOT NULL,
  why_join TEXT NOT NULL,
  role_1 TEXT NOT NULL,
  role_2 TEXT NOT NULL,
  role_3 TEXT NOT NULL,
  additional_roles TEXT NOT NULL DEFAULT '',
  resume_key TEXT,
  portfolio_key TEXT,
  consent_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to TEXT
);
CREATE INDEX IF NOT EXISTS applications_by_year ON applications (year, submitted_at DESC);

-- Staff comments on an application, and a log of every change (status, assignment, note, delete).
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_by_application ON notes (application_id, created_at);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_by_application ON activity (application_id, created_at);

-- Answers saved with "Email me my answers"; /apply#draft=<id> loads them back.
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  answers TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);

-- Anyone with an @buzzflix.ca address can sign in; their row is made on first sign-in (or by an admin beforehand).
-- role: admin or member. blocked = 1 stops someone signing in and ends their sessions.
CREATE TABLE IF NOT EXISTS staff (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Sign-in codes (only a hash is kept) and sessions (the cookie holds the token; only its hash is kept).
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_codes_by_email ON login_codes (email, created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Rate limits: one row per counted event (code requests, draft saves, submissions). Old rows are pruned.
CREATE TABLE IF NOT EXISTS rate_events (
  bucket TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_by_bucket ON rate_events (bucket, at);
