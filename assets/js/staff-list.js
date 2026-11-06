// /staff/: the year's applications. Tabs: Assigned to me (the default), Needs your decision (admins), All (with a
// bar showing how many are at each step), and one per status; plus search, department and assignee filters.
// Each row's "Assigned to" opens a searchable team list with workloads; the change shows at once, with Undo.
// Tick rows to assign or move several at once. Other people's changes appear without a reload, and initial
// dots show who has an application open. The filters live in the address (?status=all&q=…).
import {api, h, formatDate, timeElement, statusPill, loadMe, departmentOf, watchChanges, viewerDots, showToast} from './staff-common.js';
import {assignPicker, pickerOpen} from './staff-assign.js';

const $ = selector => document.querySelector(selector);
const yearSelect = $('[data-year]'), search = $('[data-search]'), departmentSelect = $('[data-department]'), assignedSelect = $('[data-assigned]');
const views = $('[data-views]'), steps = $('[data-steps]'), rows = $('[data-rows]'), count = $('[data-count]'), errorBox = $('[data-error]');
const params = new URLSearchParams(location.search);
// status: a view ('mine', 'decision' for admins, 'all'), or a step ('awaiting' for members, or one of the statuses).
// Without ?status, the profile's default view is used once it has loaded.
const filters = {status: params.get('status') || 'mine', q: params.get('q') || '', dept: params.get('dept') || '', assigned: params.get('assigned') || ''};
let data, info, applications = [];
let seen = new Map(); // id → updated_at, to highlight rows someone else changed
let changed = new Set(), justAssigned = new Set(), waiting = false, viewers = {};
const selected = new Set(); // ticked application ids

// The view chosen on the profile page (Needs your decision only for admins), else Assigned to me.
const defaultView = () => {
  const view = info?.me.default_view;
  return view === 'all' || (view === 'decision' && info.me.role === 'admin') ? view : 'mine';
};

const showError = message => {
  errorBox.textContent = message;
  errorBox.hidden = !message;
};

const saveFilters = () => {
  const next = new URLSearchParams();
  if (data.years.length && data.year !== data.years[0]) next.set('year', data.year);
  for (const [key, value] of Object.entries(filters)) if (value && !(key === 'status' && value === defaultView())) next.set(key, value);
  const query = next.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
};

const roles = row => [row.role_1, row.role_2, row.role_3, ...String(row.additional_roles || '').split(',')].map(role => role.trim()).filter(Boolean);
const inTab = (row, tab) => tab === 'all' || (tab === 'mine' ? row.assigned_to === info.me.email
  : ['decision', 'awaiting'].includes(tab) ? ['approve', 'decline'].includes(row.status) : row.status === tab);
const matches = (row, {skipStatus = false} = {}) => {
  if (!skipStatus && !inTab(row, filters.status)) return false;
  if (filters.assigned === 'me' && row.assigned_to !== info.me.email) return false;
  if (filters.assigned === 'none' && row.assigned_to) return false;
  if (filters.assigned && !['me', 'none'].includes(filters.assigned) && row.assigned_to !== filters.assigned) return false;
  if (filters.dept && !roles(row).some(role => departmentOf(role, info.departments) === filters.dept)) return false;
  const query = filters.q.trim().toLowerCase();
  if (query && ![row.name, row.email, row.school, row.program_year, ...roles(row)].some(text => String(text).toLowerCase().includes(query))) return false;
  return true;
};

// Clicking anywhere on a row (or a card on a phone) opens the application, except on its own controls.
// Keyboard users have the name link; Ctrl/Cmd-click opens it in a new tab like a link would.
function openRow(event) {
  if (event.target.closest('a, button, input, select, label, summary, .staff-picker') || getSelection().toString()) return;
  const link = event.currentTarget.querySelector('td:nth-child(2) a');
  if (event.metaKey || event.ctrlKey) open(link.href, '_blank');
  else location.href = link.href;
}

