/**
 * The hive: a secret corner of the footer. Bring the mouse to the footer's bottom-right corner and a hive peeks out;
 * clicking it opens a menu of the site's easter eggs. Each egg found unlocks something for the bee cursor to wear
 * (one per slot: hat, eyes, neck, trail), equipped and taken off from the menu. Found eggs and the outfit are kept
 * per browser. main.js and bee-game.js call egg() when an easter egg happens; the hive itself is mouse and trackpad
 * only, like the bee cursor (eggs found on a touch screen are still remembered).
 */

const KEY = 'bee-hive';
const fine = matchMedia('(hover:hover) and (pointer:fine)');
const reduced = matchMedia('(prefers-reduced-motion:reduce)');

// In the order the menu lists them. slot: where the reward goes on the bee; item: its look (.bee-wear[data-item]).
export const EGGS = [
  {id: 'hive', name: 'The hive', found: 'Found the secret hive in the corner of the footer.', hint: '', reward: 'Queen bee crown', slot: 'hat', item: 'crown'},
  {id: 'swarm', name: 'Swarm!', found: 'Knocked on the logo until the bees burst out.', hint: 'The logo is crowded. Try knocking, quickly, a few times.', reward: 'Director’s beret', slot: 'hat', item: 'beret'},
  {id: 'dizzy', name: 'Dizzy bee', found: 'Shook the mouse until the bee spun.', hint: 'Give the bee a good shake.', reward: 'Propeller cap', slot: 'hat', item: 'propeller'},
  {id: 'nap', name: 'Nap time', found: 'Left the bee alone long enough to doze off.', hint: 'Leave the bee be for a while.', reward: 'Nightcap', slot: 'hat', item: 'nightcap'},
  {id: 'glasses', name: 'Movie night', found: 'Watched a video, and the bee put its 3D glasses on.', hint: 'Watch something with the bee.', reward: 'Shades', slot: 'eyes', item: 'shades'},
  {id: 'specs', name: 'Bookworm', found: 'Highlighted some text, and the bee put its reading specs on.', hint: 'Find the bee something to read.', reward: 'Bow tie', slot: 'neck', item: 'bowtie'},
  {id: 'buzzrun', name: 'Buzz Run', found: 'Clapped the slate on the lost page until Buzz Run started.', hint: 'Lost pages have a slate. Keep calling takes.', reward: 'Flying scarf', slot: 'neck', item: 'scarf'},
  {id: 'flip', name: 'Backflip', found: 'Double-clicked and the bee did a backflip.', hint: 'Some clicks come in pairs.', reward: 'Sparkle trail', slot: 'trail', item: 'sparkle'},
  {id: 'poof', name: 'Window bump', found: 'Flew the bee off the edge of the window. Poof.', hint: 'What happens when the bee leaves the page?', reward: 'Honey trail', slot: 'trail', item: 'honey'}
];
export const SLOTS = ['hat', 'eyes', 'neck'];

const read = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    return {found: new Set(Array.isArray(saved.found) ? saved.found : []), wear: saved.wear && typeof saved.wear === 'object' ? saved.wear : {}};
  } catch { return {found: new Set(), wear: {}}; }
};
const state = read();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({found: [...state.found], wear: state.wear})); } catch {} };

let hiveReady = false; // the hive exists on this page (mouse and trackpad, with a footer)
const listeners = new Set();
const changed = () => listeners.forEach(fn => fn());

/** Record an easter egg. The first time, a note says what it unlocked. */
export function egg(id) {
  if (state.found.has(id) || !EGGS.some(e => e.id === id)) return;
  state.found.add(id);
  save();
  changed();
  if (id !== 'hive') toast(EGGS.find(e => e.id === id));
}

/** What the bee is wearing: the item in each slot, or none. Only items whose egg has been found count. */
const wearing = slot => {
  const item = state.wear[slot];
  return EGGS.find(e => e.slot === slot && e.item === item && state.found.has(e.id))?.item || '';
};
export function onChange(fn) { listeners.add(fn); fn(); }
export const outfit = () => Object.fromEntries([...SLOTS, 'trail'].map(slot => [slot, wearing(slot)]));

