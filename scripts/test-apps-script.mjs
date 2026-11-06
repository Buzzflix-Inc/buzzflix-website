import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const application = (changes = {}) => ({submission_id: '21c6c122-661e-4710-85db-5397543696c2', application_year: '2027', name: 'Test Applicant', email: 'test@example.com', school: 'Test School', program_year: 'Grade 11', experience: 'School films', why_join: 'I love movies', role_1: 'Camera', role_2: 'Sound', role_3: 'Editing', additional_roles: '', consent: 'agreed', consent_version: '2027-text-v1', website: '', ...changes});
function harness() {
  const tabs = {}, properties = {}, cache = {}, mail = [], folders = {};
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
    DriveApp: {
      createFolder: name => { const id = `folder-${Object.keys(folders).length + 1}`; folders[id] = {name, files: []}; return {getId: () => id}; },
      getFolderById: id => {
        if (!folders[id]) throw new Error('No folder');
        return {createFile: blob => { folders[id].files.push(blob); return {getUrl: () => `https://drive.example/${encodeURIComponent(blob.name)}`}; }};
      }
    },
    Utilities: {
      getUuid: () => `0000000${++uuids}-aaaa-4bbb-8ccc-dddddddddddd`.slice(-36),
      // Like Apps Script: signed bytes as a plain array, and an error for text that isn't base64.
      base64Decode: text => { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid'); return Array.from(Buffer.from(text, 'base64'), b => b > 127 ? b - 256 : b); },
      newBlob: (bytes, type, name) => ({bytes, type, name})
    }
  });
  vm.runInContext(source, context);
  return {rows, tabs, mail, properties, folders, setup: () => context.setupApplications(), submit: value => context.doPost({postData: {contents: JSON.stringify(value), length: JSON.stringify(value).length}}), get: (parameter = {}) => context.doGet({parameter}), releases: () => releases, failStorage: () => storageFails = true, denyLock: () => locked = false};
}
test('setup saves the bound sheet ID, initializes headings and accepts a row', () => {
  const h = harness(); h.setup();
  assert.equal(h.properties.SPREADSHEET_ID, 'test-sheet');
  assert.equal(h.get().ready, true);
  const result = h.submit(application());
  assert.equal(result.accepted, true);
  assert.equal(h.rows[1][2], 'Test Applicant');
  assert.equal(h.rows[1][5], 'Grade 11');
  assert.equal(h.rows[1][7], 'I love movies');
  assert.equal(h.rows[1][15], 'Received');
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
  for (const changes of [{email: 'bad'}, {program_year: ' '}, {why_join: ''}, {role_2: ' CAMERA '}, {consent: ''}, {website: 'spam'}, {experience: 'x'.repeat(10001)}]) {
    assert.equal(h.submit(application(changes)).accepted, false);
  }
  assert.equal(h.rows.length, 1);
});
test('written answers are limited to 100 words', () => {
  const h = harness(); h.setup();
  const words = n => Array(n).fill('word').join(' \n ');
  assert.equal(h.submit(application({experience: words(101)})).accepted, false);
  assert.match(h.submit(application({why_join: words(101)})).message, /100 words/);
  assert.equal(h.submit(application({experience: words(100), why_join: words(100)})).accepted, true);
  assert.equal(h.rows.length, 2);
});
test('at most two positions from one department are accepted', () => {
  const h = harness(); h.setup();
  const crowded = h.submit(application({role_1: 'Gaffer', role_2: 'Key Grip', role_3: 'grip'}));
  assert.equal(crowded.accepted, false);
  assert.match(crowded.message, /^Please choose at most two Grip & Electric positions/);
  assert.equal(h.submit(application({role_1: 'Gaffer', role_2: 'Key Grip', role_3: 'Editor'})).accepted, true);
  // Free-text roles from the homepage form aren't in the position list, so they aren't counted.
  assert.equal(h.submit(application({submission_id: '31c6c122-661e-4710-85db-5397543696c2', role_1: 'Lighting', role_2: 'Gaffer', role_3: 'Grip'})).accepted, true);
  assert.equal(h.rows.length, 3);
});
const pdf = (text = '%PDF-1.7 test') => ({name: 'resume.pdf', data: Buffer.from(text).toString('base64')});
test('PDF resume and portfolio are saved to the Drive folder and linked in the sheet', () => {
  const h = harness(); h.setup();
  const folder = h.folders[h.properties.DOCUMENT_FOLDER_ID];
  assert.equal(folder.name, 'Buzzflix 2027 Application Documents');
  const data = application({resume: pdf(), portfolio: pdf('%PDF-1.4 portfolio')});
  assert.equal(h.submit(data).accepted, true);
  assert.equal(folder.files.length, 2);
  assert.equal(folder.files[0].type, 'application/pdf');
  assert.match(folder.files[0].name, /^Test Applicant - Resume - 21c6c122/);
  assert.match(h.rows[1][12], /^https:\/\/drive\.example\/Test%20Applicant%20-%20Resume/);
  assert.match(h.rows[1][13], /Portfolio/);
  // A retry doesn't save the files twice.
  assert.equal(h.submit(data).duplicate, true);
  assert.equal(folder.files.length, 2);
  // No attachments leaves the columns empty.
  assert.equal(h.submit(application({submission_id: '31c6c122-661e-4710-85db-5397543696c2'})).accepted, true);
  assert.equal(h.rows[2][12], '');
});
test('attachments must be real PDFs under 5 MB', () => {
  const h = harness(); h.setup();
  const cases = [
    [{resume: pdf('GIF89a not a pdf')}, /^Your resume must be a PDF/],
    [{portfolio: {name: 'x.pdf', data: 'not base64!'}}, /^Your portfolio could not be read/],
    [{resume: pdf('%PDF-' + 'x'.repeat(5 * 1024 * 1024))}, /^Your resume is over 5 MB/],
    [{resume: 'a string'}, /^Please check your application details/]
  ];
  for (const [changes, message] of cases) {
    const result = h.submit(application(changes));
    assert.equal(result.accepted, false);
    assert.match(result.message, message);
  }
  assert.equal(h.rows.length, 1);
  assert.equal(h.folders[h.properties.DOCUMENT_FOLDER_ID].files.length, 0);
});
test('setup brings an empty tab up to the new headings but leaves one with applications alone', () => {
  const h = harness(); h.rows.push(['Submission ID', 'Submitted At', 'Name']);
  h.setup();
  assert.equal(h.rows[0][5], 'Program & Year');
  const old = harness(); old.rows.push(['Submission ID', 'Submitted At', 'Name'], ['x']);
  assert.throws(() => old.setup(), /headings need setup/);
});
test('formula-like answers are stored as text and remain safe on retry', () => {
  const h = harness(); h.setup();
  const data = application({experience: '=SUM(A1:A3)'});
  assert.equal(h.submit(data).accepted, true);
  assert.equal(h.rows[1][6], "'=SUM(A1:A3)");
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
const draft = (changes = {}) => ({action: 'save_draft', name: 'Test Applicant', email: 'test@example.com', school: '', program_year: 'Grade 12', why_join: 'Fun', experience: 'School films', role_1: 'Camera', role_2: '', role_3: '', additional_roles: '', website: '', ...changes});
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
  assert.equal(loaded.draft.program_year, 'Grade 12');
  assert.equal(loaded.draft.why_join, 'Fun');
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
