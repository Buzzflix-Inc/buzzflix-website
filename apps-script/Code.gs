// Paste this entire file into Code.gs using Extensions > Apps Script in your sheet.
const APPLICATION_TAB = 'Submission Records';
const APPLICATION_HEADERS = ['Submission ID', 'Submitted At', 'Name', 'Email', 'School', 'Previous Experience', 'Role 1', 'Role 2', 'Role 3', 'Additional Roles', 'Consent Version', 'Status'];
// Answers saved before applications open, so the applicant can reload them from an emailed link.
const DRAFT_TAB = 'Saved Drafts';
const DRAFT_HEADERS = ['Draft ID', 'Saved At', 'Email', 'Answers'];
const DRAFT_FIELDS = ['name', 'email', 'school', 'experience', 'role_1', 'role_2', 'role_3', 'additional_roles'];
const DRAFT_LINK = 'https://www.buzzflix.ca/apply#draft=';
// The positions in the apply.html picker, by department. Keep in step with apply.html.
// An applicant may choose at most two from one department; free-text roles from the homepage form are not counted.
const DEPARTMENT_LIMIT = 2;
const DEPARTMENTS = {
  'Production': ['Production Assistant', 'Production Coordinator', 'Assistant Director', 'Script Supervisor', 'Location Scout', 'Production Accountant'],
  'Camera': ['Director of Photography', 'Camera Operator', '1st Assistant Camera', '2nd Assistant Camera', 'Digital Imaging Technician'],
  'Grip & Electric': ['Gaffer', 'Electrician', 'Key Grip', 'Grip', 'Dolly Grip'],
  'Sound': ['Production Sound Mixer', 'Boom Operator', 'Sound Utility'],
  'Art & Wardrobe': ['Production Designer', 'Set Decorator', 'Props Master', 'Costume Designer', 'Wardrobe Stylist', 'Makeup Artist', 'Hair Stylist'],
  'Post-Production': ['Editor', 'Assistant Editor', 'Colourist', 'Sound Editor', 'VFX Artist', 'Composer'],
  'Social Media': ['Content Creator', 'Stills Photographer', 'BTS Videographer', 'Publicist'],
  'Acting': ['Actor', 'Background Performer']
};

