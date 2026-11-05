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
}

initYearbook();
