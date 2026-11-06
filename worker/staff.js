/**
 * Staff area API: sign-in with an emailed code, and the applications dashboard (/staff pages).
 * Anyone with an @buzzflix.ca address can sign in unless an admin has blocked them. ADMIN_EMAILS
 * (wrangler.jsonc vars) are made admins on first sign-in; after that, roles are changed on the Team page.
 *
 *   POST  /api/staff/code {email}           emails a 6-digit code (always answers the same way)
 *   POST  /api/staff/verify {email, code}   sets the session cookie
 *   POST  /api/staff/logout
 *   GET   /api/staff/me
 *   GET   /api/staff/applications?year=     summaries for the list, plus the team and years
 *   GET   /api/staff/applications/:id       everything, with notes and activity
 *   PATCH /api/staff/applications/:id {status?, assigned_to?}
 *   DELETE /api/staff/applications/:id      admins only; removes the files too
 *   POST  /api/staff/applications/:id/notes {body}
 *   GET   /api/staff/applications/:id/resume|portfolio   the PDF
 *   GET   /api/staff/export.csv?year=
 *   GET   /api/staff/team
 *   POST  /api/staff/team {email, name}      admins only; adds someone before they first sign in
 *   PATCH /api/staff/team/:email {name?, role?, blocked?}   own name, or anything for admins
 *
 * ctx: {store, files, mailer, now, adminEmails: string[], secure: boolean}
 */
import {DEPARTMENTS} from './apply.js';
import {emailHtml} from './mail.js';