// Assigning from the list happens on screen at once (a New application moves to In review straight away, and
// the workload counts follow), then saves. Undo puts the old assignee back; if the save fails, so does the page.
const isOpenWork = status => !['hired', 'not_hired'].includes(status);
function shiftLoad(email, by) {
  const person = data.team.find(teammate => teammate.email === email);
  if (person) person.active = Math.max(0, (person.active || 0) + by);
}
function applyAssignee(row, email) {
  if (isOpenWork(row.status)) { shiftLoad(row.assigned_to, -1); shiftLoad(email, 1); }
  row.assigned_to = email;
  if (email && row.status === 'new') row.status = 'reviewing';
  if (!email && row.status === 'reviewing') row.status = 'new';
}
async function assign(row, email, {undoable = true} = {}) {
  showError('');
  const before = {assigned_to: row.assigned_to, status: row.status, updated_at: row.updated_at};
  applyAssignee(row, email);
  justAssigned.add(row.id);
  render();
  try {
    const result = await api(`/applications/${row.id}`, {method: 'PATCH', body: {assigned_to: email}});
    const {assigned_to, status, updated_at} = result.application;
    Object.assign(row, {assigned_to, status, updated_at});
    seen.set(row.id, row.updated_at);
    render();
    justAssigned.delete(row.id);
    const who = email === info.me.email ? 'you' : email ? nameOf(email) : null;
    const moved = before.status === 'new' && status === 'reviewing' ? ' It’s now In review.' : before.status === 'reviewing' && status === 'new' ? ' It’s back to New.' : '';
    showToast(`${who ? `Assigned ${row.name} to ${who}.` : `Unassigned ${row.name}.`}${moved}`,
      {undo: undoable ? () => assign(row, before.assigned_to, {undoable: false}) : null});
  } catch (failure) {
    applyAssignee(row, before.assigned_to);
    Object.assign(row, before);
    justAssigned.delete(row.id);
    render();
    showToast(`Couldn’t assign ${row.name}: ${failure.message}`, {error: true});
  }
}
const nameOf = email => data.team.find(person => person.email === email)?.name || email;

function rowPicker(row) {
  // Past review, an application always needs someone, so it can be reassigned but not unassigned.
  return assignPicker({team: data.team, me: info.me, value: row.assigned_to, label: `Assign ${row.name}’s application`,
    none: ['new', 'reviewing'].includes(row.status) || 'Past review it needs someone',
    onChoose: email => assign(row, email)}).element;
}

