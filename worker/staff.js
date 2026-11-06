/**
 * Staff area API: sign-in with an emailed code, and the applications dashboard (/staff pages).
 * Anyone with an @buzzflix.ca address can sign in unless an admin has blocked them. ADMIN_EMAILS
 * (wrangler.jsonc vars) are made admins on first sign-in; after that, roles are changed on the Team page.
 *
 *   POST  /api/staff/code {email}           emails a 6-digit code (always answers the same way)
 *   POST  /api/staff/verify {email, code}   sets the session cookie
 *   POST  /api/staff/logout
 *   GET   /api/staff/me
 *   GET   /api/staff/changes?viewing=<id>    {version, viewers}: version goes up on every change, so open pages know
 *                                             to reload; viewers is who else has which application open (and marks
 *                                             you as viewing <id>, or nothing)
 *   POST  /api/staff/presence {viewing: null}  leaving a page
 *   GET   /api/staff/applications?year=     summaries for the list, plus the team and years
 *   GET   /api/staff/applications/:id       everything, with notes and activity
 *   POST  /api/staff/applications {...answers, resume?, portfolio?, assigned_to?}   adds one by hand → {id}
 *   PATCH /api/staff/applications/:id {status?, assigned_to?}   see allowedStatuses and the assignment rules
 *   DELETE /api/staff/applications/:id      admins only; removes the files too
 *   POST  /api/staff/applications/bulk {ids, assigned_to? | status?}   → {updated, skipped: [{id, name, reason}]}
 *   POST  /api/staff/applications/:id/notes {body, kind: note|interview}
 *   POST  /api/staff/applications/:id/scorecard {scores, notes, recommendation: approve|decline}   ends the interview
 *   POST  /api/staff/applications/:id/emails {template, subject, body}   an email to the applicant (worker/hiring.js)
 *   GET   /api/staff/applications/:id/resume|portfolio   the PDF
 *   GET   /api/staff/export.csv?year=
 *   GET   /api/staff/team
 *   POST  /api/staff/team {email, name}      admins only; adds someone before they first sign in
 *   PATCH /api/staff/team/:email {name?, role?, blocked?}   own name, or anything for admins
 *
 * ctx: {store, files, mailer, now, adminEmails: string[], secure: boolean, applicantEmails: boolean}
 */
import {DEPARTMENTS, addApplicationByStaff} from './apply.js';
import {emailHtml, REPLY_TO} from './mail.js';
import {SCORECARD, EMAIL_TEMPLATES, allowedTemplates} from './hiring.js';

export const COOKIE = 'bz_staff';
// The hiring workflow: New → In review → Interview → Approve or Decline (pending: the interviewer's
// recommendation, made by filling in the scorecard) → Hired or Not hired (an admin's final decision).
// Assignment drives the start: an application is New exactly while no one is assigned. Assigning a New one
// moves it to In review; unassigning one In review moves it back to New; past review it can only be reassigned.
export const STATUSES = ['new', 'reviewing', 'interview', 'approve', 'decline', 'hired', 'not_hired'];
export const STATUS_LABELS = {new: 'New', reviewing: 'In review', interview: 'Interview', approve: 'Approve (pending)',
  decline: 'Decline (pending)', hired: 'Hired', not_hired: 'Not hired'};
const RECOMMENDATIONS = ['approve', 'decline'], FINAL = ['hired', 'not_hired'];
export const NOTE_KINDS = ['note', 'interview'];

// The statuses someone can choose from the status dropdown for an application at `from` (including staying
// put). Unassigned ones stay New until someone is assigned. Approve and Decline only come from the scorecard.
// Members choose In review or Interview; admins can also make (or change) the final decision.
export function allowedStatuses(from, isAdmin, assigned) {
  if (!assigned) return [from];
  const choices = isAdmin ? ['reviewing', 'interview', ...FINAL] : FINAL.includes(from) ? [] : ['reviewing', 'interview'];
  return STATUSES.filter(status => status === from || choices.includes(status));
}
const refusal = (from, to, assigned) => !assigned ? 'Assign it to someone first. It moves to In review when you do.'
  : to === 'new' ? 'An assigned application is In review or further along. To start over, unassign it.'
  : RECOMMENDATIONS.includes(to) ? 'Approve or Decline comes from the interview scorecard. Use Interview complete.'
  : FINAL.includes(from) ? 'Only an admin can change a final decision.'
  : 'Only an admin can make the final decision.';
