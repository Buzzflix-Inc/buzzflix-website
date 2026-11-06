// The assign picker used on the staff pages: a button showing who's assigned (avatar and name) that opens a
// searchable list of the team, with "Assign to me" first and each person's open workload, so work can be
// shared out evenly. Keyboard: arrows move, Enter chooses, Escape closes. Callers save the choice themselves.
import {h, avatar} from './staff-common.js';

let openPicker = null; // only one open at a time
let nextId = 0;

/**
 * assignPicker({team, me, value, none, alwaysNone, onChoose, label, placeholder})
 *   team: [{email, name, blocked, active}], me: {email}, value: email or null
 *   none: false (no Unassign), true, or a string explaining why it's not allowed (shown greyed out)
 *   alwaysNone: offer Unassign even when no one is chosen (the bulk bar, which acts on several applications)
 *   onChoose(email | null): called when someone picks a different person
 * Returns {element, close(), setValue(email), setBusy(boolean), setTeam(team), isOpen()}.
 */
export function assignPicker({team, me, value = null, none = true, alwaysNone = false, onChoose, label = 'Assigned to', placeholder = 'Unassigned'}) {
  const id = `picker-${++nextId}`;
  let current = value, busy = false, active = -1, options = [];
  const people = () => team.filter(person => !person.blocked || person.email === current);
  const nameOf = email => team.find(person => person.email === email)?.name || email;

  const face = h('span', {class: 'staff-picker-face'});
  const button = h('button', {type: 'button', class: 'staff-picker-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${id}-list`},
    face, h('span', {class: 'staff-picker-chevron', 'aria-hidden': 'true'}));
  const search = h('input', {type: 'search', class: 'staff-picker-search', placeholder: 'Find a teammate', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list', 'aria-label': 'Find a teammate'});
  const list = h('ul', {class: 'staff-picker-list', role: 'listbox', id: `${id}-list`, 'aria-label': label});
  const pop = h('div', {class: 'staff-picker-pop', hidden: true}, search, list);
  const element = h('div', {class: 'staff-picker'}, button, pop);

  function drawFace() {
    face.replaceChildren(current
      ? avatar(nameOf(current), current, team.find(person => person.email === current)?.colour)
      : h('span', {class: 'staff-avatar is-empty', 'aria-hidden': 'true'}),
      h('span', {class: current ? 'staff-picker-name' : 'staff-picker-name is-empty'},
        current ? (current === me.email ? `${nameOf(current)} (me)` : nameOf(current)) : placeholder));
    button.setAttribute('aria-label', `${label}: ${current ? nameOf(current) : placeholder}. Change`);
    button.classList.toggle('is-busy', busy);
  }

  function drawList() {
    const query = search.value.trim().toLowerCase();
    const everyone = people().filter(person => !query || person.name.toLowerCase().includes(query) || person.email.includes(query));
    // Me first, then everyone else by name. The least busy (among those not chosen) gets a hint.
    everyone.sort((a, b) => (b.email === me.email) - (a.email === me.email) || a.name.localeCompare(b.name));
    const others = everyone.filter(person => !person.blocked && person.email !== current);
    // Only when workloads differ, or everyone would be "least busy".
    const loads = others.map(person => person.active || 0);
    const fewest = loads.length > 1 && Math.min(...loads) < Math.max(...loads) ? Math.min(...loads) : null;
    options = everyone.map(person => ({email: person.email, disabled: false, node: h('li', {role: 'option', id: `${id}-${person.email}`,
      'aria-selected': String(person.email === current), class: 'staff-picker-option'},
      avatar(person.name, person.email, person.colour),
      h('span', {class: 'staff-picker-option-name'}, person.name, person.email === me.email && h('span', {class: 'staff-picker-me'}, ' (me)'),
        (person.title || person.department) && h('small', {class: 'staff-picker-me'}, [person.title, person.department].filter(Boolean).join(' · '))),
      h('span', {class: 'staff-picker-load'}, `${person.active || 0} open`,
        fewest !== null && (person.active || 0) === fewest && person.email !== current && h('span', {class: 'staff-picker-hint'}, 'Least busy')),
      h('span', {class: 'staff-picker-check', 'aria-hidden': 'true'}))}));
    if (none && (current || alwaysNone) && !query) {
      const reason = typeof none === 'string' ? none : '';
      options.push({email: null, disabled: Boolean(reason), node: h('li', {role: 'option', id: `${id}-none`, class: 'staff-picker-option is-none',
        'aria-selected': 'false', 'aria-disabled': reason ? 'true' : null},
        h('span', {class: 'staff-avatar is-empty', 'aria-hidden': 'true'}),
        h('span', {class: 'staff-picker-option-name'}, 'Unassign', reason && h('small', {}, reason)))});
    }
    list.replaceChildren(...(options.length ? options.map(option => option.node) : [h('li', {class: 'staff-picker-empty'}, 'No one matches.')]));
    options.forEach((option, index) => {
      option.node.addEventListener('mousedown', event => event.preventDefault()); // keep focus in the search box
      option.node.addEventListener('click', () => choose(index));
      option.node.addEventListener('mousemove', () => highlight(index));
    });
    highlight(options.findIndex(option => !option.disabled && option.email !== current && option.email !== null));
  }

  function highlight(index) {
    active = index;
    options.forEach((option, i) => option.node.classList.toggle('is-active', i === index));
    const node = options[index]?.node;
    search.setAttribute('aria-activedescendant', node ? node.id : '');
    node?.scrollIntoView({block: 'nearest'});
  }

  function move(step) {
    if (!options.length) return;
    let index = active;
    for (let tries = 0; tries < options.length; tries++) {
      index = (index + step + options.length) % options.length;
      if (!options[index].disabled) return highlight(index);
    }
  }

  function choose(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    close(true);
    if (option.email !== current || option.email === null) onChoose(option.email);
  }

  function open() {
    if (busy) return;
    openPicker?.close();
    openPicker = api;
    search.value = '';
    pop.hidden = false;
    element.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    drawList();
    place();
    search.focus({preventScroll: true});
  }

  // The list is fixed to the screen (so a table or card can't clip it), under the button, or above it when
  // there isn't room below. It follows the button while the page scrolls.
  function place() {
    if (pop.hidden) return;
    const box = button.getBoundingClientRect();
    const width = Math.min(Math.max(box.width, 300), innerWidth - 16);
    const height = pop.offsetHeight;
    const below = innerHeight - box.bottom - 8;
    pop.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    pop.style.width = `${width}px`;
    pop.style.top = `${below >= height || below >= box.top ? box.bottom + 4 : Math.max(8, box.top - height - 4)}px`;
  }

  function close(focusButton = false) {
    if (pop.hidden) return;
    pop.hidden = true;
    element.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    if (openPicker === api) openPicker = null;
    if (focusButton) button.focus();
    element.dispatchEvent(new CustomEvent('picker:close', {bubbles: true}));
  }

  button.addEventListener('click', () => pop.hidden ? open() : close(true));
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
  });
  search.addEventListener('input', drawList);
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
  });
  element.addEventListener('focusout', event => { if (!element.contains(event.relatedTarget)) close(); });

  const api = {
    element,
    close,
    place,
    isOpen: () => !pop.hidden,
    setValue(email) { current = email; drawFace(); },
    setBusy(value) { busy = value; drawFace(); },
    setTeam(next) { team = next; drawFace(); }
  };
  drawFace();
  return api;
}

// A click anywhere else closes the open picker; scrolling or resizing moves it with its button.
document.addEventListener('mousedown', event => {
  if (openPicker && !openPicker.element.contains(event.target)) openPicker.close();
});
addEventListener('scroll', () => openPicker?.place(), {capture: true, passive: true});
addEventListener('resize', () => openPicker?.place());
export const pickerOpen = () => Boolean(openPicker);
