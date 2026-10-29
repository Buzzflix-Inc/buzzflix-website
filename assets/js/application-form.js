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
  let sending = false;
  let submissionId;
  let lastAnswers;
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
    ['name', 'school', 'experience'].forEach(name => {
      const input = form.elements[name];
      input.setCustomValidity(input.value.trim() ? '' : 'Please complete this field.');
    });
  };
  form.addEventListener('input', validate);
  const showConfirmation = () => {
    form.hidden = true;
    confirmation.hidden = false;
    confirmation.querySelector('[data-confirmation-eyebrow]').textContent = preview ? 'Submission preview' : 'Buzzflix 2027';
    const heading = confirmation.querySelector('[data-confirmation-title]');
    heading.textContent = preview ? 'Your confirmation will appear here.' : 'Your application is in.';
    confirmation.querySelector('[data-confirmation-message]').textContent = preview
      ? 'Once submissions are connected, this screen will confirm that your application was received.'
      : 'We’ve received your application. Expect to hear back from us within two weeks.';
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    validate();
    if (!form.reportValidity()) return;
    error.hidden = true;
    if (preview) { showConfirmation(); return; }
    const data = {};
    for (const name of ['name', 'email', 'school', 'experience', 'role_1', 'role_2', 'role_3', 'additional_roles', 'website']) {
      data[name] = form.elements[name].value.trim();
    }
    data.consent = form.elements.consent.checked ? 'agreed' : '';
    data.application_year = '2027';
    data.consent_version = '2027-text-v1';
    const answers = JSON.stringify(data);
    // Keep the same ID for an unchanged retry; edited answers get a new ID.
    if (!submissionId || answers !== lastAnswers) submissionId = crypto.randomUUID();
    lastAnswers = answers;
    data.submission_id = submissionId;
    sending = true;
    button.disabled = true;
    status.textContent = 'Sending your application. Please keep this page open.';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
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
