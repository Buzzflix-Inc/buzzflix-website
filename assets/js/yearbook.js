/** Splits the yearbook into pages; without JS every card stays visible. */
// 20 fills whole rows at five, four and two columns.
const PAGE_SIZE = 20;

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
  const total = Math.ceil(cards.length / PAGE_SIZE);
  if (total < 2) return;
  const heading = document.getElementById('class-title');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

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

  let current = 1;
  const show = (page, scroll) => {
    current = page;
    cards.forEach((card, i) => { card.hidden = Math.floor(i / PAGE_SIZE) + 1 !== page; });
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
    const first = (page - 1) * PAGE_SIZE + 1;
    status.textContent = `Page ${page} of ${total} · ${first}–${Math.min(page * PAGE_SIZE, cards.length)} of ${cards.length} crew`;
    if (scroll) {
      heading.scrollIntoView({behavior: reduced.matches ? 'instant' : 'smooth'});
      heading.focus({preventScroll: true});
    }
  };

  pager.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled && Number(b.dataset.page) !== current) show(Number(b.dataset.page), true);
  });
  show(1, false);
}

initYearbook();