// Run once from the editor while this script is attached to 2027 Applications.
function setupApplications() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open Apps Script from Extensions in your application spreadsheet.');
  const sheet = spreadsheet.getSheetByName(APPLICATION_TAB) || spreadsheet.insertSheet(APPLICATION_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, APPLICATION_HEADERS.length).setValues([APPLICATION_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    checkApplicationHeaders_(sheet);
  }
  const drafts = spreadsheet.getSheetByName(DRAFT_TAB) || spreadsheet.insertSheet(DRAFT_TAB);
  if (drafts.getLastRow() === 0) {
    drafts.getRange(1, 1, 1, DRAFT_HEADERS.length).setValues([DRAFT_HEADERS]);
    drafts.setFrozenRows(1);
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  SpreadsheetApp.flush();
}

function doGet(event) {
  const draftId = event && event.parameter && event.parameter.draft;
  if (draftId !== undefined) return applicationResponse_(loadDraft_(draftId));
  return applicationResponse_({ready: Boolean(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'))});
}

function doPost(event) {
  let locked = false;
  const lock = LockService.getScriptLock();
  try {
    if (!event || !event.postData || event.postData.length > 50000) throw new Error('Please shorten your answers and try again.');
    let input;
    try { input = JSON.parse(event.postData.contents); }
    catch (_) { throw new Error('Please refresh the application page and try again.'); }
    if (input && input.action === 'save_draft') {
      const draft = validateDraft_(input);
      if (!lock.tryLock(15000)) throw new Error('Several people are saving right now. Please wait a moment and try again.');
      locked = true;
      return applicationResponse_(saveDraft_(draft));
    }
    const data = validateApplication_(input);
    if (!lock.tryLock(15000)) throw new Error('Several applications are arriving right now. Please wait a moment and try again.');
    locked = true;
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('Applications are not open yet. Please try again later.');
    // A basic shared throttle. Cache entries can expire early; this is not CAPTCHA.
    const cache = CacheService.getScriptCache();
    const key = 'applications-minute-' + Math.floor(Date.now() / 60000);
    const count = Number(cache.get(key) || 0);
    if (count >= 20) throw new Error('We are receiving several applications right now. Please wait a minute and try again.');
    cache.put(key, String(count + 1), 120);
    const sheet = SpreadsheetApp.openById(id).getSheetByName(APPLICATION_TAB);
    if (!sheet) throw new Error('Application storage is not ready. Please try again later.');
    checkApplicationHeaders_(sheet);
    const answers = [data.name, data.email, data.school, data.experience, data.role_1, data.role_2, data.role_3, data.additional_roles, data.consent_version];
    const lastRow = sheet.getLastRow();
    const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, APPLICATION_HEADERS.length).getValues() : [];
    const existing = rows.find(row => String(row[0]) === data.submission_id);
    if (existing) {
      if (!answers.every((answer, index) => String(existing[index + 2]) === answer || String(existing[index + 2]) === applicationText_(answer))) {
        throw new Error('This application reference belongs to different answers. Please refresh the page and try again.');
      }
      return applicationResponse_({accepted: true, submissionId: data.submission_id, duplicate: true, confirmationEmailQueued: false});
    }
    const row = [data.submission_id, new Date().toISOString()].concat(answers, ['Received']).map(applicationText_);
    sheet.getRange(lastRow + 1, 1, 1, APPLICATION_HEADERS.length).setValues([row]);
    SpreadsheetApp.flush();
    return applicationResponse_({accepted: true, submissionId: data.submission_id, duplicate: false, confirmationEmailQueued: false});
  } catch (error) {
    // Only validation/configuration errors have applicant-facing messages.
    const known = error && error.message;
    const allowed = /^(Please |Several applications |Several people |Applications are |Application storage |Saving |We are receiving |You've saved |This application reference )/;
    return applicationResponse_({accepted: false, message: typeof known === 'string' && allowed.test(known)
      ? known : 'We could not confirm your application was saved. Please wait a moment and try again.'});
  } finally {
    if (locked) lock.releaseLock();
  }
}

function validateApplication_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please check your application details.');
  const limits = {submission_id: 36, application_year: 4, name: 150, email: 254, school: 250, experience: 10000,
    role_1: 150, role_2: 150, role_3: 150, additional_roles: 500, consent: 10, consent_version: 40, website: 500};
  const result = {};
  Object.keys(limits).forEach(key => {
    const value = input[key] === undefined ? '' : input[key];
    if (typeof value !== 'string') throw new Error('Please check your application details.');
    result[key] = value.trim();
    if (result[key].length > limits[key]) throw new Error('Please shorten your answers and try again.');
  });
  if (result.website) throw new Error('Please try submitting the form again.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.submission_id)) throw new Error('Please refresh the page and try again.');
  ['name', 'school', 'experience', 'role_1', 'role_2', 'role_3'].forEach(key => {
    if (!result[key]) throw new Error('Please complete all required fields.');
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Please enter a valid email address.');
  if (new Set([result.role_1, result.role_2, result.role_3].map(role => role.toLowerCase())).size !== 3) throw new Error('Please list three different roles.');
  const crowded = Object.keys(DEPARTMENTS).find(department => {
    const positions = DEPARTMENTS[department].map(position => position.toLowerCase());
    return [result.role_1, result.role_2, result.role_3].filter(role => positions.indexOf(role.toLowerCase()) >= 0).length > DEPARTMENT_LIMIT;
  });
  if (crowded) throw new Error('Please choose at most two ' + crowded + ' positions. Pick your third from another department.');
  if (result.application_year !== '2027' || result.consent_version !== '2027-text-v1' || result.consent !== 'agreed') throw new Error('Please agree to the application terms.');
  return result;
}

function validateDraft_(input) {
  const limits = {name: 150, email: 254, school: 250, experience: 10000, role_1: 150, role_2: 150, role_3: 150, additional_roles: 500, website: 500};
  const result = {};
  Object.keys(limits).forEach(key => {
    const value = input[key] === undefined ? '' : input[key];
    if (typeof value !== 'string') throw new Error('Please check your application details.');
    result[key] = value.trim();
    if (result[key].length > limits[key]) throw new Error('Please shorten your answers and try again.');
  });
  if (result.website) throw new Error('Please try saving again.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Please enter a valid email address.');
  return result;
}

function saveDraft_(draft) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const sheet = id && SpreadsheetApp.openById(id).getSheetByName(DRAFT_TAB);
  if (!sheet) throw new Error("Saving isn't available yet. Please try again later.");
  // Each save sends an email, so limit how often one address, and everyone together, can save.
  const cache = CacheService.getScriptCache();
  const minuteKey = 'drafts-minute-' + Math.floor(Date.now() / 60000);
  const emailKey = 'drafts-email-' + draft.email.toLowerCase();
  const minuteCount = Number(cache.get(minuteKey) || 0);
  const emailCount = Number(cache.get(emailKey) || 0);
  if (minuteCount >= 10) throw new Error('We are receiving several saves right now. Please wait a minute and try again.');
  if (emailCount >= 3) throw new Error("You've saved several times recently. Please use the newest link in your email, or try again in an hour.");
  cache.put(minuteKey, String(minuteCount + 1), 120);
  cache.put(emailKey, String(emailCount + 1), 3600);
  const draftId = Utilities.getUuid().replace(/-/g, '');
  const answers = {};
  DRAFT_FIELDS.forEach(key => { answers[key] = draft[key]; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, DRAFT_HEADERS.length)
    .setValues([[draftId, new Date().toISOString(), applicationText_(draft.email), JSON.stringify(answers)]]);
  SpreadsheetApp.flush();
  const link = DRAFT_LINK + draftId;
  // The email holds only fixed text and the link, never the applicant's own answers.
  MailApp.sendEmail({
    to: draft.email,
    name: 'Buzzflix',
    subject: 'Your saved Buzzflix 2027 application',
    body: 'Your Buzzflix 2027 application is saved. Applications open January 18, 2027. When they do, open this link and your answers will be filled in, ready to check and submit:\n\n' + link +
      '\n\nYour application has not been submitted yet. You still need to submit it once applications open.\n\nIf you didn\'t ask for this email, you can ignore it.',
    htmlBody: '<p>Your Buzzflix 2027 application is saved. Applications open January 18, 2027. When they do, open this link and your answers will be filled in, ready to check and submit:</p>' +
      '<p><a href="' + link + '">Open my saved application</a></p>' +
      '<p>Your application has not been submitted yet. You still need to submit it once applications open.</p>' +
      '<p>If you didn&rsquo;t ask for this email, you can ignore it.</p>'
  });
  return {saved: true};
}

function loadDraft_(draftId) {
  if (!/^[0-9a-f]{32}$/.test(draftId)) return {found: false};
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const sheet = id && SpreadsheetApp.openById(id).getSheetByName(DRAFT_TAB);
  if (!sheet || sheet.getLastRow() < 2) return {found: false};
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DRAFT_HEADERS.length).getValues();
  const row = rows.find(cells => String(cells[0]) === draftId);
  if (!row) return {found: false};
  const answers = JSON.parse(String(row[3]));
  const draft = {};
  DRAFT_FIELDS.forEach(key => { draft[key] = typeof answers[key] === 'string' ? answers[key] : ''; });
  return {found: true, draft};
}

function checkApplicationHeaders_(sheet) {
  const headings = sheet.getRange(1, 1, 1, APPLICATION_HEADERS.length).getValues()[0];
  if (!APPLICATION_HEADERS.every((heading, index) => headings[index] === heading)) throw new Error('Application storage headings need setup. Please try again later.');
}
function applicationText_(value) {
  // Sheets treats a leading '=' as a formula. Prefix formula-like answers as text.
  const text = String(value);
  return /^[=+@-]/.test(text) ? "'" + text : text;
}
function applicationResponse_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
