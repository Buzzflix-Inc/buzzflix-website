// /staff/team: everyone who can sign in (your own profile is /staff/profile). Admins can add people as Staff or Admin,
// make someone an admin, and block or unblock them.
import {api, h, avatar, formatDate, loadMe, watchChanges} from './staff-common.js';

const $ = selector => document.querySelector(selector);
const list = $('[data-team]'), addForm = $('[data-add-form]');
let info, team = [];

const showError = message => {
  $('[data-error]').textContent = message;
  $('[data-error]').hidden = !message;
};
const say = (element, message, isError = false) => {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
};

async function change(email, fields) {
  showError('');
  try {
    await api(`/team/${encodeURIComponent(email)}`, {method: 'PATCH', body: fields});
    await refresh();
  } catch (failure) {
    showError(failure.message);
    render();
  }
}

function render() {
  const isAdmin = info.me.role === 'admin';
  list.replaceChildren(...team.map(person => {
    const self = person.email === info.me.email;
    const actions = isAdmin && !self && h('div', {class: 'staff-person-actions'},
      h('label', {class: 'visually-hidden', for: `role-${person.email}`}, `Role for ${person.name}`),
      h('select', {id: `role-${person.email}`, onchange: event => change(person.email, {role: event.target.value})},
        h('option', {value: 'member', selected: person.role === 'member'}, 'Staff'),
        h('option', {value: 'admin', selected: person.role === 'admin'}, 'Admin')),
      h('button', {type: 'button', class: `staff-button-quiet${person.blocked ? '' : ' staff-button-danger'}`, onclick: () => {
        if (!person.blocked && !confirm(`Block ${person.name}? They’ll be signed out, can’t sign in again, and their applications will be unassigned.`)) return;
        change(person.email, {blocked: !person.blocked});
      }}, person.blocked ? 'Unblock' : 'Block'));
    return h('li', {},
      avatar(person.name, person.email, person.colour),
      h('div', {class: 'staff-person'},
        h('span', {class: 'staff-person-name'}, person.name),
        person.role === 'admin' && h('span', {class: 'staff-person-tag'}, 'Admin'),
        person.blocked && h('span', {class: 'staff-person-tag is-blocked'}, 'Blocked'),
        self && h('span', {class: 'staff-person-tag'}, 'You'),
        (person.title || person.department) && h('small', {class: 'staff-person-role'}, [person.title, person.department].filter(Boolean).join(' · ')),
        h('small', {}, person.email),
        h('small', {}, person.last_seen_at ? `Last signed in ${formatDate(person.last_seen_at)}` : 'Hasn’t signed in yet')),
      actions);
  }));
}

async function refresh() {
  ({team} = await api('/team'));
  render();
}

addForm.addEventListener('submit', async event => {
  event.preventDefault();
  const status = $('[data-add-status]');
  try {
    const {person} = await api('/team', {method: 'POST', body: {email: addForm.elements.email.value, name: addForm.elements.name.value,
      role: addForm.elements.role.value}});
    addForm.reset();
    say(status, `${person.name} was added as ${person.role === 'admin' ? 'an admin' : 'staff'}.`);
    await refresh();
  } catch (failure) {
    say(status, failure.message, true);
  }
});

(async () => {
  try {
    info = await loadMe();
    $('[data-admin-only]').hidden = info.me.role !== 'admin';
    await refresh();
    // Other admins' changes appear without a reload (not while a role dropdown is open).
    watchChanges(() => list.contains(document.activeElement) ? null : refresh());
  } catch (failure) {
    showError(failure.message);
  }
})();
