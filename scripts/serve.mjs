// Local preview that behaves like the Cloudflare Worker: /movies serves movies.html, /movies.html
// redirects to /movies, _redirects and _headers apply, .assetsignore files and unknown paths get 404.html.
// /api/buzz-run/*, /api/apply and /api/staff/* run the Worker's code against in-memory stores that empty on
// restart, and /staff pages need a sign-in like on Cloudflare. Emails (sign-in codes, drafts) print here instead.
// Usage: node scripts/serve.mjs   (PORT defaults to 4173)
//   APPLICATIONS_OPEN=true  accept submitted applications (Cloudflare's setting is in wrangler.jsonc)
//   DEMO=1                  start with made-up applications to try the staff pages with
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {leaderboard, memoryStore} from '../worker/leaderboard.js';
import {applyApi} from '../worker/apply.js';
import {staffApi, staffPage} from '../worker/staff.js';
import {memoryStore as applicationStore, memoryFiles} from '../worker/applications-store.js';
import {memoryMailer} from '../worker/mail.js';

globalThis.crypto ??= webcrypto; // Node 18 has no global crypto

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const scores = memoryStore();
const config = JSON.parse((await readFile(join(root, 'wrangler.jsonc'), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
const staffCtx = {store: applicationStore(), files: memoryFiles(), mailer: memoryMailer(), open: process.env.APPLICATIONS_OPEN === 'true',
  testSubmissions: config.vars.TEST_SUBMISSIONS === 'true', // TEMPORARY, see wrangler.jsonc
  devLoginEmail: String(config.vars.DEV_LOGIN_EMAIL || '').toLowerCase(),
  adminEmails: config.vars.ADMIN_EMAILS.split(',').map(email => email.trim().toLowerCase()), secure: false};
if (process.env.DEMO) await (await import('./demo-applications.mjs')).addDemoApplications(staffCtx);
else await (await import('./demo-applications.mjs')).addExampleTeam(staffCtx.store); // like the Cloudflare database
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon'};

const lines = async name => (await readFile(join(root, name), 'utf8').catch(() => '')).split('\n');
const ignored = (await lines('.assetsignore')).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const redirects = (await lines('_redirects')).map(l => l.trim().split(/\s+/)).filter(([from]) => from && !from.startsWith('#'));
const headerRules = [];
for (const line of await lines('_headers')) {
  if (line.startsWith('/')) headerRules.push({pattern: line.trim(), headers: []});
  else if (/^\s+\S+:/.test(line) && headerRules.length) headerRules.at(-1).headers.push(line.trim().split(/:\s*(.*)/s).slice(0, 2));
}

const glob = pattern => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*') + '$');
const isIgnored = path => /^\/_(headers|redirects)$/.test(path) || path.split('/').filter(Boolean).some((_, i, parts) =>
  ignored.some(p => glob(p.replace(/\/$/, '')).test(parts.slice(0, i + 1).join('/')) || glob(p).test(parts[i])));
const isFile = async path => !isIgnored(path) && (await stat(join(root, path)).catch(() => null))?.isFile();

async function resolve(path) {
  if (path.endsWith('.html') && await isFile(path)) return {redirect: path.replace(/(index)?\.html$/, '')};
  if (path.endsWith('/')) {
    if (await isFile(path + 'index.html')) return {file: path + 'index.html'};
    if (path !== '/' && await isFile(path.slice(0, -1) + '.html')) return {redirect: path.slice(0, -1)};
  } else {
    if (await isFile(path)) return {file: path};
    if (await isFile(path + '.html')) return {file: path + '.html'};
    if (await isFile(path + '/index.html')) return {redirect: path + '/'};
  }
  return {file: '/404.html', status: 404};
}

// Node's request as a fetch Request, and a fetch Response written back (binary-safe, cookies kept).
const toRequest = async req => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
  return new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), {method: req.method, body, headers: req.headers});
};
const send = async (res, response) => {
  res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path.startsWith('/api/buzz-run/')) return send(res, await leaderboard(await toRequest(req), scores));
  if (path === '/api/apply') return send(res, await applyApi(await toRequest(req), {...staffCtx, now: Date.now()}));
  if (path.startsWith('/api/staff/')) return send(res, await staffApi(await toRequest(req), {...staffCtx, now: Date.now()}));
  if (path === '/staff' || path.startsWith('/staff/')) {
    const guard = await staffPage(await toRequest(req), {...staffCtx, now: Date.now()}, async () => new Response(null));
    if (guard.status === 302) return send(res, guard);
  }
  const rule = redirects.find(([from]) => from === path);
  const target = rule ? {redirect: rule[1], status: Number(rule[2]) || 302} : await resolve(path);
  if (target.redirect !== undefined) {
    res.writeHead(target.status || 307, {Location: target.redirect || '/'}).end();
    return;
  }
  const headers = {'Content-Type': types[extname(target.file)] || 'application/octet-stream'};
  for (const {pattern, headers: list} of headerRules) {
    if (new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(path)) {
      for (const [name, value] of list) headers[name] = value;
    }
  }
  // Always revalidate locally so edits show on reload; Cloudflare uses the Cache-Control from _headers.
  headers['Cache-Control'] = 'no-cache';
  res.writeHead(target.status || 200, headers).end(await readFile(join(root, target.file)));
}).listen(port, () => console.log(`Buzzflix preview on http://localhost:${port}`));
