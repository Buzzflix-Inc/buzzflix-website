// /staff/: the year's applications. Tabs: Assigned to me (the default), All (with a bar showing how many are
// at each step), and one per status; plus search, department and assignee filters. Each row's "Assigned to"
// is a dropdown that saves straight away (assigning a New one moves it to In review). Other people's changes
// appear without a reload. The filters live in the address (?status=all&q=…) so Back and shared links keep them.
import {api, h, formatDate, timeElement, statusPill, loadMe, departmentOf, watchChanges} from './staff-common.js';

const $ = selector => document.querySelector(selector);
const yearSelect = $('[data-year]'), search = $('[data-search]'), departmentSelect = $('[data-department]'), assignedSelect = $('[data-assigned]');
const tabs = $('[data-status-tabs]'), rows = $('[data-rows]'), count = $('[data-count]'), errorBox = $('[data-error]');
const params = new URLSearchParams(location.search);
// status: 'mine', 'all' or one of the statuses.
const filters = {status: params.get('status') || 'mine', q: params.get('q') || '', dept: params.get('dept') || '', assigned: params.get('assigned') || ''};
let data, info, applications = [];
let seen = new Map(); // id → updated_at, to highlight rows someone else changed
let changed = new Set(), waiting = false;

const showError = message => {
  errorBox.textContent = message;
  errorBox.hidden = !message;
};

const saveFilters = () => {
  const next = new URLSearchParams();
  if (data.years.length && data.year !== data.years[0]) next.set('year', data.year);
  for (const [key, value] of Object.entries(filters)) if (value && !(key === 'status' && value === 'mine')) next.set(key, value);
  const query = next.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
};

const roles = row => [row.role_1, row.role_2, row.role_3, ...String(row.additional_roles || '').split(',')].map(role => role.trim()).filter(Boolean);
const inTab = (row, tab) => tab === 'all' || (tab === 'mine' ? row.assigned_to === info.me.email : row.status === tab);
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

// Assigning from the list: saves at once, and puts the old choice back if it fails.
async function assign(row, select) {
  showError('');
  select.disabled = true;
  try {
    const result = await api(`/applications/${row.id}`, {method: 'PATCH', body: {assigned_to: select.value || null}});
    const {assigned_to, status, updated_at} = result.application;
    Object.assign(row, {assigned_to, status, updated_at});
    seen.set(row.id, row.updated_at);
    render();
  } catch (failure) {
    select.value = row.assigned_to || '';
    showError(failure.message);
  } finally {
    select.disabled = false;
  }
}

function assigneeSelect(row) {
  const people = data.team.filter(person => !person.blocked || person.email === row.assigned_to);
  const select = h('select', {'aria-label': `Assign ${row.name}’s application`, onchange: () => assign(row, select)},
    // Past review, an application always needs someone.
    h('option', {value: '', disabled: !['new', 'reviewing'].includes(row.status)}, 'No one'),
    ...people.map(person => h('option', {value: person.email}, person.email === info.me.email ? `${person.name} (me)` : person.name)));
  select.value = row.assigned_to || '';
  return select;
}

function render() {
  // Don't rebuild the rows under someone who is choosing from a row's dropdown; catch up when they leave it.
  if (rows.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') {
    waiting = true;
    return;
  }
  waiting = false;
  saveFilters();
  // Tabs count what the other filters leave, so the numbers match what a click shows.
  const visible = applications.filter(row => matches(row, {skipStatus: true}));
  const tabList = [['mine', 'Assigned to me'], ['all', 'All'], ...info.statuses.map(status => [status, info.statusLabels[status]])];
  tabs.replaceChildren(...tabList.map(([tab, label]) =>
    h('button', {type: 'button', 'aria-pressed': String(filters.status === tab), onclick: () => { filters.status = tab; render(); }},
      label, h('span', {}, String(visible.filter(row => inTab(row, tab)).length)))));
  progress(visible);

  const shown = visible.filter(row => inTab(row, filters.status));
  rows.replaceChildren(...shown.map(row => h('tr', {class: changed.has(row.id) ? 'is-updated' : null},
    h('td', {}, h('a', {href: `/staff/application?id=${row.id}`}, row.name), h('small', {}, row.email)),
    h('td', {}, h('ul', {class: 'staff-roles'}, [row.role_1, row.role_2, row.role_3].map(role => h('li', {}, role)))),
    h('td', {}, row.school, h('small', {}, row.program_year)),
    h('td', {'data-label': 'Submitted'}, timeElement(row.submitted_at, formatDate)),
    h('td', {}, statusPill(row.status, info.statusLabels)),
    h('td', {'data-label': 'Assigned to'}, assigneeSelect(row))
  )));
  changed = new Set();
  const total = applications.length;
  count.textContent = total === 0 ? `No applications for ${data.year} yet.`
    : shown.length === total ? `${total} application${total === 1 ? '' : 's'} for ${data.year}`
    : `Showing ${shown.length} of ${total} applications for ${data.year}`;
  $('[data-table-wrap]').hidden = shown.length === 0;
  $('[data-empty]').hidden = shown.length > 0 || total === 0;
  $('[data-empty]').textContent = filters.status === 'mine' && visible.length === applications.length
    ? 'Nothing is assigned to you. Pick one from All and assign it to yourself.' : 'No applications match these filters.';
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
rows.addEventListener('focusout', () => setTimeout(() => { if (waiting) render(); }));

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
    info = me;
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
  render();
}

yearSelect.addEventListener('change', () => load(yearSelect.value));
search.addEventListener('input', () => { filters.q = search.value; render(); });
departmentSelect.addEventListener('change', () => { filters.dept = departmentSelect.value; render(); });
assignedSelect.addEventListener('change', () => { filters.assigned = assignedSelect.value; render(); });
load(params.get('year')).then(() => watchChanges(refresh));
