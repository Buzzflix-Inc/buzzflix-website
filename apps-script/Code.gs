// Paste this entire file into Code.gs using Extensions > Apps Script in your sheet.
const APPLICATION_TAB = 'Submission Records';
const APPLICATION_HEADERS = ['Submission ID', 'Submitted At', 'Name', 'Email', 'School', 'Program & Year', 'Previous Experience', 'Why Buzzflix', 'Role 1', 'Role 2', 'Role 3', 'Additional Roles', 'Resume', 'Portfolio', 'Consent Version', 'Status'];
// The applicant's answers, in sheet order from column C; Resume and Portfolio hold links to the files.
const ANSWER_FIELDS = ['name', 'email', 'school', 'program_year', 'experience', 'why_join', 'role_1', 'role_2', 'role_3', 'additional_roles', 'resume', 'portfolio', 'consent_version'];
// Optional PDF attachments, saved to a private Drive folder that setup creates.
const DOCUMENT_FIELDS = ['resume', 'portfolio'];
const DOCUMENT_LABELS = {resume: 'Resume', portfolio: 'Portfolio'};
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_FOLDER = 'Buzzflix 2027 Application Documents';
// Answers saved before applications open, so the applicant can reload them from an emailed link.
const DRAFT_TAB = 'Saved Drafts';
const DRAFT_HEADERS = ['Draft ID', 'Saved At', 'Email', 'Answers'];
const WORD_LIMITS = {experience: 100, why_join: 100};
const DRAFT_FIELDS =['name', 'email', 'school', 'program_year', 'experience', 'why_join', 'role_1', 'role_2', 'role_3', 'additional_roles'];
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
  // A tab with only its heading row (no applications yet) is safe to bring up to the current headings.
  if (sheet.getLastRow() <= 1) {
    sheet.getRange(1, 1, 1, APPLICATION_HEADERS.length).setValues([APPLICATION_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    checkApplicationHeaders_(sheet);
  }
  const properties = PropertiesService.getScriptProperties();
  const folderId = properties.getProperty('DOCUMENT_FOLDER_ID');
  let folder = null;
  try { folder = folderId && DriveApp.getFolderById(folderId); } catch (_) { folder = null; }
  if (!folder) properties.setProperty('DOCUMENT_FOLDER_ID', DriveApp.createFolder(DOCUMENT_FOLDER).getId());
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
    // Room for two 5 MB PDFs, which grow by a third as base64, plus the written answers.
    if (!event || !event.postData || event.postData.length > 15000000) throw new Error('Please shorten your answers and try again.');
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
    const lastRow = sheet.getLastRow();
    const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, APPLICATION_HEADERS.length).getValues() : [];
    const existing = rows.find(row => String(row[0]) === data.submission_id);
    if (existing) {
      // A retry of a saved application: the written answers must match. Its files were saved the first time.
      const same = ANSWER_FIELDS.every((key, index) => DOCUMENT_FIELDS.indexOf(key) >= 0
        || String(existing[index + 2]) === data[key] || String(existing[index + 2]) === applicationText_(data[key]));
      if (!same) throw new Error('This application reference belongs to different answers. Please refresh the page and try again.');
      return applicationResponse_({accepted: true, submissionId: data.submission_id, duplicate: true, confirmationEmailQueued: false});
    }
    const links = saveDocuments_(data);
    const answers = ANSWER_FIELDS.map(key => DOCUMENT_FIELDS.indexOf(key) >= 0 ? links[key] : data[key]);
    const row = [data.submission_id, new Date().toISOString()].concat(answers, ['Received']).map(applicationText_);
    sheet.getRange(lastRow + 1, 1, 1, APPLICATION_HEADERS.length).setValues([row]);
    SpreadsheetApp.flush();
    return applicationResponse_({accepted: true, submissionId: data.submission_id, duplicate: false, confirmationEmailQueued: false});
  } catch (error) {
    // Only validation/configuration errors have applicant-facing messages.
    const known = error && error.message;
    const allowed = /^(Please |Your resume |Your portfolio |Several applications |Several people |Applications are |Application storage |Saving |We are receiving |You've saved |This application reference )/;
    return applicationResponse_({accepted: false, message: typeof known === 'string' && allowed.test(known)
      ? known : 'We could not confirm your application was saved. Please wait a moment and try again.'});
  } finally {
    if (locked) lock.releaseLock();
  }
}

