/**
 * Public application API, used by assets/js/application-form.js. Replaces the Google Apps Script backend
 * (apps-script/Code.gs) with the same request and response shapes, so the form only changed its endpoint.
 *   GET  /api/apply               → {ready: true}
 *   GET  /api/apply?draft=<id>    → {found, draft}
 *   POST /api/apply {action: 'save_draft', ...answers} → {saved: true} and emails a /apply#draft=<id> link
 *   POST /api/apply {...application}                   → {accepted, submissionId, duplicate, confirmationEmailQueued}
 * Bodies are JSON sent as text/plain. Errors come back as {accepted:false|saved:false, message} with status 200,
 * like Apps Script did, and the form shows the message.
 * ctx: {store, files, mailer, now, open, waitUntil}. `open` is false until applications open (APPLICATIONS_OPEN).
 */
import {emailHtml, REPLY_TO} from './mail.js';

export const APPLICATION_YEAR = '2027';
export const CONSENT_VERSION = '2027-text-v2';
const ANSWER_FIELDS = ['name', 'email', 'school', 'program_year', 'experience', 'why_join', 'role_1', 'role_2', 'role_3', 'additional_roles'];
const DOCUMENT_FIELDS = ['resume', 'portfolio'];
const DOCUMENT_LABELS = {resume: 'resume', portfolio: 'portfolio'};
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const BODY_MAX_BYTES = 15_000_000; // two 5 MB PDFs, which grow by a third as base64, plus the answers
const WORD_LIMITS = {experience: 100, why_join: 100};
const DRAFT_LINK = 'https://www.buzzflix.ca/apply#draft=';
// The positions in the apply.html picker, by department. Keep in step with apply.html.
// An applicant may choose at most two from one department.
const DEPARTMENT_LIMIT = 2;
export const DEPARTMENTS = {
  'Production': ['Production Assistant', 'Production Coordinator', 'Assistant Director', 'Script Supervisor', 'Location Scout', 'Production Accountant'],
  'Camera': ['Director of Photography', 'Camera Operator', '1st Assistant Camera', '2nd Assistant Camera', 'Digital Imaging Technician'],
  'Grip & Electric': ['Gaffer', 'Electrician', 'Key Grip', 'Grip', 'Dolly Grip'],
  'Sound': ['Production Sound Mixer', 'Boom Operator', 'Sound Utility'],
  'Art & Wardrobe': ['Production Designer', 'Set Decorator', 'Props Master', 'Costume Designer', 'Wardrobe Stylist', 'Makeup Artist', 'Hair Stylist'],
  'Post-Production': ['Editor', 'Assistant Editor', 'Colourist', 'Sound Editor', 'VFX Artist', 'Composer'],
  'Social Media': ['Content Creator', 'Stills Photographer', 'BTS Videographer', 'Publicist'],
  'Acting': ['Actor', 'Background Performer']
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A message the applicant should see. Anything else becomes a generic "please try again".
class ApplicantError extends Error {}
const fail = message => { throw new ApplicantError(message); };
const json = body => new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

export async function applyApi(request, ctx) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const draft = url.searchParams.get('draft');
    return json(draft === null ? {ready: true} : await loadDraft(ctx.store, draft));
  }
  if (request.method !== 'POST') return new Response(JSON.stringify({error: 'Not found.'}), {status: 405, headers: {'Content-Type': 'application/json'}});

  let isDraft = false;
  try {
    const text = await request.text();
    if (text.length > BODY_MAX_BYTES) fail('Please shorten your answers and try again.');
    let input;
    try { input = JSON.parse(text); } catch { fail('Please refresh the application page and try again.'); }
    isDraft = input?.action === 'save_draft';
    if (isDraft) return json(await saveDraft(ctx, validateDraft(input)));
    return json(await submit(ctx, validateApplication(input)));
  } catch (error) {
    if (!(error instanceof ApplicantError)) console.error('apply failed', error);
    const message = error instanceof ApplicantError ? error.message
      : isDraft ? 'We couldn’t save your answers. Please wait a moment and try again.'
      : 'We could not confirm your application was saved. Please wait a moment and try again.';
    return json(isDraft ? {saved: false, message} : {accepted: false, message});
  }
}

const strings = (input, limits) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Please check your application details.');
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = input[key] ?? '';
    if (typeof value !== 'string') fail('Please check your application details.');
    result[key] = value.trim();
    if (result[key].length > limit) fail('Please shorten your answers and try again.');
  }
  return result;
};

