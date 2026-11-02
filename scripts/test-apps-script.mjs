import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const application = (changes = {}) => ({submission_id: '21c6c122-661e-4710-85db-5397543696c2', application_year: '2027', name: 'Test Applicant', email: 'test@example.com', school: 'Test School', experience: 'School films', role_1: 'Camera', role_2: 'Sound', role_3: 'Editing', additional_roles: '', consent: 'agreed', consent_version: '2027-text-v1', website: '', ...changes});
function harness() {
  const tabs = {}, properties = {}, cache = {}, mail = [];
  let releases = 0, locked = true, storageFails = false, uuids = 0;
  const makeSheet = rows => ({
    getLastRow: () => rows.length, setFrozenRows() {},
    getRange(start, column, count, width) {
      return {
        getValues: () => Array.from({length: count}, (_, index) => Array.from({length: width}, (_, cell) => rows[start + index - 1]?.[column + cell - 1] ?? '')),
        setValues(values) { if (storageFails) throw new Error('Storage failed'); values.forEach((row, index) => { rows[start + index - 1] = Array.from(row); }); }
      };
    }
  });
  const insertSheet = name => { tabs[name] = []; return makeSheet(tabs[name]); };
  insertSheet('Submission Records');
  const rows = tabs['Submission Records'];
  const spreadsheet = {getId: () => 'test-sheet', getSheetByName: name => tabs[name] && makeSheet(tabs[name]), insertSheet};
  const context = vm.createContext({
    SpreadsheetApp: {getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {}},
    PropertiesService: {getScriptProperties: () => ({setProperty: (key, value) => properties[key] = value, getProperty: key => properties[key]})},
    LockService: {getScriptLock: () => ({tryLock: () => locked, releaseLock() { releases++; }})},
    CacheService: {getScriptCache: () => ({get: key => cache[key], put: (key, value) => cache[key] = value})},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})},
    MailApp: {sendEmail: message => mail.push(message)},
    Utilities: {getUuid: () => `0000000${++uuids}-aaaa-4bbb-8ccc-dddddddddddd`.slice(-36)}
  });
  vm.runInContext(source, context);
  return {rows, tabs, mail, properties, setup: () => context.setupApplications(), submit: value => context.doPost({postData: {contents: JSON.stringify(value), length: JSON.stringify(value).length}}), get: (parameter = {}) => context.doGet({parameter}), releases: () => releases, failStorage: () => storageFails = true, denyLock: () => locked = false};
}
test('setup saves the bound sheet ID, initializes headings and accepts a row', () => {
  const h = harness(); h.setup();
  assert.equal(h.properties.SPREADSHEET_ID, 'test-sheet');
  assert.equal(h.get().ready, true);
  const result = h.submit(application());
  assert.equal(result.accepted, true);
  assert.equal(h.rows[1][2], 'Test Applicant');
  assert.equal(h.rows[1][11], 'Received');
  assert.equal(result.confirmationEmailQueued, false);
  assert.equal(h.releases(), 1);
});
test('unchanged retries do not duplicate; changing answers with the same ID is rejected', () => {
  const h = harness(); h.setup();
  assert.equal(h.submit(application()).duplicate, false);
  assert.equal(h.submit(application()).duplicate, true);
  assert.equal(h.rows.length, 2);
  assert.equal(h.submit(application({school: 'Changed School'})).accepted, false);
  assert.equal(h.releases(), 3);
});
test('validation rejects invalid email, duplicate roles, missing consent, spam and oversized answers', () => {
  const h = harness(); h.setup();
  for (const changes of [{email: 'bad'}, {role_2: ' CAMERA '}, {consent: ''}, {website: 'spam'}, {experience: 'x'.repeat(10001)}]) {
    assert.equal(h.submit(application(changes)).accepted, false);
  }
  assert.equal(h.rows.length, 1);
});
test('formula-like answers are stored as text and remain safe on retry', () => {
  const h = harness(); h.setup();
  const data = application({experience: '=SUM(A1:A3)'});
  assert.equal(h.submit(data).accepted, true);
  assert.equal(h.rows[1][5], "'=SUM(A1:A3)");
  assert.equal(h.submit(data).duplicate, true);
});
test('failed storage and unavailable lock do not return success', () => {
  const storage = harness(); storage.setup(); storage.failStorage();
  assert.equal(storage.submit(application()).accepted, false);
  assert.equal(storage.releases(), 1);
  const locked = harness(); locked.setup(); locked.denyLock();
  assert.equal(locked.submit(application()).accepted, false);
  assert.equal(locked.releases(), 0);
});
test('wrong headings block submissions without overwriting existing sheet data', () => {
  const h = harness(); h.setup(); h.rows[0][0] = 'Wrong Heading';
  assert.equal(h.submit(application()).accepted, false);
  assert.equal(h.rows.length, 1);
});
const draft = (changes = {}) => ({action: 'save_draft', name: 'Test Applicant', email: 'test@example.com', school: '', experience: 'School films', role_1: 'Camera', role_2: '', role_3: '', additional_roles: '', website: '', ...changes});
test('a saved draft is stored, emailed as a link and loads back from that link', () => {
  const h = harness(); h.setup();
  assert.deepEqual(h.tabs['Saved Drafts'][0], ['Draft ID', 'Saved At', 'Email', 'Answers']);
  assert.equal(h.submit(draft()).saved, true);
  assert.equal(h.rows.length, 1);
  assert.equal(h.mail.length, 1);
  assert.equal(h.mail[0].to, 'test@example.com');
  const id = h.mail[0].body.match(/#draft=([0-9a-f]{32})/)[1];
  assert.ok(!h.mail[0].body.includes('School films') && !h.mail[0].htmlBody.includes('Test Applicant'));
  const loaded = h.get({draft: id});
  assert.equal(loaded.found, true);
  assert.equal(loaded.draft.experience, 'School films');
  assert.equal(loaded.draft.role_1, 'Camera');
  assert.equal(h.get({draft: 'f'.repeat(32)}).found, false);
  assert.equal(h.get({draft: '../x'}).found, false);
  assert.equal(h.releases(), 1);
});
test('drafts need a valid email, reject spam and limit repeat saves per address', () => {
  const h = harness(); h.setup();
  assert.equal(h.submit(draft({email: 'bad'})).saved, undefined);
  assert.equal(h.submit(draft({website: 'spam'})).accepted, false);
  for (let i = 0; i < 3; i++) assert.equal(h.submit(draft()).saved, true);
  const limited = h.submit(draft({email: 'TEST@example.com'}));
  assert.equal(limited.accepted, false);
  assert.match(limited.message, /^You've saved several times/);
  assert.equal(h.mail.length, 3);
});
test('drafts are refused until setup has made the Saved Drafts tab', () => {
  const h = harness(); h.properties.SPREADSHEET_ID = 'test-sheet';
  const result = h.submit(draft());
  assert.equal(result.accepted, false);
  assert.match(result.message, /^Saving isn't available/);
  assert.equal(h.mail.length, 0);
});
