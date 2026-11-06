// /staff/application?id=…: one application's answers and files, its status and assignee (saved on change),
// team notes, history, and (for admins) delete.
import {api, h, formatDate, timeElement, loadMe, departmentOf} from './staff-common.js';

const $ = selector => document.querySelector(selector);
const id = new URLSearchParams(location.search).get('id') || '';
const statusSelect = $('[data-status]'), assigneeSelect = $('[data-assignee]'), saveStatus = $('[data-save-status]');
const noteForm = $('[data-note-form]'), noteStatus = $('[data-note-status]');
let info, team = [], current;

const showError = message => {
  $('[data-error]').textContent = message;
  $('[data-error]').hidden = !message;
};
// Back to the list keeps its filters when the list is where we came from.
if (document.referrer.startsWith(`${location.origin}/staff/`) && new URL(document.referrer).pathname === '/staff/') $('[data-back]').href = document.referrer;

const nameOf = email => team.find(person => person.email === email)?.name || email;
const activityText = row => ({
  submitted: 'Application submitted',
  status: `${nameOf(row.actor)} changed the status: ${row.detail}`,
  assigned: row.detail === 'Unassigned' ? `${nameOf(row.actor)} unassigned it` : `${nameOf(row.actor)} assigned it to ${nameOf(row.detail)}`,
  note: `${nameOf(row.actor)} added a note`
})[row.action] || `${nameOf(row.actor)}: ${row.action} ${row.detail}`;

function render({application: app, notes, activity}) {
  current = app;
  document.title = `${app.name} | Buzzflix staff`;
  $('[data-submitted]').textContent = `${app.year} application · Submitted ${formatDate(app.submitted_at)}`;
  $('[data-name]').textContent = app.name;
  $('[data-contact]').replaceChildren(h('a', {href: `mailto:${app.email}`}, app.email), ` · ${app.school} · ${app.program_year}`);
  $('[data-positions]').replaceChildren(...[app.role_1, app.role_2, app.role_3].map(role => {
    const department = departmentOf(role, info.departments);
    return h('li', {}, role, department && h('small', {}, department));
  }));
  $('[data-additional]').hidden = !app.additional_roles;
  $('[data-additional]').textContent = app.additional_roles ? `Also interested in: ${app.additional_roles}` : '';
  $('[data-experience]').textContent = app.experience;
  $('[data-why]').textContent = app.why_join;
  const files = [['resume', 'Resume', app.has_resume], ['portfolio', 'Portfolio', app.has_portfolio]].filter(([, , has]) => has);
  $('[data-files]').replaceChildren(...(files.length
    ? files.map(([part, label]) => h('li', {}, h('a', {class: 'staff-button-quiet', href: `/api/staff/applications/${app.id}/${part}`, target: '_blank', rel: 'noopener'},
      `Open ${label.toLowerCase()} (PDF)`, h('span', {class: 'visually-hidden'}, ', opens in a new tab'))))
    : [h('li', {class: 'staff-muted'}, 'No files were attached.')]));

  statusSelect.value = app.status;
  assigneeSelect.replaceChildren(h('option', {value: ''}, 'No one'),
    ...team.filter(person => !person.blocked || person.email === app.assigned_to)
      .map(person => h('option', {value: person.email}, person.email === info.me.email ? `${person.name} (me)` : person.name)));
  assigneeSelect.value = app.assigned_to || '';

  $('[data-notes]').replaceChildren(...(notes.length ? notes.map(note => h('li', {},
    h('div', {class: 'staff-note-meta'}, h('strong', {}, nameOf(note.author)), ' · ', timeElement(note.created_at)),
    h('p', {}, note.body))) : [h('li', {class: 'staff-muted'}, 'No notes yet.')]));
  $('[data-activity]').replaceChildren(...activity.map(row => h('li', {}, timeElement(row.created_at), activityText(row))));
  $('[data-loading]').hidden = true;
  $('[data-application]').hidden = false;
}

async function save(fields) {
  saveStatus.classList.remove('is-error');
  saveStatus.textContent = 'Saving…';
  statusSelect.disabled = assigneeSelect.disabled = true;
  try {
    render(await api(`/applications/${id}`, {method: 'PATCH', body: fields}));
    saveStatus.textContent = 'Saved.';
  } catch (failure) {
    statusSelect.value = current.status;
    assigneeSelect.value = current.assigned_to || '';
    saveStatus.classList.add('is-error');
    saveStatus.textContent = failure.message;
  } finally {
    statusSelect.disabled = assigneeSelect.disabled = false;
  }
}
statusSelect.addEventListener('change', () => save({status: statusSelect.value}));
assigneeSelect.addEventListener('change', () => save({assigned_to: assigneeSelect.value || null}));

noteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = noteForm.elements.body.value.trim();
  if (!body) return;
  const button = noteForm.querySelector('button');
  button.disabled = true;
  noteStatus.classList.remove('is-error');
  noteStatus.textContent = '';
  try {
    render(await api(`/applications/${id}/notes`, {method: 'POST', body: {body}}));
    noteForm.reset();
    noteStatus.textContent = 'Note added.';
  } catch (failure) {
    noteStatus.classList.add('is-error');
    noteStatus.textContent = failure.message;
  } finally {
    button.disabled = false;
  }
});

$('[data-delete]').addEventListener('click', async () => {
  if (!confirm(`Delete ${current.name}’s application, files and notes? This can’t be undone.`)) return;
  try {
    await api(`/applications/${id}`, {method: 'DELETE'});
    location.href = '/staff/';
  } catch (failure) {
    showError(failure.message);
  }
});

(async () => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('That application wasn’t found.');
    let details;
    [info, {team}, details] = await Promise.all([loadMe(), api('/team'), api(`/applications/${id}`)]);
    statusSelect.replaceChildren(...info.statuses.map(status => h('option', {value: status}, info.statusLabels[status])));
    $('[data-admin-only]').hidden = info.me.role !== 'admin';
    render(details);
  } catch (failure) {
    $('[data-loading]').hidden = true;
    showError(failure.message);
  }
})();
