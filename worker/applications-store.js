/**
 * Storage for applications and the staff area. d1Store/r2Files run on Cloudflare (worker/index.js);
 * memoryStore/memoryFiles run in the local preview (scripts/serve.mjs) and the tests, and empty on restart.
 * Both stores have the same methods. Schema: worker/applications-schema.sql.
 */

// Columns the staff list shows; the long answers load only on an application's own page.
const SUMMARY = ['id', 'year', 'submitted_at', 'updated_at', 'name', 'email', 'school', 'program_year',
  'role_1', 'role_2', 'role_3', 'additional_roles', 'status', 'assigned_to'];
const EDITABLE = ['status', 'assigned_to'];
const STAFF_EDITABLE = ['name', 'role', 'blocked'];

export const d1Store = db => {
  const one = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const set = (fields, allowed) => {
    const keys = Object.keys(fields).filter(key => allowed.includes(key));
    return {keys, sql: keys.map(key => `${key} = ?`).join(', '), values: keys.map(key => fields[key])};
  };
  return {
    // Counts this event against a limit of `limit` per `windowMs`. Returns false (and counts nothing) when over.
    async hit(bucket, now, windowMs, limit) {
      await run('DELETE FROM rate_events WHERE at < ?', now - 24 * 60 * 60 * 1000);
      const {count} = await one('SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ? AND at > ?', bucket, now - windowMs);
      if (count >= limit) return false;
      await run('INSERT INTO rate_events (bucket, at) VALUES (?, ?)', bucket, now);
      return true;
    },

    getStaff: email => one('SELECT * FROM staff WHERE email = ?', email),
    async addStaff({email, name, role = 'member'}, now) {
      await run('INSERT OR IGNORE INTO staff (email, name, role, created_at) VALUES (?, ?, ?, ?)', email, name, role, now);
      return one('SELECT * FROM staff WHERE email = ?', email);
    },
    listStaff: () => all('SELECT * FROM staff ORDER BY name COLLATE NOCASE'),
    async updateStaff(email, fields) {
      const {keys, sql, values} = set(fields, STAFF_EDITABLE);
      if (keys.length) await run(`UPDATE staff SET ${sql} WHERE email = ?`, ...values, email);
      return one('SELECT * FROM staff WHERE email = ?', email);
    },
    touchStaff: (email, now) => run('UPDATE staff SET last_seen_at = ? WHERE email = ?', now, email),

    addCode: (email, hash, now, expires) =>
      run('INSERT INTO login_codes (email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', email, hash, now, expires),
    latestCode: email => one('SELECT * FROM login_codes WHERE email = ? ORDER BY created_at DESC, id DESC LIMIT 1', email),
    countAttempt: id => run('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?', id),
    clearCodes: email => run('DELETE FROM login_codes WHERE email = ?', email),

    async addSession(hash, email, now, expires) {
      await run('DELETE FROM sessions WHERE expires_at < ?', now);
      await run('INSERT INTO sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)', hash, email, now, expires);
    },
    getSession: hash => one('SELECT * FROM sessions WHERE token_hash = ?', hash),
    deleteSession: hash => run('DELETE FROM sessions WHERE token_hash = ?', hash),
    deleteSessionsFor: email => run('DELETE FROM sessions WHERE email = ?', email),

    // Returns false when an application with this id already exists.
    async insertApplication(row) {
      const keys = Object.keys(row);
      const result = await run(`INSERT OR IGNORE INTO applications (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        ...keys.map(key => row[key]));
      return result.meta.changes === 1;
    },
    getApplication: id => one('SELECT * FROM applications WHERE id = ?', id),
    listApplications: year => all(`SELECT ${SUMMARY.join(', ')} FROM applications WHERE year = ? ORDER BY submitted_at DESC`, year),
    async years() {
      return (await all('SELECT DISTINCT year FROM applications ORDER BY year DESC')).map(row => row.year);
    },
    async updateApplication(id, fields, now) {
      const {keys, sql, values} = set(fields, EDITABLE);
      if (keys.length) await run(`UPDATE applications SET ${sql}, updated_at = ? WHERE id = ?`, ...values, now, id);
      return one('SELECT * FROM applications WHERE id = ?', id);
    },
    async deleteApplication(id) {
      await db.batch(['notes', 'activity', 'scorecards', 'applicant_emails'].map(table => db.prepare(`DELETE FROM ${table} WHERE application_id = ?`).bind(id))
        .concat(db.prepare('DELETE FROM applications WHERE id = ?').bind(id)));
    },
    // When someone is blocked: their applications lose their assignee, and any In review go back to New.
    clearAssignee: (email, now) => run(`UPDATE applications SET assigned_to = NULL, updated_at = ?,
      status = CASE WHEN status = 'reviewing' THEN 'new' ELSE status END WHERE assigned_to = ?`, now, email),

    addNote: (applicationId, author, body, now, kind = 'note') =>
      one('INSERT INTO notes (application_id, author, body, kind, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *', applicationId, author, body, kind, now),
    listNotes: applicationId => all('SELECT * FROM notes WHERE application_id = ? ORDER BY created_at, id', applicationId),
    addActivity: (applicationId, actor, action, detail, now) =>
      run('INSERT INTO activity (application_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)', applicationId, actor, action, detail, now),
    listActivity: applicationId => all('SELECT * FROM activity WHERE application_id = ? ORDER BY created_at DESC, id DESC', applicationId),

    putDraft: (id, email, answers, now) => run('INSERT INTO drafts (id, email, answers, saved_at) VALUES (?, ?, ?, ?)', id, email, answers, now),
    getDraft: id => one('SELECT * FROM drafts WHERE id = ?', id),

    addScorecard: (applicationId, author, scores, notes, recommendation, now) =>
      run('INSERT INTO scorecards (application_id, author, scores, notes, recommendation, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        applicationId, author, scores, notes, recommendation, now),
    listScorecards: applicationId => all('SELECT * FROM scorecards WHERE application_id = ? ORDER BY created_at, id', applicationId),
    addEmail: (applicationId, sender, template, subject, body, sent, now) =>
      run('INSERT INTO applicant_emails (application_id, sender, template, subject, body, sent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        applicationId, sender, template, subject, body, sent, now),
    listEmails: applicationId => all('SELECT * FROM applicant_emails WHERE application_id = ? ORDER BY created_at DESC, id DESC', applicationId),

    // Who has which application open: one row per person, updated each time their page checks for changes.
    setPresence: (email, applicationId, now) => run(`INSERT INTO presence (email, application_id, seen_at) VALUES (?, ?, ?)
      ON CONFLICT (email) DO UPDATE SET application_id = excluded.application_id, seen_at = excluded.seen_at`, email, applicationId, now),
    listPresence: since => all('SELECT * FROM presence WHERE seen_at > ?', since),

    // A counter that goes up on every change, which open staff pages check to know when to reload.
    bump: () => run("INSERT INTO meta (key, value) VALUES ('version', 1) ON CONFLICT (key) DO UPDATE SET value = value + 1"),
    async version() {
      return (await one("SELECT value FROM meta WHERE key = 'version'"))?.value || 0;
    }
  };
};

export function memoryStore() {
  const rate = [], staff = new Map(), codes = [], sessions = new Map(), applications = new Map(), notes = [], activity = [], drafts = new Map();
  const scorecards = [], emails = [], presence = new Map();
  let nextId = 1, version = 0;
  const copy = row => row ? {...row} : null; // D1 gives null for a missing row
  const pick = (fields, allowed) => Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.includes(key)));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'});
  return {
    async hit(bucket, now, windowMs, limit) {
      if (rate.filter(event => event.bucket === bucket && event.at > now - windowMs).length >= limit) return false;
      rate.push({bucket, at: now});
      return true;
    },

    getStaff: async email => copy(staff.get(email)),
    async addStaff({email, name, role = 'member'}, now) {
      if (!staff.has(email)) staff.set(email, {email, name, role, blocked: 0, created_at: now, last_seen_at: null});
      return copy(staff.get(email));
    },
    listStaff: async () => [...staff.values()].map(copy).sort(byName),
    async updateStaff(email, fields) {
      if (staff.has(email)) Object.assign(staff.get(email), pick(fields, STAFF_EDITABLE));
      return copy(staff.get(email));
    },
    touchStaff: async (email, now) => { if (staff.has(email)) staff.get(email).last_seen_at = now; },

    addCode: async (email, code_hash, created_at, expires_at) => { codes.push({id: nextId++, email, code_hash, attempts: 0, created_at, expires_at}); },
    latestCode: async email => copy(codes.filter(code => code.email === email).at(-1)),
    countAttempt: async id => { const code = codes.find(row => row.id === id); if (code) code.attempts++; },
    clearCodes: async email => { for (let i = codes.length - 1; i >= 0; i--) if (codes[i].email === email) codes.splice(i, 1); },

    addSession: async (token_hash, email, created_at, expires_at) => { sessions.set(token_hash, {token_hash, email, created_at, expires_at}); },
    getSession: async hash => copy(sessions.get(hash)),
    deleteSession: async hash => { sessions.delete(hash); },
    deleteSessionsFor: async email => { for (const [hash, session] of sessions) if (session.email === email) sessions.delete(hash); },

    async insertApplication(row) {
      if (applications.has(row.id)) return false;
      applications.set(row.id, {additional_roles: '', resume_key: null, portfolio_key: null, status: 'new', assigned_to: null, ...row});
      return true;
    },
    getApplication: async id => copy(applications.get(id)),
    listApplications: async year => [...applications.values()].filter(row => row.year === year)
      .sort((a, b) => b.submitted_at - a.submitted_at).map(row => Object.fromEntries(SUMMARY.map(key => [key, row[key]]))),
    years: async () => [...new Set([...applications.values()].map(row => row.year))].sort().reverse(),
    async updateApplication(id, fields, now) {
      const row = applications.get(id);
      if (row) Object.assign(row, pick(fields, EDITABLE), {updated_at: now});
      return copy(row);
    },
    async deleteApplication(id) {
      applications.delete(id);
      for (const list of [notes, activity, scorecards, emails]) for (let i = list.length - 1; i >= 0; i--) if (list[i].application_id === id) list.splice(i, 1);
    },
    async clearAssignee(email, now) {
      for (const row of applications.values()) {
        if (row.assigned_to === email) Object.assign(row, {assigned_to: null, updated_at: now, status: row.status === 'reviewing' ? 'new' : row.status});
      }
    },

    async addNote(application_id, author, body, created_at, kind = 'note') {
      const note = {id: nextId++, application_id, author, body, kind, created_at};
      notes.push(note);
      return copy(note);
    },
    listNotes: async id => notes.filter(note => note.application_id === id).map(copy),
    addActivity: async (application_id, actor, action, detail, created_at) => { activity.push({id: nextId++, application_id, actor, action, detail, created_at}); },
    listActivity: async id => activity.filter(row => row.application_id === id).reverse().map(copy),

    putDraft: async (id, email, answers, saved_at) => { drafts.set(id, {id, email, answers, saved_at}); },
    getDraft: async id => copy(drafts.get(id)),

    addScorecard: async (application_id, author, scores, notes, recommendation, created_at) => {
      scorecards.push({id: nextId++, application_id, author, scores, notes, recommendation, created_at});
    },
    listScorecards: async id => scorecards.filter(row => row.application_id === id).map(copy),
    addEmail: async (application_id, sender, template, subject, body, sent, created_at) => {
      emails.push({id: nextId++, application_id, sender, template, subject, body, sent, created_at});
    },
    listEmails: async id => emails.filter(row => row.application_id === id).reverse().map(copy),
    setPresence: async (email, application_id, seen_at) => { presence.set(email, {email, application_id, seen_at}); },
    listPresence: async since => [...presence.values()].filter(row => row.seen_at > since).map(copy),

    bump: async () => { version++; },
    version: async () => version
  };
}

// Application PDFs in R2. get() returns {body, size} or null.
export const r2Files = bucket => ({
  put: (key, bytes) => bucket.put(key, bytes, {httpMetadata: {contentType: 'application/pdf'}}),
  get: key => bucket.get(key),
  delete: key => bucket.delete(key)
});

export function memoryFiles() {
  const files = new Map();
  return {
    put: async (key, bytes) => { files.set(key, bytes); },
    get: async key => files.has(key) ? {body: files.get(key), size: files.get(key).length} : null,
    delete: async key => { files.delete(key); },
    keys: () => [...files.keys()]
  };
}
