// /staff/profile (the link under your name in the header): your name, role, department and colour,
// the view the applications list opens on, your account details, the welcome tour, and signing out everywhere.
import {api, h, avatar, formatDate, loadMe, showMe, showToast, AVATAR_COLOURS} from './staff-common.js';

const $ = selector => document.querySelector(selector);
const form = $('[data-profile-form]'), status = $('[data-profile-status]'), preview = $('[data-preview]'), viewSelect = $('[data-view]');
let info, me;
// Names for AVATAR_COLOURS, in the same order, after Automatic.
const COLOUR_NAMES = ['Automatic', 'Brown', 'Blue', 'Green', 'Purple', 'Rose', 'Teal', 'Slate', 'Rust'];

const showError = message => {
  $('[data-error]').textContent = message;
  $('[data-error]').hidden = !message;
};
const say = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
};

// The card at the top shows the profile as it will look, as it's typed.
const chosenColour = () => form.querySelector('[name=colour]:checked')?.value || '';
function drawPreview() {
  const name = form.elements.name.value.trim() || me.name;
  const detail = [form.elements.title.value.trim(), form.elements.department.value].filter(Boolean).join(' · ');
  preview.replaceChildren(avatar(name, me.email, chosenColour()),
    h('span', {}, h('strong', {}, name), h('small', {}, detail || me.email)));
}

function fill() {
  form.elements.name.value = me.name;
  form.elements.title.value = me.title;
  form.elements.department.value = me.department;
  // Automatic is the colour picked from their email; the rest are the shared palette.
  $('[data-colours]').replaceChildren(...['', ...AVATAR_COLOURS].map((colour, index) => {
    const label = COLOUR_NAMES[index];
    const swatch = h('span', {class: 'staff-swatch', 'aria-hidden': 'true'});
    swatch.style.backgroundColor = colour || 'transparent';
    return h('label', {class: colour ? 'staff-colour' : 'staff-colour is-auto', title: label},
      h('input', {type: 'radio', name: 'colour', value: colour, checked: colour === me.colour, onchange: drawPreview}),
      swatch, h('span', {class: colour ? 'visually-hidden' : null}, label));
  }));
  drawPreview();
  const facts = [
    ['Email', me.email],
    ['Permissions', me.role === 'admin' ? 'Admin: manages the team and makes the final hiring decisions' : 'Staff: reviews, interviews and recommends'],
    ['Joined', me.created_at ? formatDate(me.created_at) : '—'],
    ['Last signed in', me.last_seen_at ? formatDate(me.last_seen_at) : '—']
  ];
  $('[data-account]').replaceChildren(...facts.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)]));
}

form.addEventListener('input', drawPreview);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.elements.name.value.trim()) {
    say('Enter your name.', true);
    form.elements.name.focus();
    return;
  }
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  say('Saving…');
  try {
    const {person} = await api(`/team/${encodeURIComponent(me.email)}`, {method: 'PATCH', body: {
      name: form.elements.name.value, title: form.elements.title.value,
      department: form.elements.department.value, colour: chosenColour()}});
    Object.assign(me, person);
    showMe(me);
    say('');
    showToast('Profile saved.');
  } catch (failure) {
    say(failure.message, true);
  } finally {
    button.disabled = false;
  }
});

// Saved straight away; /staff/ opens on this view unless the address asks for another.
viewSelect.addEventListener('change', async () => {
  const before = me.default_view;
  try {
    const {person} = await api(`/team/${encodeURIComponent(me.email)}`, {method: 'PATCH', body: {default_view: viewSelect.value}});
    me.default_view = person.default_view;
    showToast(`Applications will open on ${viewSelect.selectedOptions[0].textContent}.`);
  } catch (failure) {
    viewSelect.value = before || 'mine';
    showToast(failure.message, {error: true});
  }
});

$('[data-tour]').addEventListener('click', async () => {
  const {startTour} = await import('./staff-welcome.js');
  startTour(info, {onProfile: () => fill()});
});

$('[data-everywhere]').addEventListener('click', async () => {
  if (!confirm('Sign out on every device, including this one?')) return;
  try {
    await api('/logout-everywhere', {method: 'POST', body: {}});
    location.href = '/login';
  } catch (failure) {
    showToast(failure.message, {error: true});
  }
});

(async () => {
  try {
    info = await loadMe();
    me = info.me;
    form.elements.department.append(...info.staffDepartments.map(name => h('option', {value: name}, name)));
    viewSelect.replaceChildren(...[['mine', 'Assigned to me'], ...(me.role === 'admin' ? [['decision', 'Needs your decision']] : []), ['all', 'All applications']]
      .map(([value, label]) => h('option', {value}, label)));
    viewSelect.value = me.default_view || 'mine';
    fill();
  } catch (failure) {
    showError(failure.message);
  }
})();
