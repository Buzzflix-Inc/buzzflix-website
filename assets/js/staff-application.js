// /staff/application?id=…: one application's answers and files, its status and assignee (saved on change),
// the interview scorecard (a pop-up when the interview is complete), emails to the applicant, team and
// interview notes, history, the admin's final decision, and (for admins) delete.
// Other people's changes appear without a reload, and dots show who else has it open.
import {api, h, formatDate, formatTime, timeElement, loadMe, departmentOf, watchChanges, viewerDots, showToast} from './staff-common.js';
import {assignPicker} from './staff-assign.js';

const $ = selector => document.querySelector(selector);
const id = new URLSearchParams(location.search).get('id') || '';
const statusSelect = $('[data-status]'), saveStatus = $('[data-save-status]');
let picker; // the Assigned to picker (staff-assign.js)
const noteForm = $('[data-note-form]'), noteStatus = $('[data-note-status]');
const scorecardDialog = $('[data-scorecard-dialog]'), scorecardForm = $('[data-scorecard-form]');
const emailDialog = $('[data-email-dialog]'), emailForm = $('[data-email-form]');
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
  note: row.detail === 'interview' ? `${nameOf(row.actor)} added interview notes` : `${nameOf(row.actor)} added a note`,
  scorecard: `${nameOf(row.actor)} completed the interview scorecard: ${row.detail === 'approve' ? 'recommend' : 'reject'}`,
  email: (([template, how]) => `${nameOf(row.actor)} ${how === 'sent' ? 'emailed the applicant' : 'wrote an email (saved, not sent)'}: ${info.emailTemplates[template]?.label || template}`)(row.detail.split(':'))
})[row.action] || `${nameOf(row.actor)}: ${row.action} ${row.detail}`;

// What the person can do next, under the status dropdown.
const statusHint = status => ({
  new: 'Assign it to someone below to start the review. It moves to In review on its own.',
  reviewing: 'Move it to Interview once an interview is set up. Unassigning it sends it back to New.',
  interview: 'When the interview is over, the person assigned clicks Interview complete to fill in the scorecard and recommend or reject.',
  approve: isAdmin() ? 'Waiting for your final decision above.' : 'Recommended for hiring. An admin makes the final decision.',
  decline: isAdmin() ? 'Waiting for your final decision above.' : 'Recommended not to hire. An admin makes the final decision.',
  hired: isAdmin() ? 'Final decision. Only admins can change it.' : 'Final decision by an admin.',
  not_hired: isAdmin() ? 'Final decision. Only admins can change it.' : 'Final decision by an admin.'
})[status] || '';

function render(details) {
  const {application: app, notes, activity, allowedStatuses, recommendedBy, scorecards, emails, allowedTemplates} = details;
  current = app;
  document.title = `${app.name} | Buzzflix staff`;
  $('[data-submitted]').textContent = `${app.year} application · Submitted ${formatDate(app.submitted_at)}`;
  $('[data-name]').textContent = app.name;
  $('[data-contact]').replaceChildren(h('a', {href: `mailto:${app.email}`}, app.email), ` · ${app.school} · ${app.program_year}`);
  // Ranked: the applicant's first, second and third choice.
  $('[data-positions]').replaceChildren(...[app.role_1, app.role_2, app.role_3].map((role, index) => {
    const department = departmentOf(role, info.departments);
    return h('li', {class: index === 0 ? 'is-first' : null},
      h('span', {class: 'staff-rank'}, ['1st choice', '2nd choice', '3rd choice'][index]),
      h('span', {class: 'staff-position-name'}, role),
      department && h('small', {}, department));
  }));
  $('[data-additional]').hidden = !app.additional_roles;
  $('[data-additional]').replaceChildren(...(app.additional_roles ? [h('strong', {}, 'Also interested in: '), app.additional_roles] : []));
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
  $('[data-complete]').hidden = !(app.status === 'interview' && (app.assigned_to === info.me.email || isAdmin()));
  // Past review, an application always needs someone, so it can be reassigned but not unassigned.
  picker?.close();
  picker = assignPicker({team, me: info.me, value: app.assigned_to, label: 'Assigned to',
    none: ['new', 'reviewing'].includes(app.status) || 'Past review it needs someone', onChoose: reassign});
  $('[data-assignee]').replaceChildren(picker.element);

  // The admin's final decision, once an interviewer has chosen Approve or Decline.
  const pending = ['approve', 'decline'].includes(app.status);
  $('[data-decision]').hidden = !(pending && isAdmin());
  if (pending) {
    const who = recommendedBy ? nameOf(recommendedBy) : 'The interviewer';
    const card = scorecards.at(-1);
    const average = card ? ` (average score ${averageOf(card.scores)} out of 5)` : '';
    $('[data-decision-text]').textContent = app.status === 'approve'
      ? `${who} recommends hiring ${app.name}${average}. Read the scorecard, then make the final decision.`
      : `${who} recommends not hiring ${app.name}${average}. Read the scorecard, then make the final decision.`;
  }

  // Interview notes are the default once an interview is under way.
  if (!noteForm.elements.body.value) noteForm.elements.kind.value = ['interview', 'approve', 'decline'].includes(app.status) ? 'interview' : 'note';
  const fresh = seenNotes ? new Set(notes.filter(note => !seenNotes.has(note.id)).map(note => note.id)) : new Set();
  seenNotes = new Set(notes.map(note => note.id));
  $('[data-notes]').replaceChildren(...(notes.length ? notes.map(note => h('li', {class: fresh.has(note.id) ? 'is-updated' : null},
    h('div', {class: 'staff-note-meta'}, h('strong', {}, nameOf(note.author)), ' · ', timeElement(note.created_at),
      note.kind === 'interview' && h('span', {class: 'staff-note-kind'}, 'Interview notes')),
    h('p', {}, note.body))) : [h('li', {class: 'staff-muted'}, 'No notes yet.')]));
  renderScorecards(scorecards);
  renderEmails(app, emails, allowedTemplates);
  $('[data-activity]').replaceChildren(...activity.map(row => h('li', {}, timeElement(row.created_at), activityText(row))));
  $('[data-loading]').hidden = true;
  $('[data-application]').hidden = false;
}