const setWear = (slot, item) => {
  if (item) state.wear[slot] = item; else delete state.wear[slot];
  save();
  changed();
};

/** The bee's wearable layers, for the cursor and the menu's pictures. */
export const wearLayers = () => SLOTS.map(slot => `<i class="bee-wear" data-slot="${slot}"></i>`).join('');
export function dress(el, look) {
  el.querySelectorAll('.bee-wear').forEach(layer => {
    const item = look[layer.dataset.slot];
    if (item) layer.dataset.item = item; else delete layer.dataset.item;
  });
}

/* Unlock note: bottom right, a few seconds, read out politely. */
let toastEl, toastTimer;
function toast(e) {
  if (!fine.matches || !document.body) return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'hive-toast';
    toastEl.setAttribute('role', 'status');
  }
  // Inside an open modal (Buzz Run) so it shows above the backdrop.
  const host = document.querySelector('dialog[open]') || document.body;
  if (toastEl.parentNode !== host) host.append(toastEl);
  const knowsHive = state.found.has('hive');
  toastEl.innerHTML = '<span class="hive-toast-icon" aria-hidden="true"></span><span><strong></strong><span></span></span>';
  toastEl.querySelector('strong').textContent = `Easter egg found: ${e.name}`;
  toastEl.querySelector('strong + span').textContent = knowsHive || !hiveReady
    ? `${e.reward} unlocked. Wear it from the hive.`
    : 'Something is buzzing at the bottom of the page…';
  toastEl.classList.remove('is-shown');
  void toastEl.offsetWidth; // restart the slide-in
  toastEl.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-shown'), 5000);
}

const HIVE_SVG = `<svg viewBox="0 0 100 92" aria-hidden="true" focusable="false">
 <g stroke="#1a1a1a" stroke-width="2.6" stroke-linejoin="round">
  <rect x="45" y="5" width="10" height="9" rx="4.5" fill="#f4a61d"/>
  <rect x="36" y="12" width="28" height="15" rx="7.5" fill="#f7b733"/>
  <rect x="27" y="25" width="46" height="15" rx="7.5" fill="#f4a61d"/>
  <rect x="19" y="38" width="62" height="16" rx="8" fill="#f7b733"/>
  <rect x="13" y="52" width="74" height="16" rx="8" fill="#f4a61d"/>
  <rect x="9" y="66" width="82" height="17" rx="8.5" fill="#f7b733"/>
  <path d="M41 83v-6a9 9 0 0 1 18 0v6z" fill="#1a1a1a"/>
  <path d="M66 54v5.5a3 3 0 0 0 6 0V54" fill="#e98a10" stroke-width="2"/>
 </g>
 <path d="M31 30h12M24 44h9M18 58h14M70 71h11" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
</svg>`;

/** The hive in the footer and its menu. Called once by main.js. */
export function initHive() {
  const footer = document.querySelector('.site-footer');
  if (!footer || !fine.matches) return;
  hiveReady = true;
  const hive = document.createElement('button');
  hive.type = 'button';
  hive.className = 'hive';
  hive.setAttribute('aria-label', 'Secret hive: easter eggs and bee outfits');
  hive.setAttribute('aria-haspopup', 'dialog');
  hive.innerHTML = `${HIVE_SVG}<img class="hive-bee" src="${new URL('../images/bee-32d3992.png', import.meta.url).href}" alt="" width="160" height="129">`;
  footer.append(hive);

  // Peek when the mouse comes near the footer's bottom-right corner (or the hive has focus).
  let frame = 0, px = -1, py = -1;
  const check = () => {
    frame = 0;
    const r = footer.getBoundingClientRect();
    const near = px <= r.right && py <= r.bottom && px > r.right - 190 && py > r.bottom - 160;
    hive.classList.toggle('is-peeking', near);
  };
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    px = e.clientX; py = e.clientY;
    if (!frame) frame = requestAnimationFrame(check);
  }, {passive: true});
  document.documentElement.addEventListener('pointerleave', () => hive.classList.remove('is-peeking'));
  hive.addEventListener('click', () => { egg('hive'); openMenu(hive); });
}

