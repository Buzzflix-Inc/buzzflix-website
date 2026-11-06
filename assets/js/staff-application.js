// /staff/application?id=…: one application's answers and files, its status and assignee (saved on change),
// team and interview notes, history, the admin's final decision, and (for admins) delete.
// Other people's changes appear without a reload.
import {api, h, formatDate, timeElement, loadMe, departmentOf, watchChanges} from './staff-common.js';

const $ = selector => document.querySelector(selector);
const id = new URLSearchParams(location.search).get('id') || '';
const statusSelect = $('[data-status]'), assigneeSelect = $('[data-assignee]'), saveStatus = $('[data-save-status]');
const noteForm = $('[data-note-form]'), noteStatus = $('[data-note-status]');
let info, team = [], current, saving = false, seenNotes = null;

const showError = message => {
  $('[data-error]').textContent = message;
  $('[data-error]').hidden = !message;
};
// Back to the list keeps its filters when the list is where we came from.
if (document.referrer.startsWith(`${location.origin}/staff/`) && new URL(document.referrer).pathname === '/staff/') $('[data-back]').href = document.referrer;

const isAdmin = () => info.me.role === 'admin';
const nameOf = email => team.find(person => person.email === email)?.name || email;
const activityText = row => ({
  submitted: 'Application submitted',
  added: `${nameOf(row.actor)} added this application`,
  status: `${nameOf(row.actor)} changed the status: ${row.detail}`,
  assigned: row.detail === 'Unassigned' ? `${nameOf(row.actor)} unassigned it` : `${nameOf(row.actor)} assigned it to ${nameOf(row.detail)}`,
  note: row.detail === 'interview' ? `${nameOf(row.actor)} added interview notes` : `${nameOf(row.actor)} added a note`
})[row.action] || `${nameOf(row.actor)}: ${row.action} ${row.detail}`;

// What the person can do next, under the status dropdown.
const statusHint = status => ({
  new: 'Assign it to someone below to start the review. It moves to In review on its own.',
  reviewing: 'Move it to Interview once an interview is set up. Unassigning it sends it back to New.',
  interview: 'After the interview, add your interview notes and choose Approve or Decline. An admin makes the final decision.',
  approve: isAdmin() ? 'Waiting for your final decision above.' : 'Recommended for hiring. An admin makes the final decision.',
  decline: isAdmin() ? 'Waiting for your final decision above.' : 'Recommended not to hire. An admin makes the final decision.',
  hired: isAdmin() ? 'Final decision. Only admins can change it.' : 'Final decision by an admin.',
  not_hired: isAdmin() ? 'Final decision. Only admins can change it.' : 'Final decision by an admin.'
})[status] || '';

function render({application: app, notes, activity, allowedStatuses, recommendedBy}) {
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
  // Applications added by staff may have no written answers.
  $('[data-experience]').textContent = app.experience || 'Not given.';
  $('[data-why]').textContent = app.why_join || 'Not given.';
  const files = [['resume', 'Resume', app.has_resume], ['portfolio', 'Portfolio', app.has_portfolio]].filter(([, , has]) => has);
  $('[data-files]').replaceChildren(...(files.length
    ? files.map(([part, label]) => h('li', {}, h('a', {class: 'staff-button-quiet', href: `/api/staff/applications/${app.id}/${part}`, target: '_blank', rel: 'noopener'},
      `Open ${label.toLowerCase()} (PDF)`, h('span', {class: 'visually-hidden'}, ', opens in a new tab'))))
    : [h('li', {class: 'staff-muted'}, 'No files were attached.')]));

  // Only the moves this person is allowed to make (worker/staff.js allowedStatuses).
  statusSelect.replaceChildren(...allowedStatuses.map(status => h('option', {value: status}, info.statusLabels[status])));
  statusSelect.value = app.status;
  statusSelect.disabled = allowedStatuses.length === 1;
  $('[data-status-hint]').textContent = statusHint(app.status);
  // Past review, an application always needs someone, so it can be reassigned but not unassigned.
  assigneeSelect.replaceChildren(h('option', {value: '', disabled: !['new', 'reviewing'].includes(app.status)}, 'No one'),
    ...team.filter(person => !person.blocked || person.email === app.assigned_to)
      .map(person => h('option', {value: person.email}, person.email === info.me.email ? `${person.name} (me)` : person.name)));
  assigneeSelect.value = app.assigned_to || '';

  // The admin's final decision, once an interviewer has chosen Approve or Decline.
  const pending = ['approve', 'decline'].includes(app.status);
  $('[data-decision]').hidden = !(pending && isAdmin());
  if (pending) {
    const who = recommendedBy ? nameOf(recommendedBy) : 'The interviewer';
    $('[data-decision-text]').textContent = app.status === 'approve'
      ? `${who} recommends hiring ${app.name}. Read the interview notes, then make the final decision.`
      : `${who} recommends not hiring ${app.name}. Read the interview notes, then make the final decision.`;
  }

  // Interview notes are the default once an interview is under way.
  if (!noteForm.elements.body.value) noteForm.elements.kind.value = ['interview', 'approve', 'decline'].includes(app.status) ? 'interview' : 'note';
  const fresh = seenNotes ? new Set(notes.filter(note => !seenNotes.has(note.id)).map(note => note.id)) : new Set();
  seenNotes = new Set(notes.map(note => note.id));
  $('[data-notes]').replaceChildren(...(notes.length ? notes.map(note => h('li', {class: fresh.has(note.id) ? 'is-updated' : null},
    h('div', {class: 'staff-note-meta'}, h('strong', {}, nameOf(note.author)), ' · ', timeElement(note.created_at),
      note.kind === 'interview' && h('span', {class: 'staff-note-kind'}, 'Interview notes')),
    h('p', {}, note.body))) : [h('li', {class: 'staff-muted'}, 'No notes yet.')]));
  $('[data-activity]').replaceChildren(...activity.map(row => h('li', {}, timeElement(row.created_at), activityText(row))));
  $('[data-loading]').hidden = true;
  $('[data-application]').hidden = false;
}

