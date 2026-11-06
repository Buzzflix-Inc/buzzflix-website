// /staff/: every application for a year, filtered by status, search, department and assignee.
// The filters live in the address (?status=new&q=…) so Back and shared links keep them.
import {api, h, formatDate, timeElement, statusPill, loadMe, departmentOf} from './staff-common.js';

const $ = selector => document.querySelector(selector);
const yearSelect = $('[data-year]'), search = $('[data-search]'), departmentSelect = $('[data-department]'), assignedSelect = $('[data-assigned]');
const tabs = $('[data-status-tabs]'), rows = $('[data-rows]'), count = $('[data-count]');
const params = new URLSearchParams(location.search);
const filters = {status: params.get('status') || '', q: params.get('q') || '', dept: params.get('dept') || '', assigned: params.get('assigned') || ''};
let data, info, applications = [];

const saveFilters = () => {
  const next = new URLSearchParams();
  if (data.years.length && data.year !== data.years[0]) next.set('year', data.year);
  for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value);
  const query = next.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
};

const roles = row => [row.role_1, row.role_2, row.role_3, ...String(row.additional_roles || '').split(',')].map(role => role.trim()).filter(Boolean);
const matches = (row, {skipStatus = false} = {}) => {
  if (!skipStatus && filters.status && row.status !== filters.status) return false;
  if (filters.assigned === 'me' && row.assigned_to !== info.me.email) return false;
  if (filters.assigned === 'none' && row.assigned_to) return false;
  if (filters.assigned && !['me', 'none'].includes(filters.assigned) && row.assigned_to !== filters.assigned) return false;
  if (filters.dept && !roles(row).some(role => departmentOf(role, info.departments) === filters.dept)) return false;
  const query = filters.q.trim().toLowerCase();
  if (query && ![row.name, row.email, row.school, row.program_year, ...roles(row)].some(text => String(text).toLowerCase().includes(query))) return false;
  return true;
};

function render() {
  saveFilters();
  // Status buttons count what the other filters leave, so the numbers match what a click shows.
  const visible = applications.filter(row => matches(row, {skipStatus: true}));
  tabs.replaceChildren(...[['', 'All'], ...info.statuses.map(status => [status, info.statusLabels[status]])].map(([status, label]) =>
    h('button', {type: 'button', 'aria-pressed': String(filters.status === status), onclick: () => { filters.status = status; render(); }},
      label, h('span', {}, String(status ? visible.filter(row => row.status === status).length : visible.length)))));

  const names = new Map(data.team.map(person => [person.email, person.name]));
  const shown = visible.filter(row => !filters.status || row.status === filters.status);
  rows.replaceChildren(...shown.map(row => h('tr', {},
    h('td', {}, h('a', {href: `/staff/application?id=${row.id}`}, row.name), h('small', {}, row.email)),
    h('td', {}, h('ul', {class: 'staff-roles'}, [row.role_1, row.role_2, row.role_3].map(role => h('li', {}, role)))),
    h('td', {}, row.school, h('small', {}, row.program_year)),
    h('td', {'data-label': 'Submitted'}, timeElement(row.submitted_at, formatDate)),
    h('td', {}, statusPill(row.status, info.statusLabels)),
    h('td', {'data-label': 'Assigned to'}, row.assigned_to ? names.get(row.assigned_to) || row.assigned_to : h('span', {class: 'staff-muted'}, 'No one'))
  )));
  const total = applications.length;
  count.textContent = total === 0 ? `No applications for ${data.year} yet.`
    : shown.length === total ? `${total} application${total === 1 ? '' : 's'} for ${data.year}`
    : `Showing ${shown.length} of ${total} applications for ${data.year}`;
  $('[data-table-wrap]').hidden = shown.length === 0;
  $('[data-empty]').hidden = shown.length > 0 || total === 0;
}

async function load(year) {
  try {
    [info, data] = await Promise.all([loadMe(), api(`/applications${year ? `?year=${encodeURIComponent(year)}` : ''}`)]);
  } catch (failure) {
    count.textContent = '';
    $('[data-error]').textContent = failure.message;
    $('[data-error]').hidden = false;
    return;
  }
  applications = data.applications;
  const years = data.years.includes(data.year) ? data.years : [data.year, ...data.years];
  yearSelect.replaceChildren(...years.map(value => h('option', {value, selected: value === data.year}, value)));
  $('[data-export]').href = `/api/staff/export.csv?year=${encodeURIComponent(data.year)}`;
  departmentSelect.replaceChildren(h('option', {value: ''}, 'All departments'),
    ...Object.keys(info.departments).map(name => h('option', {value: name, selected: name === filters.dept}, name)));
  assignedSelect.replaceChildren(h('option', {value: ''}, 'Anyone'), h('option', {value: 'me'}, 'Me'), h('option', {value: 'none'}, 'No one'),
    ...data.team.filter(person => !person.blocked && person.email !== info.me.email).map(person => h('option', {value: person.email}, person.name)));
  assignedSelect.value = filters.assigned;
  search.value = filters.q;
  render();
}

yearSelect.addEventListener('change', () => load(yearSelect.value));
search.addEventListener('input', () => { filters.q = search.value; render(); });
departmentSelect.addEventListener('change', () => { filters.dept = departmentSelect.value; render(); });
assignedSelect.addEventListener('change', () => { filters.assigned = assignedSelect.value; render(); });
load(params.get('year'));
