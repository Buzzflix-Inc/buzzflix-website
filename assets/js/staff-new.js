// /staff/new: type in an application that came in another way (email, paper). Saves through
// POST /api/staff/applications (worker/apply.js addApplicationByStaff), then opens the new application.
import {api, h, loadMe} from './staff-common.js';

const form = document.querySelector('[data-new-form]');
const status = form.querySelector('[data-status]');
const button = form.querySelector('[type=submit]');
const MAX_BYTES = 5 * 1024 * 1024;
const say = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
};

// A chosen PDF as {name, data} with base64 data, the shape worker/apply.js expects.
const readPdf = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({name: file.name, data: String(reader.result).split(',')[1] || ''});
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

(async () => {
  const [info, {team}] = await Promise.all([loadMe(), api('/team')]);
  form.querySelector('[data-positions]').replaceChildren(...Object.values(info.departments).flat().map(position => h('option', {value: position})));
  form.querySelector('[data-assignee]').append(...team.filter(person => !person.blocked)
    .map(person => h('option', {value: person.email}, person.email === info.me.email ? `${person.name} (me)` : person.name)));
})().catch(failure => say(failure.message, true));

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const roles = ['role_1', 'role_2', 'role_3'].map(name => form.elements[name].value.trim().toLowerCase());
  if (new Set(roles).size !== 3) {
    form.elements.role_3.setCustomValidity('List three different positions.');
    form.elements.role_3.reportValidity();
    form.elements.role_3.setCustomValidity('');
    return;
  }
  const body = {};
  for (const name of ['name', 'email', 'school', 'program_year', 'role_1', 'role_2', 'role_3', 'additional_roles', 'experience', 'why_join', 'assigned_to']) {
    body[name] = form.elements[name].value.trim();
  }
  button.disabled = true;
  try {
    for (const name of ['resume', 'portfolio']) {
      const file = form.elements[name].files[0];
      if (!file) continue;
      if (file.size > MAX_BYTES) throw new Error(`The ${name} is over 5 MB. Choose a smaller PDF.`);
      say('Reading the files…');
      body[name] = await readPdf(file);
    }
    say('Saving…');
    const {id} = await api('/applications', {method: 'POST', body});
    location.href = `/staff/application?id=${id}`;
  } catch (failure) {
    say(failure.message, true);
    button.disabled = false;
  }
});