const VIEWING_FOR = 25_000; // someone counts as viewing for this long after their page last checked in
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
  const response = await signedIn(request, ctx, me, url, path, method, body);
  // Every saved change moves the version on, so other people's open pages reload (GET /changes).
  if (method !== 'GET' && response.ok) await ctx.store.bump();
  return response;
}

async function signedIn(request, ctx, me, url, path, method, body) {
  const isAdmin = me.role === 'admin';
  const {store, now} = ctx;

  if (method === 'GET' && path === '/me') return json({me: publicStaff(me), statuses: STATUSES, statusLabels: STATUS_LABELS, departments: DEPARTMENTS,
    scorecard: SCORECARD, emailTemplates: EMAIL_TEMPLATES, applicantEmails: Boolean(ctx.applicantEmails)});
  if (method === 'GET' && path === '/changes') {
    const viewing = url.searchParams.get('viewing');
    await store.setPresence(me.email, /^[0-9a-f-]{36}$/.test(viewing || '') ? viewing : null, now);
    const viewers = {};
    for (const row of await store.listPresence(now - VIEWING_FOR)) {
      if (row.email !== me.email && row.application_id) (viewers[row.application_id] ||= []).push(row.email);
    }
    return json({version: await store.version(), viewers});
  }
  if (method === 'POST' && path === '/presence') {
    await store.setPresence(me.email, null, now);
    return json({ok: true});
  }

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

  if (method === 'POST' && path === '/applications/bulk') {
    const input = await body();
    const ids = Array.isArray(input.ids) ? [...new Set(input.ids.filter(id => typeof id === 'string'))] : [];
    if (!ids.length || ids.length > 500) return error('Choose between 1 and 500 applications.');
    const fields = 'assigned_to' in input ? {assigned_to: input.assigned_to} : 'status' in input ? {status: input.status} : null;
    if (!fields) return error('Choose someone to assign them to, or a status.');
    let updated = 0;
    const skipped = [];
    for (const id of ids) {
      const application = await store.getApplication(id);
      if (!application) continue;
      const refused = await change(ctx, me, application, fields);
      if (refused) skipped.push({id, name: application.name, reason: (await refused.json()).error});
      else updated++;
    }
    return json({updated, skipped});
  }

  if (method === 'POST' && path === '/applications') {
    const input = await body();
    if (input.assigned_to) {
      const person = await store.getStaff(normalEmail(input.assigned_to));
      if (!person || person.blocked) return error('Choose someone on the team to assign it to.');
    }
    const added = await addApplicationByStaff(ctx, input, me.email);
    if (added.error) return error(added.error);
    if (input.assigned_to) await change(ctx, me, await store.getApplication(added.id), {assigned_to: input.assigned_to});
    return json({id: added.id});
  }

  const appMatch = path.match(/^\/applications\/([0-9a-f-]{36})(?:\/(notes|scorecard|emails|resume|portfolio))?$/);
  if (appMatch) {
    const [, id, part] = appMatch;
    const application = await store.getApplication(id);
    if (!application) return error('That application wasn’t found.', 404);

    if (!part && method === 'GET') return json(await details(store, application, isAdmin));

    if (!part && method === 'PATCH') {
      const refused = await change(ctx, me, application, await body());
      if (refused) return refused;
      return json(await details(store, await store.getApplication(id), isAdmin));
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
      const kind = NOTE_KINDS.includes(input.kind) ? input.kind : 'note';
      await store.addNote(id, me.email, text, now, kind);
      await store.addActivity(id, me.email, 'note', kind, now);
      return json(await details(store, application, isAdmin));
    }

    // Interview complete: the assignee (or an admin) rates the applicant, writes notes and recommends.
    if (part === 'scorecard' && method === 'POST') {
      if (application.status !== 'interview') return error('The scorecard is for applications at Interview.', 409);
      if (application.assigned_to !== me.email && !isAdmin) return error('Only the person assigned to this interview (or an admin) can complete it.', 403);
      const input = await body();
      const scores = {};
      for (const {key, label} of SCORECARD) {
        const score = Number(input.scores?.[key]);
        if (!Number.isInteger(score) || score < 1 || score > 5) return error(`Rate “${label}” from 1 to 5.`);
        scores[key] = score;
      }
      const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
      if (!notes || notes.length > 5000) return error('Write your interview notes (up to 5,000 characters).');
      if (!RECOMMENDATIONS.includes(input.recommendation)) return error('Choose Recommend or Reject.');
      await store.addScorecard(id, me.email, JSON.stringify(scores), notes, input.recommendation, now);
      await store.addActivity(id, me.email, 'scorecard', input.recommendation, now);
      await store.updateApplication(id, {status: input.recommendation}, now);
      await store.addActivity(id, me.email, 'status', `${STATUS_LABELS.interview} → ${STATUS_LABELS[input.recommendation]}`, now);
      return json(await details(store, await store.getApplication(id), isAdmin));
    }

    // An email to the applicant from a template. Saved to the history; sent only when APPLICANT_EMAILS is on.
    if (part === 'emails' && method === 'POST') {
      const input = await body();
      const template = EMAIL_TEMPLATES[input.template];
      if (!template) return error('Choose an email.');
      if (!allowedTemplates(application.status, isAdmin).includes(input.template)) {
        return error(template.admin && !isAdmin ? `Only admins can send “${template.label}”.` : `“${template.label}” can’t be sent at this step.`, 403);
      }
      const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
      const text = typeof input.body === 'string' ? input.body.trim() : '';
      if (!subject || subject.length > 200) return error('Write a subject of up to 200 characters.');
      if (!text || text.length > 10000) return error('Write the email (up to 10,000 characters).');
      let sent = false;
      if (ctx.applicantEmails) {
        try {
          await ctx.mailer.send({to: application.email, replyTo: REPLY_TO, subject, text, html: emailHtml(text.split(/\n{2,}/))});
          sent = true;
        } catch (failure) {
          console.error('applicant email failed', failure);
          return error('The email couldn’t be sent. Please try again in a moment.', 502);
        }
      }
      await store.addEmail(id, me.email, input.template, subject, text, sent ? 1 : 0, now);
      await store.addActivity(id, me.email, 'email', `${input.template}:${sent ? 'sent' : 'saved'}`, now);
      return json(await details(store, application, isAdmin));
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

// Applies {status?, assigned_to?} to an application and logs it. Returns an error response, or null when saved.
async function change({store, now}, me, application, input) {
  const isAdmin = me.role === 'admin';
  const fields = {}, changes = [];
  let assignee = application.assigned_to, status = application.status;
  if ('assigned_to' in input) {
    assignee = input.assigned_to === null || input.assigned_to === '' ? null : normalEmail(input.assigned_to);
    if (assignee) {
      const person = await store.getStaff(assignee);
      if (!person || person.blocked) return error('Choose someone on the team.');
    }
    if (!assignee && application.assigned_to && !['new', 'reviewing'].includes(application.status)) {
      return error('This application is past review, so it needs someone. Assign it to another teammate instead.');
    }
  }
  if ('status' in input) {
    if (!STATUSES.includes(input.status)) return error('Choose a status from the list.');
    if (!allowedStatuses(application.status, isAdmin, Boolean(assignee)).includes(input.status)) {
      return error(refusal(application.status, input.status, Boolean(assignee)), 403);
    }
    status = input.status;
  }
  // Assigning a New application starts its review; unassigning one In review sends it back to New.
  if (assignee && status === 'new') status = 'reviewing';
  if (!assignee && status === 'reviewing') status = 'new';
  if (assignee !== application.assigned_to) {
    fields.assigned_to = assignee;
    changes.push(['assigned', assignee || 'Unassigned']);
  }
  if (status !== application.status) {
    fields.status = status;
    changes.push(['status', `${STATUS_LABELS[application.status] || application.status} → ${STATUS_LABELS[status]}`]);
  }
  if (changes.length) {
    await store.updateApplication(application.id, fields, now);
    for (const [action, detail] of changes) await store.addActivity(application.id, me.email, action, detail, now);
  }
  return null;
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

async function details(store, application, isAdmin) {
  const {resume_key, portfolio_key, ...rest} = application;
  const activity = await store.listActivity(application.id);
  const scorecards = (await store.listScorecards(application.id)).map(row => ({...row, scores: JSON.parse(row.scores)}));
  return {
    application: {...rest, has_resume: Boolean(resume_key), has_portfolio: Boolean(portfolio_key)},
    allowedStatuses: allowedStatuses(application.status, isAdmin, Boolean(application.assigned_to)),
    allowedTemplates: allowedTemplates(application.status, isAdmin),
    // Whoever filled in the latest scorecard, for the admin's decision box.
    recommendedBy: RECOMMENDATIONS.includes(application.status) ? scorecards.at(-1)?.author || null : null,
    scorecards,
    emails: await store.listEmails(application.id),
    notes: await store.listNotes(application.id),
    activity
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