function render() {
  // Don't rebuild the rows under someone who is choosing from a row's picker; catch up when they close it.
  if (pickerOpen() && rows.contains(document.activeElement)) {
    waiting = true;
    return;
  }
  waiting = false;
  saveFilters();
  // Tabs count what the other filters leave, so the numbers match what a click shows.
  const visible = applications.filter(row => matches(row, {skipStatus: true}));
  const isAdmin = info.me.role === 'admin';
  const button = ([tab, label, extra = null]) => {
    const n = visible.filter(row => inTab(row, tab)).length;
    return h('button', {type: 'button', class: extra, 'aria-pressed': String(filters.status === tab), onclick: () => { filters.status = tab; render(); }},
      h('span', {class: 'staff-tab-label'}, label), h('span', {class: `staff-tab-count${tab === 'decision' && n ? ' is-alert' : ''}`}, String(n)));
  };
  // Main views. Admins' decision queue holds everything an interviewer has recommended, waiting for Hired or Not hired.
  views.replaceChildren(...[['mine', 'Assigned to me'], ...(isAdmin ? [['decision', 'Needs your decision', 'is-decision']] : []),
    ['all', 'All applications']].map(button));
  // Steps. Approve and Decline (pending) share one "Awaiting decision" step for members; admins have the view above.
  steps.replaceChildren(...['new', 'reviewing', 'interview', ...(isAdmin ? [] : ['awaiting']), 'hired', 'not_hired']
    .map(step => button([step, step === 'awaiting' ? 'Awaiting decision' : info.statusLabels[step]])));
  progress(visible);
  crew();

  const shown = visible.filter(row => inTab(row, filters.status));
  // Redrawing replaces each row's picker; keep keyboard focus on the one that had it.
  const focused = document.activeElement?.classList.contains('staff-picker-button') && rows.contains(document.activeElement)
    ? document.activeElement.closest('tr').dataset.id : null;
  rows.replaceChildren(...shown.map(row => h('tr', {class: changed.has(row.id) ? 'is-updated' : null, 'data-id': row.id, onclick: openRow},
    h('td', {class: 'staff-check'}, h('input', {type: 'checkbox', 'aria-label': `Select ${row.name}`, checked: selected.has(row.id),
      onchange: event => { event.target.checked ? selected.add(row.id) : selected.delete(row.id); updateBulk(shown); }})),
    h('td', {}, h('a', {href: `/staff/application?id=${row.id}`}, row.name), h('span', {'data-dots': ''}, viewerDots(viewers[row.id], data.team)),
      h('small', {}, row.email)),
    h('td', {}, h('ol', {class: 'staff-roles'}, [row.role_1, row.role_2, row.role_3].map((role, index) =>
      h('li', {}, h('span', {class: 'staff-rank-number', 'aria-hidden': 'true'}, String(index + 1)), role)))),
    h('td', {}, row.school, h('small', {}, row.program_year)),
    h('td', {'data-label': 'Submitted'}, timeElement(row.submitted_at, formatDate)),
    h('td', {}, statusPill(row.status, info.statusLabels)),
    h('td', {'data-label': 'Assigned to', class: justAssigned.has(row.id) ? 'is-just-assigned' : null}, rowPicker(row))
  )));
  if (focused) rows.querySelector(`tr[data-id="${focused}"] .staff-picker-button`)?.focus();
  changed = new Set();
  const total = applications.length;
  count.textContent = total === 0 ? `No applications for ${data.year} yet.`
    : shown.length === total ? `${total} application${total === 1 ? '' : 's'} for ${data.year}`
    : `Showing ${shown.length} of ${total} applications for ${data.year}`;
  $('[data-table-wrap]').hidden = shown.length === 0;
  $('[data-empty]').hidden = shown.length > 0 || total === 0;
  $('[data-empty]').textContent = filters.status === 'mine' && visible.length === applications.length
    ? 'Nothing is assigned to you. Pick one from All and assign it to yourself.'
    : filters.status === 'decision' && visible.length === applications.length ? 'Nothing is waiting for a decision.'
    : 'No applications match these filters.';
  updateBulk(shown);
}