export function validateApplication(input) {
  const result = strings(input, {submission_id: 36, application_year: 4, name: 150, email: 254, school: 250, program_year: 150,
    experience: 10000, why_join: 5000, role_1: 150, role_2: 150, role_3: 150, additional_roles: 500, consent: 10, eligibility: 10,
    consent_version: 40, website: 500});
  for (const key of DOCUMENT_FIELDS) result[key] = validateDocument(input[key], DOCUMENT_LABELS[key]);
  if (result.website) fail('Please try submitting the form again.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.submission_id)) fail('Please refresh the page and try again.');
  result.submission_id = result.submission_id.toLowerCase();
  for (const key of ['name', 'school', 'program_year', 'experience', 'why_join', 'role_1', 'role_2', 'role_3']) {
    if (!result[key]) fail('Please complete all required fields.');
  }
  for (const [key, limit] of Object.entries(WORD_LIMITS)) {
    if (result[key].split(/\s+/).filter(Boolean).length > limit) fail(`Please keep each written answer to ${limit} words or fewer.`);
  }
  if (!EMAIL.test(result.email)) fail('Please enter a valid email address.');
  const roles = [result.role_1, result.role_2, result.role_3].map(role => role.toLowerCase());
  if (new Set(roles).size !== 3) fail('Please list three different roles.');
  const crowded = Object.keys(DEPARTMENTS).find(department =>
    roles.filter(role => DEPARTMENTS[department].some(position => position.toLowerCase() === role)).length > DEPARTMENT_LIMIT);
  if (crowded) fail(`Please choose at most two ${crowded} positions. Pick your third from another department.`);
  if (result.eligibility !== 'confirmed') fail('Please confirm you are a Canadian citizen or permanent resident.');
  if (result.application_year !== APPLICATION_YEAR || result.consent_version !== CONSENT_VERSION || result.consent !== 'agreed') {
    fail('Please agree to the privacy policy and application terms.');
  }
  return result;
}

// An attachment is {name, data} with base64 PDF data, or absent. Returns the bytes, or null when absent.
function validateDocument(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object' || typeof value.name !== 'string' || typeof value.data !== 'string') fail('Please check your application details.');
  if (value.data.length > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4) fail(`Your ${label} is over 5 MB. Please choose a smaller PDF.`);
  let bytes;
  try { bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0)); }
  catch { fail(`Your ${label} could not be read. Please choose the file again.`); }
  if (bytes.length > DOCUMENT_MAX_BYTES) fail(`Your ${label} is over 5 MB. Please choose a smaller PDF.`);
  // Every PDF starts with %PDF-, whatever its file name says.
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') fail(`Your ${label} must be a PDF file.`);
  return bytes;
}

// An application a staff member types in (a paper or emailed application): the same answers and PDFs,
// without the applicant-only checks (consent boxes, word limits, the two-per-department rule).
// Returns {id} or {error}. ctx: {store, files, now}.
export async function addApplicationByStaff({store, files, now}, input, staffEmail) {
  try {
    const data = strings(input, {name: 150, email: 254, school: 250, program_year: 150, experience: 10000, why_join: 5000,
      role_1: 150, role_2: 150, role_3: 150, additional_roles: 500});
    for (const key of ['name', 'email', 'school', 'program_year', 'role_1', 'role_2', 'role_3']) {
      if (!data[key]) fail('Fill in the name, email, school, program and three positions.');
    }
    if (!EMAIL.test(data.email)) fail('Enter a valid email address for the applicant.');
    if (new Set([data.role_1, data.role_2, data.role_3].map(role => role.toLowerCase())).size !== 3) fail('List three different positions.');
    const documents = {};
    for (const key of DOCUMENT_FIELDS) documents[key] = validateDocument(input[key], DOCUMENT_LABELS[key]);
    const id = crypto.randomUUID();
    const row = {id, year: APPLICATION_YEAR, submitted_at: now, updated_at: now, consent_version: 'added-by-staff', ...data};
    for (const key of DOCUMENT_FIELDS) {
      if (!documents[key]) continue;
      row[`${key}_key`] = `${APPLICATION_YEAR}/${id}/${key}.pdf`;
      await files.put(row[`${key}_key`], documents[key]);
    }
    await store.insertApplication(row);
    await store.addActivity(id, staffEmail, 'added', '', now);
    return {id};
  } catch (error) {
    if (error instanceof ApplicantError) return {error: error.message.replace(/^Your /, 'The ')};
    throw error;
  }
}