const averageOf = scores => {
  const values = Object.values(scores);
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
};

// Each completed scorecard: the ratings as small bars, the notes, and the recommendation.
function renderScorecards(scorecards) {
  $('[data-scorecards-card]').hidden = !scorecards.length;
  $('[data-scorecards]').replaceChildren(...scorecards.slice().reverse().map(card => h('article', {class: 'staff-scorecard'},
    h('div', {class: 'staff-note-meta'}, h('strong', {}, nameOf(card.author)), ' · ', timeElement(card.created_at), ' · ',
      h('span', {class: `staff-recommendation is-${card.recommendation}`}, card.recommendation === 'approve' ? 'Recommends hiring' : 'Recommends not hiring')),
    h('dl', {class: 'staff-scores'}, ...info.scorecard.flatMap(({key, label}) => [
      h('dt', {}, label),
      h('dd', {}, h('span', {class: 'staff-score-bar', 'aria-hidden': 'true'}, ...[1, 2, 3, 4, 5].map(n => h('span', {class: n <= card.scores[key] ? 'is-on' : null}))),
        `${card.scores[key]} / 5`)
    ]), h('dt', {}, 'Average'), h('dd', {}, h('strong', {}, `${averageOf(card.scores)} / 5`))),
    h('p', {}, card.notes))));
}

// Emails to the applicant: a button per template this person can send now, and everything sent so far.
function renderEmails(app, emails, allowedTemplates) {
  const off = !info.applicantEmails;
  $('[data-email-hint]').textContent = allowedTemplates.length
    ? `Pick an email to edit before sending.${off ? ' Email isn’t switched on yet, so emails are saved here but not sent.' : ''}`
    : app.status === 'new' ? 'Interview invitations can be sent once the application is assigned.'
    : ['approve', 'decline'].includes(app.status) ? 'The offer or “not this time” email can be sent after an admin’s final decision.'
    : ['hired', 'not_hired'].includes(app.status) ? 'Only admins send the offer or “not this time” email.' : '';
  $('[data-email-buttons]').replaceChildren(...allowedTemplates.map(key =>
    h('button', {type: 'button', class: 'staff-button-quiet', onclick: () => openEmail(key)}, info.emailTemplates[key].label)));
  $('[data-emails]').replaceChildren(...emails.map(email => h('li', {},
    h('details', {},
      h('summary', {}, h('strong', {}, info.emailTemplates[email.template]?.label || email.template), ` · ${nameOf(email.sender)} · ${formatTime(email.created_at)} · `,
        h('span', {class: email.sent ? 'staff-email-sent' : 'staff-email-saved'}, email.sent ? 'Sent' : 'Saved, not sent')),
      h('p', {class: 'staff-email-subject'}, `Subject: ${email.subject}`),
      h('p', {class: 'staff-email-body'}, email.body)))));
}