// Bulk actions. Only ticked rows that are still shown count, so a filter change can't act on hidden rows.
function updateBulk(shown) {
  const ids = shown.filter(row => selected.has(row.id)).map(row => row.id);
  const all = $('[data-select-all]');
  all.checked = ids.length > 0 && ids.length === shown.length;
  all.indeterminate = ids.length > 0 && ids.length < shown.length;
  $('[data-bulk]').hidden = ids.length === 0;
  $('[data-bulk-count]').textContent = `${ids.length} selected`;
  return ids;
}
const shownRows = () => applications.filter(row => matches(row));
$('[data-select-all]').addEventListener('change', event => {
  for (const row of shownRows()) event.target.checked ? selected.add(row.id) : selected.delete(row.id);
  render();
});
$('[data-bulk-clear]').addEventListener('click', () => {
  selected.clear();
  $('[data-bulk-result]').textContent = '';
  render();
});
let bulkPicker;
function fillBulk() {
  const isAdmin = info.me.role === 'admin';
  if (!bulkPicker) {
    bulkPicker = assignPicker({team: data.team, me: info.me, label: 'Assign the selected applications to', placeholder: 'Choose…', alwaysNone: true,
      onChoose: email => bulk({assigned_to: email}, email ? `Assign to ${email === info.me.email ? 'me' : nameOf(email)}` : 'Unassign')});
    $('[data-bulk-assign]').replaceWith(bulkPicker.element);
  } else bulkPicker.setTeam(data.team);
  $('[data-bulk-status]').replaceChildren(h('option', {value: ''}, 'Choose…'),
    ...['reviewing', 'interview', ...(isAdmin ? ['hired', 'not_hired'] : [])].map(status => h('option', {value: status}, info.statusLabels[status])));
}
async function bulk(fields, label) {
  const ids = updateBulk(shownRows());
  if (!ids.length || !confirm(`${label} for ${ids.length} application${ids.length === 1 ? '' : 's'}?`)) return;
  const result = $('[data-bulk-result]');
  result.textContent = 'Saving…';
  clearTimeout(bulk.timer);
  try {
    const {updated, skipped} = await api('/applications/bulk', {method: 'POST', body: {ids, ...fields}});
    result.textContent = `Updated ${updated}.` + (skipped.length
      ? ` Skipped ${skipped.length}: ${skipped.slice(0, 3).map(row => `${row.name} (${row.reason.replace(/\.$/, '')})`).join('; ')}${skipped.length > 3 ? '; …' : ''}.` : '');
    selected.clear();
    await refresh();
    if (!skipped.length) bulk.timer = setTimeout(() => { result.textContent = ''; }, 8000);
  } catch (failure) {
    result.textContent = failure.message;
  }
}
$('[data-bulk-status]').addEventListener('change', event => {
  const value = event.target.value;
  event.target.value = '';
  if (value) bulk({status: value}, `Move to ${info.statusLabels[value]}`);
});

// Who has which application open: refresh the dots in place, without redrawing the rows.
function showViewers(next) {
  viewers = next;
  for (const slot of rows.querySelectorAll('[data-dots]')) slot.replaceChildren(viewerDots(viewers[slot.closest('tr').dataset.id], data.team) || '');
}