async function submit(ctx, data) {
  const {store, files, mailer, now} = ctx;
  // TEMPORARY: ctx.testSubmissions (TEST_SUBMISSIONS in wrangler.jsonc) lets the preview addresses accept applications.
  if (!ctx.open && !ctx.testSubmissions) fail('Applications are not open yet. Please try again later.');
  const existing = await store.getApplication(data.submission_id);
  if (existing) return duplicate(existing, data);
  if (!await store.hit('applications', now, 60_000, 20)) fail('We are receiving several applications right now. Please wait a minute and try again.');

  const row = {id: data.submission_id, year: APPLICATION_YEAR, submitted_at: now, updated_at: now, consent_version: data.consent_version};
  for (const key of ANSWER_FIELDS) row[key] = data[key];
  for (const key of DOCUMENT_FIELDS) {
    if (!data[key]) continue;
    row[`${key}_key`] = `${APPLICATION_YEAR}/${data.submission_id}/${key}.pdf`;
    await files.put(row[`${key}_key`], data[key]);
  }
  // Two submits with the same id at once: the second insert is ignored, and it reports a duplicate.
  if (!await store.insertApplication(row)) return duplicate(await store.getApplication(data.submission_id), data);
  await store.addActivity(row.id, row.email, 'submitted', '', now);
  await store.bump(); // open staff pages show it without a reload

  const sending = mailer.send({
    to: data.email, replyTo: REPLY_TO,
    subject: 'We received your Buzzflix 2027 application',
    text: `Hi ${data.name},\n\nThanks for applying to Buzzflix 2027. Your application is in, and our team will review it after applications close in March. If you’re shortlisted, we’ll email you to set up an online interview.\n\nYour application reference is ${row.id}.\n\nQuestions? Reply to this email or write to ${REPLY_TO}.`,
    html: emailHtml([`Hi ${data.name},`, 'Thanks for applying to Buzzflix 2027. Your application is in, and our team will review it after applications close in March. If you’re shortlisted, we’ll email you to set up an online interview.',
      `Your application reference is ${row.id}.`, `Questions? Reply to this email or write to ${REPLY_TO}.`])
  }).catch(error => console.error('confirmation email failed', error));
  ctx.waitUntil?.(sending);
  return {accepted: true, submissionId: row.id, duplicate: false, confirmationEmailQueued: true};
}

// A retry of a saved application must have the same written answers. Its files were saved the first time.
function duplicate(existing, data) {
  if (!ANSWER_FIELDS.every(key => existing[key] === data[key])) {
    fail('This application reference belongs to different answers. Please refresh the page and try again.');
  }
  return {accepted: true, submissionId: existing.id, duplicate: true, confirmationEmailQueued: false};
}

function validateDraft(input) {
  const result = strings(input, {name: 150, email: 254, school: 250, program_year: 150, experience: 10000, why_join: 5000,
    role_1: 150, role_2: 150, role_3: 150, additional_roles: 500, website: 500});
  if (result.website) fail('Please try saving again.');
  if (!EMAIL.test(result.email)) fail('Please enter a valid email address.');
  return result;
}

async function saveDraft({store, mailer, now}, draft) {
  // Each save sends an email, so limit how often one address, and everyone together, can save.
  if (!await store.hit('drafts', now, 60_000, 10)) fail('We are receiving several saves right now. Please wait a minute and try again.');
  if (!await store.hit(`drafts:${draft.email.toLowerCase()}`, now, 60 * 60_000, 3)) {
    fail('You’ve saved several times recently. Please use the newest link in your email, or try again in an hour.');
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  await store.putDraft(id, draft.email, JSON.stringify(Object.fromEntries(ANSWER_FIELDS.map(key => [key, draft[key]]))), now);
  const link = DRAFT_LINK + id;
  // The email holds only fixed text and the link, never the applicant's own answers.
  await mailer.send({
    to: draft.email, replyTo: REPLY_TO,
    subject: 'Your saved Buzzflix 2027 application',
    text: `Your Buzzflix 2027 application is saved. Applications open January 18, 2027. When they do, open this link and your answers will be filled in, ready to check and submit:\n\n${link}\n\nYour application has not been submitted yet. You still need to submit it once applications open.\n\nIf you didn’t ask for this email, you can ignore it.`,
    html: emailHtml(['Your Buzzflix 2027 application is saved. Applications open January 18, 2027. When they do, open this link and your answers will be filled in, ready to check and submit:',
      'Your application has not been submitted yet. You still need to submit it once applications open.', 'If you didn’t ask for this email, you can ignore it.'],
    {link: {href: link, label: 'Open my saved application'}})
  });
  return {saved: true};
}

async function loadDraft(store, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) return {found: false};
  const row = await store.getDraft(id);
  if (!row) return {found: false};
  const answers = JSON.parse(row.answers);
  return {found: true, draft: Object.fromEntries(ANSWER_FIELDS.map(key => [key, typeof answers[key] === 'string' ? answers[key] : '']))};
}
