// Tests for the application API (worker/apply.js) and the staff area (worker/staff.js) against the
// in-memory store. Run: node --test scripts/test-staff.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {applyApi} from '../worker/apply.js';
import {staffApi, staffPage} from '../worker/staff.js';
import {memoryStore, memoryFiles} from '../worker/applications-store.js';
import {memoryMailer} from '../worker/mail.js';

globalThis.crypto ??= webcrypto;
const ORIGIN = 'https://www.buzzflix.ca';
const id = '21c6c122-661e-4710-85db-5397543696c2';
const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
const application = (changes = {}) => ({submission_id: id, application_year: '2027', name: 'Test Applicant', email: 'test@example.com',
  school: 'Test School', program_year: 'Grade 11', experience: 'School films', why_join: 'I love movies', role_1: 'Editor',
  role_2: 'Gaffer', role_3: 'Actor', additional_roles: '', consent: 'agreed', eligibility: 'confirmed', consent_version: '2027-text-v2',
  website: '', ...changes});

function setup({open = true} = {}) {
  const ctx = {store: memoryStore(), files: memoryFiles(), mailer: memoryMailer({log: false}), now: 1_000_000, open,
    adminEmails: ['jack@buzzflix.ca'], secure: true};
  const apply = async (body, method = 'POST', query = '') => {
    const response = await applyApi(new Request(`${ORIGIN}/api/apply${query}`, {method, body: method === 'POST' ? JSON.stringify(body) : undefined,
      headers: {'Content-Type': 'text/plain;charset=utf-8'}}), ctx);
    return response.json();
  };
  const staff = async (method, path, body, cookie = '', headers = {}) => {
    const response = await staffApi(new Request(`${ORIGIN}/api/staff${path}`, {method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: {'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie, ...headers}}), ctx);
    const type = response.headers.get('Content-Type') || '';
    return {status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text()};
  };
  const lastCode = () => ctx.mailer.sent.at(-1).text.match(/\b(\d{6})\b/)[1];
  const signIn = async email => {
    await staff('POST', '/code', {email});
    const result = await staff('POST', '/verify', {email, code: lastCode()});
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.headers.get('Set-Cookie').split(';')[0];
  };
  return {ctx, apply, staff, signIn, lastCode};
}

test('saves an application with its PDFs and emails a confirmation', async () => {
  const {ctx, apply} = setup();
  const result = await apply(application({resume: {name: 'cv.pdf', data: pdf}}));
  assert.deepEqual(result, {accepted: true, submissionId: id, duplicate: false, confirmationEmailQueued: true});
  const saved = await ctx.store.getApplication(id);
  assert.equal(saved.status, 'new');
  assert.equal(saved.resume_key, `2027/${id}/resume.pdf`);
  assert.equal(saved.portfolio_key, null);
  assert.deepEqual(ctx.files.keys(), [`2027/${id}/resume.pdf`]);
  assert.equal(ctx.mailer.sent[0].to, 'test@example.com');
  assert.match(ctx.mailer.sent[0].text, new RegExp(id));
});

test('a retried submit is a duplicate; changed answers under the same id are refused', async () => {
  const {apply} = setup();
  await apply(application());
  assert.equal((await apply(application())).duplicate, true);
  const changed = await apply(application({school: 'Other School'}));
  assert.equal(changed.accepted, false);
  assert.match(changed.message, /different answers/);
});

test('refuses applications before they open, and bad input with applicant-facing messages', async () => {
  assert.match((await setup({open: false}).apply(application())).message, /not open yet/);
  const testing = setup({open: false});
  testing.ctx.testSubmissions = true; // TEMPORARY switch for testing the staff area
  assert.equal((await testing.apply(application())).accepted, true);
  const {apply} = setup();
  const cases = [
    [{website: 'spam'}, /try submitting/], [{email: 'nope'}, /valid email/], [{role_3: 'editor'}, /three different/],
    [{role_1: 'Editor', role_2: 'Colourist', role_3: 'Composer'}, /two Post-Production/], [{eligibility: ''}, /Canadian citizen/],
    [{consent: ''}, /privacy policy/], [{school: ''}, /required fields/], [{experience: 'word '.repeat(101)}, /100 words/],
    [{resume: {name: 'x.pdf', data: Buffer.from('hello').toString('base64')}}, /must be a PDF/], [{submission_id: 'abc'}, /refresh/]
  ];
  for (const [changes, message] of cases) {
    const result = await apply(application(changes));
    assert.equal(result.accepted, false, JSON.stringify(changes));
    assert.match(result.message, message);
  }
});

test('drafts are saved, emailed as a link, loaded back and rate limited', async () => {
  const {ctx, apply} = setup({open: false});
  const {submission_id, consent, eligibility, consent_version, application_year, ...answers} = application();
  assert.deepEqual(await apply({action: 'save_draft', ...answers}), {saved: true});
  const draftId = ctx.mailer.sent[0].text.match(/#draft=([0-9a-f]{32})/)[1];
  assert.doesNotMatch(ctx.mailer.sent[0].text, /I love movies/);
  const loaded = await apply(null, 'GET', `?draft=${draftId}`);
  assert.equal(loaded.found, true);
  assert.equal(loaded.draft.why_join, 'I love movies');
  assert.deepEqual(await apply(null, 'GET', '?draft=nope'), {found: false});
  await apply({action: 'save_draft', ...answers});
  await apply({action: 'save_draft', ...answers});
  const limited = await apply({action: 'save_draft', ...answers});
  assert.equal(limited.saved, false);
  assert.match(limited.message, /several times/);
});

test('sign-in: only @buzzflix.ca, the code works once, wrong codes run out, admins come from ADMIN_EMAILS', async () => {
  const {ctx, staff, signIn, lastCode} = setup();
  assert.equal((await staff('POST', '/code', {email: 'someone@gmail.com'})).status, 400);
  assert.equal((await staff('GET', '/me')).status, 401);

  const cookie = await signIn('Jack@Buzzflix.ca');
  assert.match(cookie, /^bz_staff=[\w-]{43}$/);
  const me = await staff('GET', '/me', undefined, cookie);
  assert.equal(me.body.me.email, 'jack@buzzflix.ca');
  assert.equal(me.body.me.role, 'admin');
  assert.equal(me.body.me.name, 'Jack');

  await staff('POST', '/code', {email: 'owen@buzzflix.ca'});
  const code = lastCode();
  const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.equal((await staff('POST', '/verify', {email: 'owen@buzzflix.ca', code: wrong})).status, 400);
  assert.equal((await staff('POST', '/verify', {email: 'owen@buzzflix.ca', code})).status, 400, 'locked after 5 wrong tries');

  const owen = await signIn('owen@buzzflix.ca');
  assert.equal((await staff('GET', '/me', undefined, owen)).body.me.role, 'member');
  assert.equal((await staff('POST', '/verify', {email: 'owen@buzzflix.ca', code: lastCode()})).status, 400, 'a code works once');

  ctx.now += 15 * 24 * 60 * 60_000;
  assert.equal((await staff('GET', '/me', undefined, owen)).status, 401, 'sessions expire');
});

test('a code email that fails says so and leaves no usable code', async () => {
  const {ctx, staff} = setup();
  ctx.mailer = {send: async () => { throw new Error('Resend refused the email (403)'); }};
  const result = await staff('POST', '/code', {email: 'megan@buzzflix.ca'});
  assert.equal(result.status, 502);
  assert.match(result.body.error, /couldn’t send a code/);
  assert.equal(await ctx.store.latestCode('megan@buzzflix.ca'), null);
});

test('TEMPORARY dev sign-in: only DEV_LOGIN_EMAIL, never on buzzflix.ca or once applications open', async () => {
  const at = async (ctx, host, email) => {
    const response = await staffApi(new Request(`https://${host}/api/staff/code`, {method: 'POST', body: JSON.stringify({email}),
      headers: {'Content-Type': 'application/json', Origin: `https://${host}`}}), ctx);
    return {body: await response.json(), cookie: response.headers.get('Set-Cookie')};
  };
  const preview = 'modern-look-preview-buzzflix-website.example.workers.dev';
  const {ctx} = setup({open: false});
  ctx.devLoginEmail = 'jack@buzzflix.ca';
  const signedIn = await at(ctx, preview, 'jack@buzzflix.ca');
  assert.equal(signedIn.body.signedIn, true);
  assert.equal(signedIn.body.me.role, 'admin');
  assert.match(signedIn.cookie, /^bz_staff=/);
  assert.equal(ctx.mailer.sent.length, 0, 'no email needed');
  const other = await at(ctx, preview, 'owen@buzzflix.ca');
  assert.deepEqual(other.body, {sent: true}, 'others still need a code');
  assert.equal(other.cookie, null);
  assert.equal(ctx.mailer.sent.at(-1).to, 'owen@buzzflix.ca');
  for (const host of ['www.buzzflix.ca', 'buzzflix.ca']) {
    const live = await at(ctx, host, 'jack@buzzflix.ca');
    assert.equal(live.body.signedIn, undefined, host);
    assert.equal(live.cookie, null, host);
  }
  ctx.open = true;
  assert.equal((await at(ctx, preview, 'jack@buzzflix.ca')).body.signedIn, undefined, 'off once applications open');
});

test('requests from another site are refused', async () => {
  const {staff} = setup();
  assert.equal((await staff('POST', '/code', {email: 'jack@buzzflix.ca'}, '', {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await staff('POST', '/code', {email: 'jack@buzzflix.ca'}, '', {'Content-Type': 'text/plain'})).status, 415);
});

test('staff list, change status, assign, add notes, download files and export', async () => {
  const {ctx, apply, staff, signIn} = setup();
  await apply(application({resume: {name: 'cv.pdf', data: pdf}}));
  const jack = await signIn('jack@buzzflix.ca');
  await signIn('megan@buzzflix.ca');

  const list = await staff('GET', '/applications', undefined, jack);
  assert.equal(list.body.year, '2027');
  assert.equal(list.body.applications.length, 1);
  assert.equal(list.body.applications[0].experience, undefined, 'the list leaves out long answers');
  assert.deepEqual(list.body.team.map(person => person.email), ['jack@buzzflix.ca', 'megan@buzzflix.ca']);

  ctx.now += 1000;
  const updated = await staff('PATCH', `/applications/${id}`, {status: 'interview', assigned_to: 'megan@buzzflix.ca'}, jack);
  assert.equal(updated.body.application.status, 'interview');
  assert.equal(updated.body.application.assigned_to, 'megan@buzzflix.ca');
  assert.equal(updated.body.application.has_resume, true);
  assert.deepEqual(updated.body.activity.map(row => [row.action, row.detail]).slice(0, 2).sort(),
    [['assigned', 'megan@buzzflix.ca'], ['status', 'New → Interview']]);
  assert.equal((await staff('PATCH', `/applications/${id}`, {status: 'approved'}, jack)).status, 400, 'not a status');
  assert.equal((await staff('PATCH', `/applications/${id}`, {assigned_to: 'nobody@buzzflix.ca'}, jack)).status, 400);

  const noted = await staff('POST', `/applications/${id}/notes`, {body: 'Great reel.'}, jack);
  assert.equal(noted.body.notes[0].body, 'Great reel.');
  assert.equal(noted.body.notes[0].author, 'jack@buzzflix.ca');

  const file = await staff('GET', `/applications/${id}/resume`, undefined, jack);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('Content-Type'), 'application/pdf');
  assert.equal((await staff('GET', `/applications/${id}/portfolio`, undefined, jack)).status, 404);

  const exported = await staff('GET', '/export.csv', undefined, jack);
  assert.match(exported.body, /Submitted,Name,Email/);
  assert.match(exported.body, /Test Applicant,test@example\.com/);
  assert.match(exported.body, /Interview,Megan,/);
});

test('hiring workflow: assigning starts the review, members interview and recommend, only admins decide', async () => {
  const {ctx, apply, staff, signIn} = setup();
  const before = await ctx.store.version();
  await apply(application());
  assert.ok(await ctx.store.version() > before, 'a new application counts as a change');
  const jack = await signIn('jack@buzzflix.ca');
  const megan = await signIn('megan@buzzflix.ca');
  const move = (status, who) => staff('PATCH', `/applications/${id}`, {status}, who);
  const assign = (email, who) => staff('PATCH', `/applications/${id}`, {assigned_to: email}, who);

  assert.deepEqual((await staff('GET', `/applications/${id}`, undefined, megan)).body.allowedStatuses, ['new'], 'unassigned stays New');
  assert.equal((await move('reviewing', jack)).status, 403, 'even admins assign first');
  const version = (await staff('GET', '/changes', undefined, megan)).body.version;
  const assigned = await assign('megan@buzzflix.ca', megan);
  assert.equal(assigned.body.application.status, 'reviewing', 'assigning moves it to In review');
  assert.deepEqual(assigned.body.allowedStatuses, ['reviewing', 'interview']);
  assert.ok((await staff('GET', '/changes', undefined, jack)).body.version > version, 'every save moves the version on');
  assert.equal((await assign(null, megan)).body.application.status, 'new', 'unassigning In review goes back to New');
  await assign('megan@buzzflix.ca', megan);
  assert.equal((await move('new', megan)).status, 403, 'New only by unassigning');
  assert.equal((await move('approve', megan)).status, 403, 'approve comes after the interview');
  assert.equal((await move('interview', megan)).body.allowedStatuses.includes('approve'), true);
  assert.equal((await assign(null, megan)).status, 400, 'past review it needs someone');
  assert.equal((await assign('jack@buzzflix.ca', megan)).body.application.status, 'interview', 'but can be reassigned');
  assert.equal((await move('hired', megan)).status, 403, 'members can’t make the final decision');

  const noted = await staff('POST', `/applications/${id}/notes`, {body: 'Interviewed. Great fit.', kind: 'interview'}, megan);
  assert.equal(noted.body.notes[0].kind, 'interview');
  assert.equal(noted.body.activity[0].detail, 'interview');
  assert.equal((await staff('POST', `/applications/${id}/notes`, {body: 'Odd kind', kind: 'secret'}, megan)).body.notes[1].kind, 'note');

  const recommended = await move('approve', megan);
  assert.equal(recommended.body.application.status, 'approve');
  assert.equal(recommended.body.recommendedBy, 'megan@buzzflix.ca');
  assert.equal((await staff('GET', `/applications/${id}`, undefined, jack)).body.recommendedBy, 'megan@buzzflix.ca');

  assert.equal((await move('hired', jack)).body.application.status, 'hired');
  assert.deepEqual((await staff('GET', `/applications/${id}`, undefined, megan)).body.allowedStatuses, ['hired']);
  assert.equal((await move('interview', megan)).status, 403, 'members can’t undo a final decision');
  assert.equal((await move('not_hired', jack)).status, 200, 'admins can change it');
});

test('staff can add an application by hand, with a PDF and an assignee', async () => {
  const {ctx, staff, signIn} = setup({open: false});
  const megan = await signIn('megan@buzzflix.ca');
  const emails = ctx.mailer.sent.length;
  const entry = {name: 'Paper Applicant', email: 'paper@example.com', school: 'St. Clair College', program_year: 'Film, 1st year',
    role_1: 'Gaffer', role_2: 'Grip', role_3: 'Key Grip'};
  assert.equal((await staff('POST', '/applications', {...entry, role_3: 'grip'}, megan)).status, 400, 'three different positions');
  assert.equal((await staff('POST', '/applications', {...entry, email: 'nope'}, megan)).status, 400);
  assert.equal((await staff('POST', '/applications', {...entry, resume: {name: 'x.pdf', data: btoa('not a pdf')}}, megan)).body.error, 'The resume must be a PDF file.');
  assert.equal((await staff('POST', '/applications', {...entry, assigned_to: 'nobody@buzzflix.ca'}, megan)).status, 400);
  const added = await staff('POST', '/applications', {...entry, resume: {name: 'cv.pdf', data: pdf}, assigned_to: 'megan@buzzflix.ca'}, megan);
  const saved = (await staff('GET', `/applications/${added.body.id}`, undefined, megan)).body;
  assert.equal(saved.application.name, 'Paper Applicant');
  assert.equal(saved.application.status, 'reviewing', 'assigned, so In review');
  assert.equal(saved.application.has_resume, true);
  assert.equal(saved.application.consent_version, 'added-by-staff');
  assert.deepEqual(saved.activity.map(row => row.action).sort(), ['added', 'assigned', 'status']);
  assert.equal(ctx.mailer.sent.length, emails, 'no confirmation email for a typed-in application');
});

test('admins manage the team and delete applications; members cannot', async () => {
  const {ctx, apply, staff, signIn} = setup();
  await apply(application({resume: {name: 'cv.pdf', data: pdf}}));
  const jack = await signIn('jack@buzzflix.ca');
  const owen = await signIn('owen@buzzflix.ca');

  assert.equal((await staff('POST', '/team', {email: 'tony@buzzflix.ca', name: 'Tony'}, owen)).status, 403);
  assert.equal((await staff('POST', '/team', {email: 'tony@buzzflix.ca', name: 'Tony'}, jack)).body.person.name, 'Tony');
  assert.equal((await staff('POST', '/team', {email: 'tony@gmail.com'}, jack)).status, 400);
  assert.equal((await staff('PATCH', '/team/owen%40buzzflix.ca', {name: 'Owen K'}, owen)).body.person.name, 'Owen K');
  assert.equal((await staff('PATCH', '/team/tony%40buzzflix.ca', {name: 'T'}, owen)).status, 403);
  assert.equal((await staff('PATCH', '/team/owen%40buzzflix.ca', {role: 'admin'}, owen)).status, 403);
  assert.equal((await staff('PATCH', '/team/jack%40buzzflix.ca', {blocked: true}, jack)).status, 403, 'not yourself');

  await staff('PATCH', `/applications/${id}`, {assigned_to: 'owen@buzzflix.ca'}, jack);
  const blocked = await staff('PATCH', '/team/owen%40buzzflix.ca', {blocked: true}, jack);
  assert.equal(blocked.body.person.blocked, true);
  assert.equal((await staff('GET', '/me', undefined, owen)).status, 401, 'blocking ends their sessions');
  assert.equal((await ctx.store.getApplication(id)).assigned_to, null, 'and unassigns them');
  const before = ctx.mailer.sent.length;
  assert.deepEqual((await staff('POST', '/code', {email: 'owen@buzzflix.ca'})).body, {sent: true}, 'looks the same');
  assert.equal(ctx.mailer.sent.length, before, 'but no code is sent to blocked people');

  const member = await signIn('megan@buzzflix.ca');
  assert.equal((await staff('DELETE', `/applications/${id}`, undefined, member)).status, 403);
  assert.equal((await staff('DELETE', `/applications/${id}`, undefined, jack)).body.deleted, true);
  assert.equal(await ctx.store.getApplication(id), null);
  assert.deepEqual(ctx.files.keys(), []);
});

test('/staff pages send signed-out visitors to /login', async () => {
  const {ctx, signIn} = setup();
  const serve = () => new Response('page');
  const out = await staffPage(new Request(`${ORIGIN}/staff/application?id=${id}`), ctx, serve);
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('Location'), `/login?next=${encodeURIComponent(`/staff/application?id=${id}`)}`);
  const cookie = await signIn('jack@buzzflix.ca');
  const page = await staffPage(new Request(`${ORIGIN}/staff/`, {headers: {Cookie: cookie}}), ctx, serve);
  assert.equal(await page.text(), 'page');
  assert.equal(page.headers.get('X-Robots-Tag'), 'noindex');
});
