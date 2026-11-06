import {applicationEndpoint} from './application-config.js';

const form = document.querySelector('[data-application-form]');
if (form) {
  const endpoint = applicationEndpoint.trim();
  const preview = !endpoint || form.hasAttribute('data-preview');
  const button = form.querySelector('[type=submit]');
  const error = form.querySelector('.application-error');
  const status = form.querySelector('.application-submit-status');
  const note = document.querySelector('#application-preview-note');
  const confirmation = document.querySelector('[data-application-confirmation]');
  const roles = [form.elements.role_1, form.elements.role_2, form.elements.role_3];
  const answerFields = ['name', 'email', 'school', 'program_year', 'experience', 'why_join', 'role_1', 'role_2', 'role_3', 'additional_roles'];
  // Optional PDF attachments. Code.gs saves them to Drive and checks the same limits.
  const documentFields = ['resume', 'portfolio'].filter(name => form.elements[name]);
  const maxDocumentBytes = 5 * 1024 * 1024;
  const draftSave = form.querySelector('[data-draft-save]');
  const draftButton = form.querySelector('[data-draft-send]');
  const draftStatus = form.querySelector('[data-draft-status]');
  const restored = document.querySelector('[data-draft-restored]');
  let sending = false;
  let submissionId;
  let lastAnswers;
  // Answers with data-word-limit get a live "12 / 100 words" counter in the box's bottom-right corner.
  // Code.gs checks the same limit (WORD_LIMITS).
  const countWords = text => text.trim().split(/\s+/).filter(Boolean).length;
  const wordLimited = [...form.querySelectorAll('textarea[data-word-limit]')].map(input => {
    const limit = Number(input.dataset.wordLimit);
    const box = document.createElement('div');
    box.className = 'application-word-box';
    input.before(box);
    box.append(input);
    const counter = document.createElement('span');
    counter.className = 'application-word-count';
    counter.id = `${input.id}-words`;
    box.append(counter);
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), counter.id].filter(Boolean).join(' '));
    return {input, limit, counter};
  });
  const updateWordCounts = () => wordLimited.forEach(({input, limit, counter}) => {
    const words = countWords(input.value);
    const over = words > limit;
    counter.textContent = `${words} / ${limit} words`;
    counter.classList.toggle('is-over', over);
    if (over) input.setCustomValidity(`Please keep this answer to ${limit} words or fewer (it’s ${words} now).`);
  });
  button.disabled = false;
  button.textContent = preview ? 'Preview submission' : 'Submit application';
  note.hidden = !preview;
  if (!preview) form.removeAttribute('aria-describedby');

  const validate = () => {
    const seen = new Set();
    roles.forEach(input => {
      const value = input.value.trim().toLowerCase();
      input.setCustomValidity(!value ? 'Please enter a role.' : seen.has(value) ? 'Please list three different roles.' : '');
      if (value) seen.add(value);
    });
    ['name', 'school', 'program_year', 'experience', 'why_join'].forEach(name => {
      const input = form.elements[name];
      if (input) input.setCustomValidity(input.value.trim() ? '' : 'Please complete this field.');
    });
    updateWordCounts();
    documentFields.forEach(name => {
      const input = form.elements[name];
      const file = input.files[0];
      input.setCustomValidity(!file ? ''
        : !/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf') ? 'Please choose a PDF file.'
        : file.size > maxDocumentBytes ? 'Please choose a PDF under 5 MB.'
        : file.size === 0 ? 'This file is empty. Please choose another PDF.' : '');
    });
  };
  form.addEventListener('input', validate);
  form.addEventListener('change', validate);
  // reset fires before the fields clear, so recount on the next tick.
  form.addEventListener('reset', () => setTimeout(updateWordCounts));
  updateWordCounts();
  // Files travel inside the JSON body as base64, because Apps Script can't take multipart uploads.
  const readDocument = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({name: file.name, data: reader.result.slice(reader.result.indexOf(',') + 1)});
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const showConfirmation = () => {
    form.hidden = true;
    confirmation.hidden = false;
    confirmation.querySelector('[data-confirmation-eyebrow]').textContent = preview ? 'Submission preview' : 'Buzzflix 2027';
    const heading = confirmation.querySelector('[data-confirmation-title]');
    heading.textContent = 'Your application is received.';
    confirmation.querySelector('[data-confirmation-message]').textContent = 'You should receive an email confirmation soon.';
    confirmation.querySelector('[data-confirmation-note]').textContent = preview
      ? 'Preview only. No application was sent and no confirmation email will be delivered.'
      : `Your application reference is ${submissionId}. Thank you for sharing your story with Buzzflix.`;
    confirmation.querySelector('[data-preview-reset]').hidden = !preview;
    heading.focus();
  };
  confirmation.querySelector('[data-preview-reset]').addEventListener('click', () => {
    confirmation.hidden = true;
    form.hidden = false;
    button.focus();
  });
  // Not every page has every field (apply.html has no additional_roles).
  const answers = () => {
    const data = {};
    for (const name of [...answerFields, 'website']) data[name] = (form.elements[name]?.value || '').trim();
    return data;
  };
  const getJSON = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, {credentials: 'omit', redirect: 'follow', signal: controller.signal, ...options});
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  };

  // Before applications open, applicants can email themselves a link that brings their answers back.
  if (draftSave && endpoint && form.hasAttribute('data-preview')) {
    draftSave.hidden = false;
    // Nothing can be submitted yet, so the save box takes the submit button's place.
    button.hidden = true;
    let saving = false;
    draftButton.addEventListener('click', async () => {
      if (saving) return;
      const email = form.elements.email;
      if (!email.value.trim()) email.setCustomValidity('Enter your email so we can send you the link.');
      if (!email.reportValidity()) { email.setCustomValidity(''); return; }
      saving = true;
      draftButton.disabled = true;
      draftStatus.textContent = 'Saving your answers…';
      try {
        // text/plain avoids the cross-origin preflight that Apps Script cannot handle.
        const result = await getJSON(endpoint, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({action: 'save_draft', ...answers()})});
        if (result.saved !== true) throw Object.assign(new Error('draft-failed'), {userMessage: result.message});
        draftStatus.textContent = `Sent! Check ${email.value.trim()} for your link. If it isn’t there in a few minutes, look in your spam folder.`;
      } catch (failure) {
        draftStatus.textContent = (typeof failure.userMessage === 'string' && failure.userMessage)
          || 'We couldn’t save your answers. Your entries are still here. Please try again.';
      } finally {
        saving = false;
        draftButton.disabled = false;
      }
    });
  }

  const draftId = location.hash.match(/^#draft=([0-9a-f]{32})$/)?.[1];
  if (draftId && endpoint) {
    history.replaceState(null, '', location.pathname + location.search + '#apply');
    restored.hidden = false;
    restored.textContent = 'Loading your saved answers…';
    form.closest('section').scrollIntoView();
    getJSON(`${endpoint}?draft=${draftId}`).then(result => {
      if (result.found !== true) throw new Error('draft-missing');
      answerFields.forEach(name => {
        if (form.elements[name] && typeof result.draft[name] === 'string') form.elements[name].value = result.draft[name];
      });
      // The position picker owns the role fields on apply.html, so it restores the picks itself.
      form.dispatchEvent(new CustomEvent('application:restore', {detail: {roles: [result.draft.role_1, result.draft.role_2, result.draft.role_3]}}));
      validate();
      restored.textContent = preview
        ? 'Your saved answers are filled in. You can keep editing them until applications open.'
        : 'Your saved answers are filled in. Check them over, agree to the terms and submit your application.';
    }).catch(() => {
      restored.textContent = 'We couldn’t find those saved answers. The link may be incomplete, so try opening it from your email again.';
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    validate();
    if (!form.reportValidity()) return;
    error.hidden = true;
    if (preview) { showConfirmation(); return; }
    sending = true;
    button.disabled = true;
    const data = answers();
    data.consent = form.elements.consent.checked ? 'agreed' : '';
    data.eligibility = form.elements.eligibility.checked ? 'confirmed' : '';
    data.application_year = '2027';
    data.consent_version = '2027-text-v2';
    const files = documentFields.filter(name => form.elements[name].files[0]);
    if (files.length) status.textContent = 'Preparing your files…';
    try {
      for (const name of files) data[name] = await readDocument(form.elements[name].files[0]);
    } catch {
      status.textContent = '';
      error.textContent = 'We couldn’t read one of your files. Please choose it again and resubmit.';
      error.hidden = false;
      sending = false;
      button.disabled = false;
      return;
    }
    const snapshot = JSON.stringify(data);
    // Keep the same ID for an unchanged retry; edited answers get a new ID.
    if (!submissionId || snapshot !== lastAnswers) submissionId = crypto.randomUUID();
    lastAnswers = snapshot;
    data.submission_id = submissionId;
    status.textContent = files.length
      ? 'Sending your application and files. This can take a minute, so please keep this page open.'
      : 'Sending your application. Please keep this page open.';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), files.length ? 180000 : 60000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', // text/plain avoids the cross-origin preflight that Apps Script cannot handle.
        // Keep normal CORS so we can read Google's saved/not-saved response.
        headers: {'Content-Type': 'text/plain;charset=utf-8'}, credentials: 'omit', redirect: 'follow',
        body: JSON.stringify(data), signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || result.accepted !== true) {
        const failure = new Error('submission-failed');
        failure.userMessage = typeof result.message === 'string' ? result.message : '';
        throw failure;
      }
      showConfirmation();
      form.reset();
      restored.hidden = true;
    } catch (failure) {
      error.textContent = failure.userMessage || (failure.name === 'AbortError'
        ? 'We couldn’t confirm your submission in time. Your entries are still here. Please try again.'
        : 'We couldn’t confirm your application was received. Your entries are still here. Please try again.');
      error.hidden = false;
    } finally {
      clearTimeout(timeout);
      sending = false;
      button.disabled = false;
      status.textContent = '';
    }
  });
}