export const COOKIE = 'bz_staff';
export const STATUSES = ['new', 'reviewing', 'interview', 'approved', 'denied', 'withdrawn'];
export const STATUS_LABELS = {new: 'New', reviewing: 'In review', interview: 'Interview', approved: 'Approved', denied: 'Denied', withdrawn: 'Withdrawn'};
const DOMAIN = '@buzzflix.ca';
const CODE_LIFETIME = 10 * 60_000, CODE_ATTEMPTS = 5, SESSION_LIFETIME = 14 * 24 * 60 * 60_000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers}
});
const error = (message, status = 400) => json({error: message}, status);
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
export const normalEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const isStaffEmail = email => /^[a-z0-9._%+-]+@buzzflix\.ca$/.test(email);
// "jack.smith@buzzflix.ca" → "Jack Smith", until they set their own name.
const nameFrom = email => email.split('@')[0].split(/[._-]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
const publicStaff = ({email, name, role, blocked, last_seen_at}) => ({email, name, role, blocked: Boolean(blocked), last_seen_at});

const cookieValue = (request, name) => {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
};
const sessionCookie = (token, maxAge, secure) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

// The signed-in staff member for this request, or null. Used by the API and by the /staff page guard.
export async function currentStaff(request, {store, now}) {
  const token = cookieValue(request, COOKIE);
  if (!/^[\w-]{43}$/.test(token)) return null;
  const session = await store.getSession(await sha256(token));
  if (!session || session.expires_at < now) return null;
  const staff = await store.getStaff(session.email);
  if (!staff || staff.blocked) return null;
  return staff;
}

// /staff pages: signed-out visitors go to /login and come back afterwards. Nothing under /staff is indexed.
export async function staffPage(request, ctx, serve) {
  const url = new URL(request.url);
  if (!await currentStaff(request, ctx)) {
    const next = url.pathname + url.search;
    return new Response(null, {status: 302, headers: {Location: `/login?next=${encodeURIComponent(next)}`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
  }
  const response = await serve();
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {status: response.status, headers});
}

export async function staffApi(request, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/staff/, '');
  const method = request.method;

  // Changes must come from our own pages. Browsers send Origin on every POST/PATCH/DELETE.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return error('Not allowed.', 403);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return error('Send JSON.', 415);
  }
  const body = async () => {
    const value = await request.json().catch(() => null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };

  if (method === 'POST' && path === '/code') return requestCode(ctx, await body(), url.hostname);
  if (method === 'POST' && path === '/verify') return verifyCode(ctx, await body());
  if (method === 'POST' && path === '/logout') {
    const token = cookieValue(request, COOKIE);
    if (token) await ctx.store.deleteSession(await sha256(token));
    return json({ok: true}, 200, {'Set-Cookie': sessionCookie('', 0, ctx.secure)});
  }

  const me = await currentStaff(request, ctx);
  if (!me) return error('Please sign in.', 401);
  const isAdmin = me.role === 'admin';
  const {store, now} = ctx;

  if (method === 'GET' && path === '/me') return json({me: publicStaff(me), statuses: STATUSES, statusLabels: STATUS_LABELS, departments: DEPARTMENTS});

  if (method === 'GET' && path === '/applications') {
    const years = await store.years();
    const year = url.searchParams.get('year') || years[0] || String(new Date(now).getFullYear() + 1);
    return json({year, years, applications: await store.listApplications(year), team: (await store.listStaff()).map(publicStaff)});
  }

  if (method === 'GET' && path === '/export.csv') {
    const year = url.searchParams.get('year') || (await store.years())[0] || '';
    return csv(year, await store.listApplications(year), store);
  }

  if (path === '/team') {
    if (method === 'GET') return json({team: (await store.listStaff()).map(publicStaff)});
    if (method === 'POST') {
      if (!isAdmin) return error('Only admins can add people.', 403);
      const input = await body();
      const email = normalEmail(input.email);
      if (!isStaffEmail(email)) return error(`Use a ${DOMAIN} address.`);
      const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : nameFrom(email);
      if (await store.getStaff(email)) return error('That person is already on the team.');
      return json({person: publicStaff(await store.addStaff({email, name}, now))});
    }
  }

  const teamMatch = path.match(/^\/team\/([^/]+)$/);
  if (teamMatch && method === 'PATCH') {
    const email = normalEmail(decodeURIComponent(teamMatch[1]));
    const person = await store.getStaff(email);
    if (!person) return error('That person isn’t on the team.', 404);
    const input = await body();
    const fields = {};
    if ('name' in input) {
      if (email !== me.email && !isAdmin) return error('You can only change your own name.', 403);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 80) return error('Enter a name of up to 80 characters.');
      fields.name = name;
    }
    if ('role' in input || 'blocked' in input) {
      if (!isAdmin) return error('Only admins can change roles.', 403);
      if (email === me.email) return error('Ask another admin to change your own access.', 403);
      if ('role' in input) {
        if (!['admin', 'member'].includes(input.role)) return error('Choose admin or member.');
        fields.role = input.role;
      }
      if ('blocked' in input) fields.blocked = input.blocked ? 1 : 0;
    }
    const updated = await store.updateStaff(email, fields);
    if (fields.blocked) {
      await store.deleteSessionsFor(email);
      await store.clearAssignee(email, now);
    }
    return json({person: publicStaff(updated)});
  }

  const appMatch = path.match(/^\/applications\/([0-9a-f-]{36})(?:\/(notes|resume|portfolio))?$/);
  if (appMatch) {
    const [, id, part] = appMatch;
    const application = await store.getApplication(id);
    if (!application) return error('That application wasn’t found.', 404);

    if (!part && method === 'GET') return json(await details(store, application));

    if (!part && method === 'PATCH') {
      const input = await body();
      const fields = {}, changes = [];
      if ('status' in input) {
        if (!STATUSES.includes(input.status)) return error('Choose a status from the list.');
        if (input.status !== application.status) {
          fields.status = input.status;
          changes.push(['status', `${STATUS_LABELS[application.status]} → ${STATUS_LABELS[input.status]}`]);
        }
      }
      if ('assigned_to' in input) {
        const email = input.assigned_to === null || input.assigned_to === '' ? null : normalEmail(input.assigned_to);
        if (email) {
          const person = await store.getStaff(email);
          if (!person || person.blocked) return error('Choose someone on the team.');
        }
        if (email !== application.assigned_to) {
          fields.assigned_to = email;
          changes.push(['assigned', email || 'Unassigned']);
        }
      }
      if (changes.length) {
        await store.updateApplication(id, fields, now);
        for (const [action, detail] of changes) await store.addActivity(id, me.email, action, detail, now);
      }
      return json(await details(store, await store.getApplication(id)));
    }

    if (!part && method === 'DELETE') {
      if (!isAdmin) return error('Only admins can delete applications.', 403);
      for (const key of [application.resume_key, application.portfolio_key]) if (key) await ctx.files.delete(key);
      await store.deleteApplication(id);
      return json({deleted: true});
    }

    if (part === 'notes' && method === 'POST') {
      const input = await body();
      const text = typeof input.body === 'string' ? input.body.trim() : '';
      if (!text || text.length > 5000) return error('Write a note of up to 5,000 characters.');
      await store.addNote(id, me.email, text, now);
      await store.addActivity(id, me.email, 'note', '', now);
      return json(await details(store, application));
    }

    if ((part === 'resume' || part === 'portfolio') && method === 'GET') {
      const key = application[`${part}_key`];
      const file = key && await ctx.files.get(key);
      if (!file) return error('There’s no file.', 404);
      const filename = `${application.name.replace(/[^\w .'-]/g, '').slice(0, 60) || 'Applicant'} - ${part === 'resume' ? 'Resume' : 'Portfolio'}.pdf`;
      return new Response(file.body, {headers: {
        'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        // Opens in the browser's own PDF viewer. (A CSP sandbox would make Chrome refuse to show it.)
        'Content-Disposition': `inline; filename="${filename}"`
      }});
    }
  }

  return error('Not found.', 404);
}

// TEMPORARY, until email sending works: DEV_LOGIN_EMAIL (wrangler.jsonc vars) signs in without a code.
// It never works on buzzflix.ca itself or once applications open, so it can't expose real applicants.
// Remove DEV_LOGIN_EMAIL (and this) before modern-look-preview is merged into main.
export const devLoginAllowed = (ctx, email, hostname) => Boolean(ctx.devLoginEmail) && email === ctx.devLoginEmail
  && !ctx.open && !/(^|\.)buzzflix\.ca$/.test(hostname);

async function requestCode(ctx, input, hostname) {
  const {store, mailer, now} = ctx;
  const email = normalEmail(input.email);
  if (!isStaffEmail(email)) return error(`Use your ${DOMAIN} email address.`);
  // Same answer whether or not a code went out, so the page doesn't reveal who is blocked.
  const sent = json({sent: true});
  const person = await store.getStaff(email);
  if (person?.blocked) return sent;
  if (devLoginAllowed(ctx, email, hostname)) return startSession(ctx, email, person);
  if (!await store.hit(`code:${email}`, now, 60 * 60_000, 5) || !await store.hit('code', now, 60_000, 30)) {
    return error('Too many codes have been requested. Please wait a few minutes and try again.', 429);
  }
  const code = randomCode();
  await store.addCode(email, await sha256(`${email}:${code}`), now, now + CODE_LIFETIME);
  try {
    await mailer.send({
      to: email,
      subject: `${code} is your Buzzflix sign-in code`,
      text: `Your Buzzflix staff sign-in code is:\n\n${code}\n\nIt works once, for the next 10 minutes. If you didn’t try to sign in, you can ignore this email.`,
      html: emailHtml(['Your Buzzflix staff sign-in code is:', 'It works once, for the next 10 minutes. If you didn’t try to sign in, you can ignore this email.'], {code})
    });
  } catch (failure) {
    // While Resend uses its test sender, it refuses every address but the account's own.
    console.error('sign-in code email failed', failure);
    await store.clearCodes(email);
    return error('We couldn’t send a code to that address right now. Please try again later, or ask an admin.', 502);
  }
  return sent;
}

async function verifyCode({store, now, adminEmails, secure}, input) {
  const email = normalEmail(input.email);
  const code = typeof input.code === 'string' ? input.code.replace(/\s+/g, '') : '';
  const wrong = error('That code isn’t right, or it has expired. Check the newest email, or send a new code.');
  if (!isStaffEmail(email) || !/^\d{6}$/.test(code)) return wrong;
  const saved = await store.latestCode(email);
  if (!saved || saved.expires_at < now || saved.attempts >= CODE_ATTEMPTS) return wrong;
  if (saved.code_hash !== await sha256(`${email}:${code}`)) {
    await store.countAttempt(saved.id);
    return wrong;
  }
  await store.clearCodes(email);
  const existing = await store.getStaff(email);
  if (existing?.blocked) return wrong;
  return startSession({store, now, adminEmails, secure}, email, existing);
}

// Signs `email` in: makes their staff row on first sign-in, and sets the session cookie.
async function startSession({store, now, adminEmails, secure}, email, existing) {
  const person = existing || await store.addStaff({email, name: nameFrom(email), role: adminEmails.includes(email) ? 'admin' : 'member'}, now);
  await store.touchStaff(email, now);
  const token = randomToken();
  await store.addSession(await sha256(token), email, now, now + SESSION_LIFETIME);
  return json({signedIn: true, me: publicStaff(person)}, 200, {'Set-Cookie': sessionCookie(token, SESSION_LIFETIME / 1000, secure)});
}

async function details(store, application) {
  const {resume_key, portfolio_key, ...rest} = application;
  return {
    application: {...rest, has_resume: Boolean(resume_key), has_portfolio: Boolean(portfolio_key)},
    notes: await store.listNotes(application.id),
    activity: await store.listActivity(application.id)
  };
}

// Spreadsheet apps treat a leading = + - @ as a formula, so those cells get a leading apostrophe.
const cell = value => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
async function csv(year, rows, store) {
  const names = new Map((await store.listStaff()).map(person => [person.email, person.name]));
  const columns = [['Submitted', row => new Date(row.submitted_at).toISOString()], ['Name', 'name'], ['Email', 'email'], ['School', 'school'],
    ['Program & Year', 'program_year'], ['Role 1', 'role_1'], ['Role 2', 'role_2'], ['Role 3', 'role_3'], ['Additional Roles', 'additional_roles'],
    ['Status', row => STATUS_LABELS[row.status] || row.status], ['Assigned To', row => row.assigned_to ? names.get(row.assigned_to) || row.assigned_to : ''],
    ['Reference', 'id']];
  const lines = [columns.map(([title]) => title)].concat(rows.map(row => columns.map(([, get]) => typeof get === 'function' ? get(row) : row[get])));
  return new Response('﻿' + lines.map(line => line.map(cell).join(',')).join('\r\n') + '\r\n', {headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="buzzflix-applications-${year.replace(/\D/g, '')}.csv"`
  }});
}
