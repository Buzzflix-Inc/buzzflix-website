/** Adds a search box and splits the yearbook into pages; without JS every card stays visible. */
// 20 fills whole rows at five, four and two columns.
const PAGE_SIZE = 20;

// Lower case without accents, so "chloe" finds "Chloé".
const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

function initYearbook() {
  const grid = document.querySelector('[data-yearbook]');
  if (!grid) return;
  // Shuffle on every load (Fisher–Yates); without JS the cards stay alphabetical.
  const cards = [...grid.querySelectorAll('.yearbook-card')];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  grid.append(...cards);
  // Name, superlative, movies and roles: everything the card shows.
  const text = new Map(cards.map(card => [card, fold(card.textContent)]));
  const heading = document.getElementById('class-title');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const search = document.createElement('div');
  search.className = 'yearbook-search';
  search.setAttribute('role', 'search');
  search.innerHTML = '<label for="yearbook-query" class="visually-hidden">Search the class by name, movie or role</label>'
    + '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>'
    + '<input id="yearbook-query" type="search" placeholder="Search by name, movie or role" autocomplete="off" spellcheck="false">';
  const input = search.querySelector('input');
  // The heading and the search share a row.
  const head = document.createElement('div');
  head.className = 'yearbook-head';
  heading.before(head);
  head.append(heading, search);

  const pager = document.createElement('nav');
  pager.className = 'yearbook-pager';
  pager.setAttribute('aria-label', 'Yearbook pages');
  const status = document.createElement('p');
  status.className = 'yearbook-status';
  status.setAttribute('aria-live', 'polite');
  grid.after(pager, status);

  const button = (label, page, extra = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `yearbook-page ${extra}`.trim();
    b.dataset.page = page;
    b.innerHTML = label;
    return b;
  };

  let matches = cards;
  let current = 1;
  const show = (page, scroll) => {
    current = page;
    const total = Math.ceil(matches.length / PAGE_SIZE);
    const onPage = new Set(matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
    cards.forEach(card => { card.hidden = !onPage.has(card); });
    pager.hidden = total < 2;
    if (total > 1) {
      const pages = document.createElement('div');
      pages.className = 'yearbook-pages';
      pages.append(...Array.from({length: total}, (_, i) => {
        const b = button(i + 1, i + 1);
        b.setAttribute('aria-label', `Page ${i + 1}`);
        if (i + 1 === page) b.setAttribute('aria-current', 'page');
        return b;
      }));
      const prev = button('<span aria-hidden="true">←</span>', page - 1, 'step');
      const next = button('<span aria-hidden="true">→</span>', page + 1, 'step');
      prev.setAttribute('aria-label', 'Previous page');
      next.setAttribute('aria-label', 'Next page');
      prev.disabled = page === 1;
      next.disabled = page === total;
      pager.replaceChildren(prev, pages, next);
    }
    const query = input.value.trim();
    const first = (page - 1) * PAGE_SIZE + 1;
    const range = `${first}–${Math.min(page * PAGE_SIZE, matches.length)} of ${matches.length}`;
    if (!query) status.textContent = total > 1 ? `Page ${page} of ${total} · ${range} crew` : '';
    else if (!matches.length) status.textContent = `No crew match “${query}”`;
    else status.textContent = `${matches.length} crew ${matches.length === 1 ? 'matches' : 'match'} “${query}”${total > 1 ? ` · page ${page} of ${total}` : ''}`;
    if (scroll) {
      heading.scrollIntoView({behavior: reduced.matches ? 'instant' : 'smooth'});
      heading.focus({preventScroll: true});
    }
  };

  input.addEventListener('input', () => {
    // Every word must appear somewhere on the card, in any order.
    const words = fold(input.value).split(' ').filter(Boolean);
    matches = cards.filter(card => words.every(word => text.get(card).includes(word)));
    show(1, false);
  });
  pager.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled && Number(b.dataset.page) !== current) show(Number(b.dataset.page), true);
  });
  show(1, false);
  initViewer({cards, getMatches: () => matches, clearSearch: () => {
    input.value = '';
    matches = cards;
  }, showCard: card => show(Math.floor(matches.indexOf(card) / PAGE_SIZE) + 1, false)});
}

// "Chloé St. Pierre" → "chloe-st-pierre", used as the card's link (yearbook#chloe-st-pierre).
const slugify = name => fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Click a card for a bigger view: arrows (buttons, arrow keys or a swipe) step through the cards the
 * search currently shows, and "Copy link" copies yearbook#name, which opens that card when visited.
 */
