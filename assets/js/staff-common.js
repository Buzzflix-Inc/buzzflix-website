// Shared by the /staff pages: API calls, a small DOM builder, dates, and the header's name and Sign out.
// Everything from the API is put on the page as text (never as HTML), since it comes from applicants.

// Calls /api/staff/*. A signed-out response sends the page to /login and back here afterwards.
export async function api(path, {method = 'GET', body} = {}) {
  const response = await fetch(`/api/staff${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {});
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}

// h('a', {href: '/x', class: 'y'}, 'text', child) → element. null/false children are skipped.
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key in element && key !== 'list' && typeof value !== 'string') element[key] = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return element;
}

const dateFormat = new Intl.DateTimeFormat('en-CA', {month: 'short', day: 'numeric', year: 'numeric'});
const timeFormat = new Intl.DateTimeFormat('en-CA', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
export const formatDate = ms => dateFormat.format(new Date(ms));
export const formatTime = ms => timeFormat.format(new Date(ms));
export const timeElement = (ms, format = formatTime) => h('time', {datetime: new Date(ms).toISOString()}, format(ms));

export const statusPill = (status, labels) => h('span', {class: `status status-${status}`}, labels[status] || status);

// The signed-in person, the status names and the departments; fills in the header.
let mePromise;
export function loadMe() {
  mePromise ||= api('/me').then(result => {
    const slot = document.querySelector('[data-me]');
    if (slot) slot.textContent = result.me.name;
    return result;
  });
  return mePromise;
}

document.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
  await api('/logout', {method: 'POST', body: {}}).catch(() => {});
  location.href = '/login';
});

// Which department a position belongs to, or '' for a free-text role.
export const departmentOf = (role, departments) =>
  Object.keys(departments).find(name => departments[name].some(position => position.toLowerCase() === String(role).toLowerCase())) || '';

// Live updates: every 10 seconds while the page is in view (and straight away when it comes back into view),
// asks whether anything changed (GET /api/staff/changes) and calls `reload` if it did. The same check says which
// application this page has open (`viewing`), and hands `onViewers` who else has which application open.
export function watchChanges(reload, {viewing = null, onViewers} = {}) {
  let version = null, checking = false;
  const check = async () => {
    if (document.hidden || checking) return;
    checking = true;
    try {
      const result = await api(`/changes${viewing ? `?viewing=${viewing}` : ''}`);
      if (version !== null && result.version !== version) await reload();
      version = result.version;
      onViewers?.(result.viewers || {});
    } catch {
      // Offline or a hiccup: try again next time.
    } finally {
      checking = false;
    }
  };
  check();
  setInterval(check, 10_000);
  document.addEventListener('visibilitychange', check);
  // Leaving the page (or hiding it) takes this person off the application's viewers straight away.
  if (viewing) {
    const leave = () => fetch('/api/staff/presence', {method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({viewing: null})}).catch(() => {});
    addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  }
}

// Small initial circles for teammates who have an application open, e.g. "MT" for Megan Tran.
const initials = name => name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
export function viewerDots(emails, team, {long = false} = {}) {
  if (!emails?.length) return null;
  const names = emails.map(email => team.find(person => person.email === email)?.name || email.split('@')[0]);
  const text = long ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} also viewing this` : `Open now: ${names.join(', ')}`;
  return h('span', {class: 'staff-viewers', title: text},
    ...names.map(name => h('span', {class: 'staff-viewer', 'aria-hidden': 'true'}, initials(name) || '?')),
    h('span', {class: long ? 'staff-viewers-text' : 'visually-hidden'}, text));
}