function validateApplication_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please check your application details.');
  const limits = {submission_id: 36, application_year: 4, name: 150, email: 254, school: 250, program_year: 150, experience: 10000, why_join: 5000,
    role_1: 150, role_2: 150, role_3: 150, additional_roles: 500, consent: 10, eligibility: 10, consent_version: 40, website: 500};
  const result = {};
  DOCUMENT_FIELDS.forEach(key => { result[key] = validateDocument_(input[key], DOCUMENT_LABELS[key]); });
  Object.keys(limits).forEach(key => {
    const value = input[key] === undefined ? '' : input[key];
    if (typeof value !== 'string') throw new Error('Please check your application details.');
    result[key] = value.trim();
    if (result[key].length > limits[key]) throw new Error('Please shorten your answers and try again.');
  });
  if (result.website) throw new Error('Please try submitting the form again.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.submission_id)) throw new Error('Please refresh the page and try again.');
  ['name', 'school', 'program_year', 'experience', 'why_join', 'role_1', 'role_2', 'role_3'].forEach(key => {
    if (!result[key]) throw new Error('Please complete all required fields.');
  });
  // Same limits and counting as data-word-limit in application-form.js.
  Object.keys(WORD_LIMITS).forEach(key => {
    if (result[key].split(/\s+/).filter(Boolean).length > WORD_LIMITS[key]) throw new Error('Please keep each written answer to ' + WORD_LIMITS[key] + ' words or fewer.');
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Please enter a valid email address.');
  if (new Set([result.role_1, result.role_2, result.role_3].map(role => role.toLowerCase())).size !== 3) throw new Error('Please list three different roles.');
  const crowded = Object.keys(DEPARTMENTS).find(department => {
    const positions = DEPARTMENTS[department].map(position => position.toLowerCase());
    return [result.role_1, result.role_2, result.role_3].filter(role => positions.indexOf(role.toLowerCase()) >= 0).length > DEPARTMENT_LIMIT;
  });
  if (crowded) throw new Error('Please choose at most two ' + crowded + ' positions. Pick your third from another department.');
  if (result.eligibility !== 'confirmed') throw new Error('Please confirm you are a Canadian citizen or permanent resident.');
  if (result.application_year !== '2027' || result.consent_version !== '2027-text-v2' || result.consent !== 'agreed') throw new Error('Please agree to the privacy policy and application terms.');
  return result;
}

// An attachment is {name, data} with base64 PDF data, or absent. Returns null when absent.
function validateDocument_(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object' || typeof value.name !== 'string' || typeof value.data !== 'string') throw new Error('Please check your application details.');
  let bytes;
  try { bytes = Utilities.base64Decode(value.data); }
  catch (_) { throw new Error('Your ' + label.toLowerCase() + ' could not be read. Please choose the file again.'); }
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new Error('Your ' + label.toLowerCase() + ' is over 5 MB. Please choose a smaller PDF.');
  // Every PDF starts with %PDF-, whatever its file name says.
  if (bytes.length < 5 || String.fromCharCode.apply(null, bytes.slice(0, 5).map(b => b & 255)) !== '%PDF-') {
    throw new Error('Your ' + label.toLowerCase() + ' must be a PDF file.');
  }
  return bytes;
}

function saveDocuments_(data) {
  const links = {};
  DOCUMENT_FIELDS.forEach(key => { links[key] = ''; });
  if (!DOCUMENT_FIELDS.some(key => data[key])) return links;
  const id = PropertiesService.getScriptProperties().getProperty('DOCUMENT_FOLDER_ID');
  if (!id) throw new Error('Application storage is not ready. Please try again later.');
  const folder = DriveApp.getFolderById(id);
  DOCUMENT_FIELDS.forEach(key => {
    if (!data[key]) return;
    // Name files by applicant and reference so they sort together; the applicant's own file name isn't trusted.
    const name = (data.name.replace(/[^\w .'-]/g, '').slice(0, 60) || 'Applicant') + ' - ' + DOCUMENT_LABELS[key] + ' - ' + data.submission_id + '.pdf';
    links[key] = folder.createFile(Utilities.newBlob(data[key], 'application/pdf', name)).getUrl();
  });
  return links;
}

function validateDraft_(input) {
  const limits = {name: 150, email: 254, school: 250, program_year: 150, experience: 10000, why_join: 5000, role_1: 150, role_2: 150, role_3: 150, additional_roles: 500, website: 500};
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