function initViewer({cards, getMatches, clearSearch, showCard}) {
  const bySlug = new Map();
  cards.forEach(card => {
    const name = card.querySelector('h3').textContent.trim();
    let slug = slugify(name);
    while (bySlug.has(slug)) slug += '-2';
    bySlug.set(slug, card);
    card.dataset.slug = slug;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'yearbook-open';
    open.innerHTML = `<span class="visually-hidden">Open ${name}’s card</span>`;
    card.append(open);
  });

  const dialog = document.createElement('dialog');
  dialog.className = 'yearbook-viewer';
  dialog.setAttribute('aria-labelledby', 'yearbook-viewer-name');
  dialog.innerHTML = '<div class="yearbook-view">'
    + '<button type="button" class="yearbook-close" aria-label="Close"><span aria-hidden="true">×</span></button>'
    + '<div class="yearbook-view-card"></div>'
    + '<div class="yearbook-view-bar">'
    + '<button type="button" class="yearbook-page step" data-step="-1" aria-label="Previous person"><span aria-hidden="true">←</span></button>'
    + '<p class="yearbook-view-count" aria-live="polite"></p>'
    + '<button type="button" class="yearbook-page step" data-step="1" aria-label="Next person"><span aria-hidden="true">→</span></button>'
    + '<button type="button" class="yearbook-copy">'
    + '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>'
    + '<span>Copy link</span></button>'
    + '</div></div>';
  document.body.append(dialog);
  const body = dialog.querySelector('.yearbook-view-card');
  const count = dialog.querySelector('.yearbook-view-count');
  const copy = dialog.querySelector('.yearbook-copy');
  const copyLabel = copy.querySelector('span');
  const steps = dialog.querySelectorAll('[data-step]');

  let list = cards;
  let index = 0;
  let copyTimer;
  const link = card => `${location.origin}${location.pathname}#${card.dataset.slug}`;

  const render = () => {
    const card = list[index];
    const photo = card.querySelector('.yearbook-photo').cloneNode(true);
    const name = card.querySelector('h3').cloneNode(true);
    name.id = 'yearbook-viewer-name';
    const roles = card.querySelector('.yearbook-roles').cloneNode(true);
    photo.querySelectorAll('img').forEach(img => img.loading = 'eager');
    roles.querySelectorAll('img').forEach(img => img.loading = 'eager');
    const info = document.createElement('div');
    info.className = 'yearbook-view-info';
    info.append(name, roles);
    body.replaceChildren(photo, info);
    count.textContent = list.length > 1 ? `${index + 1} of ${list.length}` : '';
    steps.forEach(b => { b.hidden = list.length < 2; });
    clearTimeout(copyTimer);
    copyLabel.textContent = 'Copy link';
    copy.classList.remove('copied');
    history.replaceState(null, '', `#${card.dataset.slug}`);
  };

  const open = card => {
    list = getMatches().includes(card) ? getMatches() : cards;
    index = list.indexOf(card);
    render();
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add('yearbook-locked');
    }
  };
  const step = by => {
    if (list.length < 2) return;
    index = (index + by + list.length) % list.length;
    render();
  };

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('yearbook-locked');
    history.replaceState(null, '', location.pathname + location.search);
    // Leave the grid on the page that holds the last card viewed, with focus on it.
    const card = list[index];
    if (!getMatches().includes(card)) clearSearch();
    showCard(card);
    card.querySelector('.yearbook-open').focus({preventScroll: true});
    card.scrollIntoView({block: 'nearest'});
  });

  document.querySelector('[data-yearbook]').addEventListener('click', e => {
    const b = e.target.closest('.yearbook-open');
    if (b) open(b.closest('.yearbook-card'));
  });
  dialog.addEventListener('click', e => {
    // A click on the dimmed backdrop lands on the dialog itself.
    if (e.target === dialog) return dialog.close();
    if (e.target.closest('.yearbook-close')) return dialog.close();
    const s = e.target.closest('[data-step]');
    if (s) step(Number(s.dataset.step));
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });

  // Swipe left or right on touch screens.
  let touch = null;
  dialog.addEventListener('touchstart', e => {
    touch = e.touches.length === 1 ? {x: e.touches[0].clientX, y: e.touches[0].clientY} : null;
  }, {passive: true});
  dialog.addEventListener('touchend', e => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, {passive: true});

  copy.addEventListener('click', async () => {
    const url = link(list[index]);
    try {
      await navigator.clipboard.writeText(url);
      copyLabel.textContent = 'Link copied!';
      copy.classList.add('copied');
    } catch {
      // No clipboard access (e.g. an http preview): show the link so it can be copied by hand.
      window.prompt('Copy this link:', url);
      return;
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyLabel.textContent = 'Copy link';
      copy.classList.remove('copied');
    }, 2500);
  });

  // A shared link (yearbook#name) opens that card.
  const fromHash = () => {
    const card = bySlug.get(decodeURIComponent(location.hash.slice(1)));
    if (card) open(card);
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

initYearbook();
