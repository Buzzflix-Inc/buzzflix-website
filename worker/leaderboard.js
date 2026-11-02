/**
 * Buzz Run leaderboard API, shared by the Worker (worker/index.js, D1 store) and the local preview
 * (scripts/serve.mjs, memory store).
 *   GET  /api/buzz-run/scores  → {scores: [{name, score}]}, the top 10
 *   POST /api/buzz-run/runs    → {run}, called when a run starts
 *   POST /api/buzz-run/scores  {run, name, score} → {scores, rank}
 * A score needs a run id that is unused and old enough for that score (a strip takes about a second
 * at top speed), so a score can't be posted without playing for at least that long.
 */
export const TOP = 10;
const MS_PER_POINT = 950, RUN_LIFETIME = 60 * 60 * 1000, MAX_SCORE = 9999;
const BLOCKED = new Set(['ASS', 'CUM', 'CNT', 'COK', 'DIC', 'DIK', 'FAG', 'FCK', 'FKU', 'FUC', 'FUK', 'JIZ', 'KKK',
  'KUM', 'KYS', 'NAZ', 'NIG', 'PIS', 'SEX', 'SHT', 'TIT', 'WTF', 'XXX']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}
});
const board = async store => (await store.top(TOP)).map(({name, score}) => ({name, score}));

export async function leaderboard(request, store, now = Date.now()) {
  const {pathname} = new URL(request.url);
  const route = `${request.method} ${pathname}`;

  if (route === 'GET /api/buzz-run/scores') return json({scores: await board(store)});

  if (route === 'POST /api/buzz-run/runs') {
    const run = crypto.randomUUID();
    await store.prune(now - RUN_LIFETIME);
    await store.startRun(run, now);
    return json({run});
  }

  if (route === 'POST /api/buzz-run/scores') {
    const body = await request.json().catch(() => null);
    const name = String(body?.name ?? '').toUpperCase(), score = body?.score, run = String(body?.run ?? '');
    if (!/^[A-Z]{3}$/.test(name)) return json({error: 'Use three letters.'}, 400);
    if (BLOCKED.has(name)) return json({error: 'Pick different initials.'}, 400);
    if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return json({error: 'That score is not valid.'}, 400);
    const started = await store.takeRun(run);
    if (started === null || now - started > RUN_LIFETIME || now - started < score * MS_PER_POINT) {
      return json({error: 'That run could not be checked.'}, 400);
    }
    const id = await store.addScore(name, score, now);
    const top = await store.top(TOP);
    const rank = top.findIndex(row => row.id === id) + 1 || null;
    return json({scores: top.map(({name, score}) => ({name, score})), rank});
  }

  return json({error: 'Not found.'}, pathname.startsWith('/api/buzz-run/') ? 405 : 404);
}

// Store over a D1 database (schema in worker/schema.sql).
export const d1Store = db => ({
  startRun: (id, now) => db.prepare('INSERT INTO runs (id, started_at) VALUES (?, ?)').bind(id, now).run(),
  async takeRun(id) {
    const row = await db.prepare('DELETE FROM runs WHERE id = ? RETURNING started_at').bind(id).first();
    return row ? row.started_at : null;
  },
  prune: before => db.prepare('DELETE FROM runs WHERE started_at < ?').bind(before).run(),
  async addScore(name, score, now) {
    const row = await db.prepare('INSERT INTO scores (name, score, created_at) VALUES (?, ?, ?) RETURNING id')
      .bind(name, score, now).first();
    return row.id;
  },
  async top(limit) {
    const {results} = await db.prepare('SELECT id, name, score FROM scores ORDER BY score DESC, created_at ASC LIMIT ?')
      .bind(limit).all();
    return results;
  }
});

// In-memory store for the local preview and the tests.
export function memoryStore() {
  const runs = new Map(), scores = [];
  return {
    startRun: async (id, now) => { runs.set(id, now); },
    async takeRun(id) {
      if (!runs.has(id)) return null;
      const started = runs.get(id);
      runs.delete(id);
      return started;
    },
    prune: async before => { for (const [id, started] of runs) if (started < before) runs.delete(id); },
    addScore: async (name, score, now) => scores.push({id: scores.length + 1, name, score, created_at: now}),
    top: async limit => [...scores].sort((a, b) => b.score - a.score || a.created_at - b.created_at).slice(0, limit)
  };
}