async function save(fields) {
  saveStatus.classList.remove('is-error');
  saveStatus.textContent = 'Saving…';
  saving = true;
  statusSelect.disabled = assigneeSelect.disabled = true;
  document.querySelectorAll('[data-decide]').forEach(button => { button.disabled = true; });
  try {
    render(await api(`/applications/${id}`, {method: 'PATCH', body: fields}));
    saveStatus.textContent = 'Saved.';
  } catch (failure) {
    statusSelect.value = current.status;
    assigneeSelect.value = current.assigned_to || '';
    saveStatus.classList.add('is-error');
    saveStatus.textContent = failure.message;
    statusSelect.disabled = statusSelect.options.length === 1;
  } finally {
    saving = false;
    assigneeSelect.disabled = false;
    document.querySelectorAll('[data-decide]').forEach(button => { button.disabled = false; });
  }
}
statusSelect.addEventListener('change', () => save({status: statusSelect.value}));
assigneeSelect.addEventListener('change', () => save({assigned_to: assigneeSelect.value || null}));
document.querySelectorAll('[data-decide]').forEach(button => button.addEventListener('click', () => {
  const hire = button.dataset.decide === 'hired';
  if (confirm(hire ? `Hire ${current.name}?` : `Mark ${current.name} as not hired?`)) save({status: button.dataset.decide});
}));

noteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = noteForm.elements.body.value.trim();
  if (!body) return;
  const button = noteForm.querySelector('button');
  button.disabled = true;
  noteStatus.classList.remove('is-error');
  noteStatus.textContent = '';
  try {
    const result = await api(`/applications/${id}/notes`, {method: 'POST', body: {body, kind: noteForm.elements.kind.value}});
    seenNotes = new Set(result.notes.map(note => note.id)); // your own note isn't highlighted
    noteForm.elements.body.value = '';
    render(result);
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

// Someone saved a change: load this application again (and the team, for new names).
async function refresh() {
  if (saving || document.activeElement === statusSelect || document.activeElement === assigneeSelect) return;
  try {
    const [{team: people}, details] = await Promise.all([api('/team'), api(`/applications/${id}`)]);
    team = people;
    render(details);
  } catch (failure) {
    if (/wasn’t found/.test(failure.message)) {
      $('[data-application]').hidden = true;
      showError('Someone deleted this application.');
    }
  }
}

(async () => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('That application wasn’t found.');
    let details;
    [info, {team}, details] = await Promise.all([loadMe(), api('/team'), api(`/applications/${id}`)]);
    $('[data-admin-only]').hidden = !isAdmin();
    render(details);
    watchChanges(refresh);
  } catch (failure) {
    $('[data-loading]').hidden = true;
    showError(failure.message);
  }
})();