// Hired step: how full each department is, counting every hire this year under their first choice's
// department (the apply page's departments; a first choice typed in by staff that isn't on the list is "Other").
function crew() {
  const box = $('[data-crew]');
  box.hidden = filters.status !== 'hired';
  if (box.hidden) return;
  const hires = applications.filter(row => row.status === 'hired');
  const groups = new Map(Object.keys(info.departments).map(name => [name, []]));
  for (const row of hires) {
    const name = departmentOf(row.role_1, info.departments) || 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  const targets = info.crewTargets || {};
  const goal = Object.values(targets).reduce((sum, n) => sum + n, 0);
  $('[data-crew-total]').textContent = goal ? `${hires.length} of ${goal} hired` : `${hires.length} hired`;
  $('[data-crew-list]').replaceChildren(...[...groups].map(([name, people]) => {
    const target = targets[name] || 0;
    const n = people.length;
    const state = !target ? '' : n > target ? 'is-over' : n === target ? 'is-full' : n === 0 ? 'is-empty' : '';
    const note = !target ? '' : n > target ? `Over by ${n - target}` : n === target ? 'Full' : `${target - n} to go`;
    const fill = h('span', {class: 'staff-crew-fill'});
    fill.style.width = `${target ? Math.min(100, Math.round(n / target * 100)) : n ? 100 : 0}%`;
    return h('li', {class: `staff-crew-dept ${state}`.trim()},
      h('div', {class: 'staff-crew-row'},
        h('strong', {}, name),
        h('span', {class: 'staff-crew-count'}, target ? `${n} of ${target}` : String(n)),
        note && h('span', {class: 'staff-crew-note'}, note)),
      h('div', {class: 'staff-crew-bar', role: 'img', 'aria-label': `${name}: ${n} hired${target ? ` of ${target}` : ''}`}, fill),
      people.length ? h('ul', {class: 'staff-crew-people'}, people.map(row =>
        h('li', {}, h('a', {href: `/staff/application?id=${row.id}`}, row.name), h('span', {}, row.role_1))))
        : h('p', {class: 'staff-crew-none'}, 'No one yet'));
  }));
}

// All tab: a thin bar split by how many applications are at each step, with a key underneath.
function progress(visible) {
  const box = $('[data-progress]');
  box.hidden = filters.status !== 'all' || visible.length === 0;
  if (box.hidden) return;
  const counts = info.statuses.map(status => [status, visible.filter(row => row.status === status).length]).filter(([, n]) => n);
  const bar = $('[data-progress-bar]');
  bar.setAttribute('aria-label', `${visible.length} applications: ${counts.map(([status, n]) => `${n} ${info.statusLabels[status]}`).join(', ')}`);
  bar.replaceChildren(...counts.map(([status, n]) => {
    const part = h('span', {class: `staff-progress-${status}`, title: `${info.statusLabels[status]}: ${n}`});
    part.style.flexGrow = n;
    return part;
  }));
  $('[data-progress-legend]').replaceChildren(...counts.map(([status, n]) =>
    h('li', {}, h('span', {class: `staff-progress-dot staff-progress-${status}`}), `${info.statusLabels[status]} `, h('strong', {}, String(n)))));
}
rows.addEventListener('picker:close', () => setTimeout(() => { if (waiting) render(); }));

// New data for the list. Rows that are new or changed since last time get highlighted (not on first load).
function take(next) {
  if (data && next.year === data.year) {
    changed = new Set(next.applications.filter(row => seen.get(row.id) !== row.updated_at).map(row => row.id));
  }
  data = next;
  applications = next.applications;
  seen = new Map(applications.map(row => [row.id, row.updated_at]));
}

async function load(year) {
  try {
    const [me, next] = await Promise.all([loadMe(), api(`/applications${year ? `?year=${encodeURIComponent(year)}` : ''}`)]);
    const first = !info;
    info = me;
    if (first && !params.has('status')) filters.status = defaultView();
    data = null;
    take(next);
  } catch (failure) {
    count.textContent = '';
    showError(failure.message);
    return;
  }
  const years = data.years.includes(data.year) ? data.years : [data.year, ...data.years];
  yearSelect.replaceChildren(...years.map(value => h('option', {value, selected: value === data.year}, value)));
  $('[data-export]').href = `/api/staff/export.csv?year=${encodeURIComponent(data.year)}`;
  departmentSelect.replaceChildren(h('option', {value: ''}, 'All departments'),
    ...Object.keys(info.departments).map(name => h('option', {value: name, selected: name === filters.dept}, name)));
  fillAssignedFilter();
  fillBulk();
  search.value = filters.q;
  render();
}

function fillAssignedFilter() {
  assignedSelect.replaceChildren(h('option', {value: ''}, 'Anyone'), h('option', {value: 'me'}, 'Me'), h('option', {value: 'none'}, 'No one'),
    ...data.team.filter(person => !person.blocked && person.email !== info.me.email).map(person => h('option', {value: person.email}, person.name)));
  assignedSelect.value = filters.assigned;
}

// Someone saved a change somewhere: fetch this year's list again and redraw.
async function refresh() {
  if (!data) return;
  take(await api(`/applications?year=${encodeURIComponent(data.year)}`));
  if (document.activeElement !== assignedSelect) fillAssignedFilter();
  if (!$('[data-bulk]').contains(document.activeElement)) fillBulk();
  render();
}

yearSelect.addEventListener('change', () => load(yearSelect.value));
search.addEventListener('input', () => { filters.q = search.value; render(); });
departmentSelect.addEventListener('change', () => { filters.dept = departmentSelect.value; render(); });
assignedSelect.addEventListener('change', () => { filters.assigned = assignedSelect.value; render(); });
load(params.get('year')).then(() => watchChanges(refresh, {onViewers: showViewers}));
