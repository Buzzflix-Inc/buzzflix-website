// /login: email a 6-digit code (worker/staff.js), then sign in with it and go to the staff page asked for.
const emailForm = document.querySelector('[data-email-step]');
const codeForm = document.querySelector('[data-code-step]');
const emailInput = emailForm.elements.email;
const codeInput = codeForm.elements.code;
const errorBox = document.querySelector('[data-error]');
const codeStatus = document.querySelector('[data-code-status]');
// Only go back to a staff page, never to another site.
const requested = new URLSearchParams(location.search).get('next') || '';
const next = /^\/staff(\/|$|\?)/.test(requested) ? requested : '/staff/';
let busy = false;

const post = async (path, body) => {
  const response = await fetch(`/api/staff/${path}`, {method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
};
const showError = message => {
  errorBox.textContent = message;
  errorBox.hidden = !message;
};
const email = () => emailInput.value.trim().toLowerCase();

// Already signed in: skip the form.
fetch('/api/staff/me', {credentials: 'same-origin'}).then(response => { if (response.ok) location.replace(next); }).catch(() => {});

async function sendCode() {
  if (busy) return;
  if (!/^[^\s@]+@buzzflix\.ca$/.test(email())) {
    showError('Use your @buzzflix.ca email address.');
    emailInput.focus();
    return false;
  }
  busy = true;
  showError('');
  try {
    const result = await post('code', {email: email()});
    // TEMPORARY: the server's DEV_LOGIN_EMAIL signs straight in without a code (worker/staff.js).
    if (result.signedIn) {
      location.replace(next);
      return false;
    }
    return true;
  } catch (failure) {
    showError(failure.message);
    return false;
  } finally {
    busy = false;
  }
}

emailForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = emailForm.querySelector('button');
  button.disabled = true;
  if (await sendCode()) {
    emailForm.hidden = true;
    codeForm.hidden = false;
    document.querySelector('[data-code-sent]').textContent = `We sent a code to ${email()}. It works for 10 minutes. If it isn’t there, check your spam folder.`;
    codeInput.value = '';
    codeStatus.textContent = '';
    codeInput.focus();
  }
  button.disabled = false;
});

codeForm.addEventListener('submit', async event => {
  event.preventDefault();
  const code = codeInput.value.replace(/\D/g, '');
  if (code.length !== 6) {
    showError('Enter the 6-digit code from the email.');
    codeInput.focus();
    return;
  }
  if (busy) return;
  busy = true;
  showError('');
  const button = codeForm.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await post('verify', {email: email(), code});
    location.replace(next);
  } catch (failure) {
    showError(failure.message);
    codeInput.select();
    button.disabled = false;
  } finally {
    busy = false;
  }
});

// Paste or autofill of a whole code signs straight in.
codeInput.addEventListener('input', () => {
  if (/^\d{6}$/.test(codeInput.value.trim())) codeForm.requestSubmit();
});

document.querySelector('[data-resend]').addEventListener('click', async () => {
  codeStatus.textContent = 'Sending…';
  codeStatus.textContent = await sendCode() ? `A new code is on its way to ${email()}. Use the newest one.` : '';
  codeInput.focus();
});
document.querySelector('[data-change-email]').addEventListener('click', () => {
  codeForm.hidden = true;
  emailForm.hidden = false;
  showError('');
  emailInput.focus();
});