async function save(fields) {
  saveStatus.classList.remove('is-error');
  saveStatus.textContent = 'Saving…';
  saving = true;
  statusSelect.disabled = true;
  picker.setBusy(true);
  document.querySelectorAll('[data-decide]').forEach(button => { button.disabled = true; });
  try {
    render(await api(`/applications/${id}`, {method: 'PATCH', body: fields}));
    saveStatus.textContent = 'Saved.';
  } catch (failure) {
    statusSelect.value = current.status;
    picker.setValue(current.assigned_to);
    saveStatus.classList.add('is-error');
    saveStatus.textContent = failure.message;
    statusSelect.disabled = statusSelect.options.length === 1;
  } finally {
    saving = false;
    picker.setBusy(false);
    document.querySelectorAll('[data-decide]').forEach(button => { button.disabled = false; });
  }
}
statusSelect.addEventListener('change', () => save({status: statusSelect.value}));
// Choosing someone shows them at once, then saves; Undo puts the previous person back.
async function reassign(email, undoable = true) {
  const before = current.assigned_to;
  const name = who => who === info.me.email ? 'you' : team.find(person => person.email === who)?.name || who;
  picker.setValue(email);
  await save({assigned_to: email});
  if (current.assigned_to !== email) return; // save() showed the error and put the old name back
  saveStatus.textContent = '';
  showToast(email ? `Assigned to ${name(email)}.` : 'Unassigned.', {undo: undoable ? () => reassign(before, false) : null});
  $('[data-assignee] .staff-picker-button')?.focus();
}
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

// Closing buttons in both pop-ups.
document.querySelectorAll('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

// Interview complete → the scorecard pop-up. Every rating and the notes are required; Recommend or Reject
// saves it and moves the application to Approve or Decline (pending) for an admin's final decision.
$('[data-complete]').addEventListener('click', () => {
  $('[data-scorecard-for]').textContent = `Rate ${current.name} from 1 (poor) to 5 (excellent) on each, then recommend hiring or not. An admin makes the final decision.`;
  $('[data-scorecard-questions]').replaceChildren(...info.scorecard.map(({key, label}) => h('fieldset', {class: 'staff-rating'},
    h('legend', {}, label),
    h('div', {class: 'staff-rating-options'}, ...[1, 2, 3, 4, 5].map(n => h('label', {},
      h('input', {type: 'radio', name: key, value: String(n), required: true}), h('span', {}, String(n))))))));
  $('[data-scorecard-error]').textContent = '';
  scorecardDialog.showModal();
});
scorecardForm.addEventListener('submit', async event => {
  event.preventDefault();
  const recommendation = event.submitter?.value;
  if (!scorecardForm.reportValidity()) return;
  const scores = Object.fromEntries(info.scorecard.map(({key}) => [key, Number(scorecardForm.elements[key].value)]));
  const buttons = scorecardForm.querySelectorAll('[type=submit]');
  buttons.forEach(button => { button.disabled = true; });
  try {
    render(await api(`/applications/${id}/scorecard`, {method: 'POST', body: {scores, notes: scorecardForm.elements.notes.value, recommendation}}));
    scorecardForm.reset();
    scorecardDialog.close();
    saveStatus.classList.remove('is-error');
    saveStatus.textContent = recommendation === 'approve' ? 'Scorecard saved. Recommended for hiring.' : 'Scorecard saved. Recommended not to hire.';
  } catch (failure) {
    $('[data-scorecard-error]').textContent = failure.message;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});

// An email to the applicant: the template filled in with their name, positions and the sender's name.
let emailTemplate;
function openEmail(key) {
  emailTemplate = key;
  const template = info.emailTemplates[key];
  const roles = [current.role_1, current.role_2, current.role_3];
  const fill = text => text.replaceAll('{first_name}', current.name.split(/\s+/)[0]).replaceAll('{sender}', info.me.name)
    .replaceAll('{positions}', `${roles.slice(0, -1).join(', ')} or ${roles.at(-1)}`);
  $('[data-email-title]').textContent = template.label;
  $('[data-email-to]').textContent = `To ${current.name} <${current.email}>. Replies go to info@buzzflix.ca.`;
  $('[data-email-off]').hidden = info.applicantEmails;
  $('[data-email-send]').textContent = info.applicantEmails ? 'Send email' : 'Save to history';
  emailForm.elements.subject.value = fill(template.subject);
  emailForm.elements.body.value = fill(template.body);
  $('[data-email-error]').textContent = '';
  emailDialog.showModal();
}
emailForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!emailForm.reportValidity()) return;
  const button = $('[data-email-send]');
  button.disabled = true;
  try {
    render(await api(`/applications/${id}/emails`, {method: 'POST',
      body: {template: emailTemplate, subject: emailForm.elements.subject.value, body: emailForm.elements.body.value}}));
    emailDialog.close();
  } catch (failure) {
    $('[data-email-error]').textContent = failure.message;
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
  if (saving || scorecardDialog.open || emailDialog.open || document.activeElement === statusSelect || picker?.isOpen()) return;
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
    watchChanges(refresh, {viewing: id, onViewers: viewers =>
      $('[data-viewers]').replaceChildren(viewerDots(viewers[id], team, {long: true}) || '')});
  } catch (failure) {
    $('[data-loading]').hidden = true;
    showError(failure.message);
  }
})();
