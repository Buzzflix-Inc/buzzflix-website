// Copies each page's visible FAQ into FAQPage structured data in its <head>, so search engines read
// the same questions and answers people see. Run it after editing any FAQ:
//   node scripts/faq-schema.mjs
// It replaces the page's existing <script type="application/ld+json" data-faq> block, or adds one before </head>.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PAGES = ['apply.html', 'movies.html', 'mentors.html'];

const text = html => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').replace(/\s+([.,!?;:)])/g, '$1').trim();

for (const page of PAGES) {
  const file = path.join(root, page);
  let html = fs.readFileSync(file, 'utf8');
  const section = html.match(/<section class="[^"]*\bfaq\b[^"]*"[^>]*>([\s\S]*?)<\/section>/);
  if (!section) throw new Error(`${page}: no FAQ section`);
  const items = [...section[1].matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
    .map(([, q, a]) => ({'@type': 'Question', name: text(q), acceptedAnswer: {'@type': 'Answer', text: text(a)}}));
  if (!items.length) throw new Error(`${page}: FAQ has no questions`);
  const json = JSON.stringify({'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items})
    .replace(/</g, '\\u003c');
  const block = `<script type="application/ld+json" data-faq>${json}</script>`;
  const existing = /<script type="application\/ld\+json" data-faq>[\s\S]*?<\/script>/;
  html = existing.test(html) ? html.replace(existing, () => block) : html.replace('</head>', () => `${block}</head>`);
  fs.writeFileSync(file, html);
  console.log(`${page}: ${items.length} questions`);
}