let dialog;
function openMenu(opener) {
  if (dialog?.open) return;
  dialog = document.createElement('dialog');
  dialog.className = 'hive-menu';
  dialog.setAttribute('aria-labelledby', 'hive-menu-title');
  dialog.innerHTML = `
    <div class="hive-menu-head">
      <div>
        <p class="hive-menu-eyebrow">Secret menu</p>
        <h2 id="hive-menu-title">The hive</h2>
        <p class="hive-menu-count"></p>
      </div>
      <button type="button" class="hive-menu-close" aria-label="Close the hive">×</button>
    </div>
    <div class="hive-menu-bar" aria-hidden="true"><span></span></div>
    <p class="hive-menu-intro">Every easter egg you find on the site unlocks something for your bee to wear. One hat, one pair of eyes, one neck and one trail at a time.</p>
    <p class="hive-menu-off" hidden>Turn the bee cursor on (the switch at the bottom of the page) to see your bee dressed up.</p>
    <ul class="hive-menu-list"></ul>`;
  document.body.append(dialog);
  const list = dialog.querySelector('.hive-menu-list');

  list.append(...EGGS.map(e => {
    const li = document.createElement('li');
    li.className = 'hive-egg';
    li.dataset.egg = e.id;
    li.innerHTML = `
      <span class="hive-egg-figure" aria-hidden="true"><span class="bee-figure">${wearLayers()}</span></span>
      <span class="hive-egg-text">
        <span class="hive-egg-name"></span>
        <strong class="hive-egg-reward"></strong>
        <span class="hive-egg-note"></span>
      </span>
      <button type="button" class="hive-egg-wear"></button>`;
    dress(li.querySelector('.bee-figure'), {[e.slot]: e.item});
    if (e.slot === 'trail') li.querySelector('.bee-figure').dataset.trail = e.item;
    li.querySelector('.hive-egg-wear').addEventListener('click', () => {
      setWear(e.slot, wearing(e.slot) === e.item ? '' : e.item);
    });
    return li;
  }));

  const render = () => {
    const count = EGGS.filter(e => state.found.has(e.id)).length;
    dialog.querySelector('.hive-menu-count').textContent = `${count} of ${EGGS.length} easter eggs found`;
    dialog.querySelector('.hive-menu-bar span').style.width = `${count / EGGS.length * 100}%`;
    dialog.querySelector('.hive-menu-off').hidden = !document.documentElement.classList.contains('regular-cursor');
    list.querySelectorAll('.hive-egg').forEach(li => {
      const e = EGGS.find(x => x.id === li.dataset.egg), found = state.found.has(e.id), on = found && wearing(e.slot) === e.item;
      li.classList.toggle('is-locked', !found);
      li.classList.toggle('is-worn', on);
      li.querySelector('.hive-egg-name').textContent = found ? e.name : 'Not found yet';
      li.querySelector('.hive-egg-reward').textContent = found ? e.reward : '???';
      li.querySelector('.hive-egg-note').textContent = found ? e.found : `Hint: ${e.hint}`;
      const button = li.querySelector('.hive-egg-wear');
      button.disabled = !found;
      button.textContent = !found ? 'Locked' : on ? 'Take off' : 'Wear';
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', !found ? 'Reward locked' : `${on ? 'Take off' : 'Wear'} the ${e.reward.toLowerCase()}`);
    });
  };
  listeners.add(render);
  render();

  const close = () => dialog.close();
  dialog.querySelector('.hive-menu-close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); }); // the backdrop
  dialog.addEventListener('close', () => {
    listeners.delete(render);
    dialog.remove();
    opener?.focus({preventScroll: true});
  });
  dialog.showModal();
}

/** Trails: sparkles or honey drops left behind the bee as it flies (not with reduced motion). */
export function trail(x, y, kind, host) {
  if (!kind || reduced.matches) return;
  const dot = document.createElement('i');
  dot.className = `bee-trail bee-trail-${kind}`;
  dot.setAttribute('aria-hidden', 'true');
  dot.style.translate = `${x + (Math.random() * 8 - 4)}px ${y + (Math.random() * 8 - 4)}px`;
  dot.style.setProperty('--spin', `${Math.random() * 90 - 45}deg`);
  host.append(dot);
  dot.addEventListener('animationend', () => dot.remove());
}
