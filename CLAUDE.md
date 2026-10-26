# Buzzflix website

Hand-built static site for Buzzflix (student film production company, Windsor ON). No build step and no dependencies: the repository root is what Cloudflare Workers serves (`wrangler.jsonc`).

## Files

- Pages: `index.html`, `about.html`, `mentors.html`, `movies.html`, `404.html`. Served at `/`, `/about`, `/mentors`, `/movies`; internal links use the `.html` names and Cloudflare redirects them.
- Homepage: never edit `index.html` directly. Edit `home-current.html` (normal) or `home-applications.html` (application season, Jan to Mar/Apr), then run `node scripts/switch-home.mjs current|applications` to copy one to `index.html`. Keep shared changes in both sources.
- Header, footer and `<head>` are repeated in every page. A change to them must be made in all six page files (and both homepage sources).
- CSS: `assets/css/site.css` holds everything, in order: fonts, tokens, base, components, pages. Each part has its own `@media(max-width:800px)` block. `assets/css/application.css` loads only on the application homepage.
- JS: `assets/js/main.js` (mobile menu, carousel dragging and arrow keys). The application form is `application-form.js` and `application-config.js` (live Google Apps Script endpoint).
- `apps-script/Code.gs` is the form backend. `consent_version` must match in `application-form.js` and `Code.gs`. Test with `node --test scripts/test-apps-script.mjs`.
- Docs: `APPLICATIONS.md`, `APPS-SCRIPT-SETUP.md`, `CLOUDFLARE-CUTOVER.md`.

## Rules

- Match the existing look: tokens in `site.css` (`--yellow`, `--orange`, `--ink`, `--muted`), Space Grotesk 500 headings, Roboto 400 body, 800px breakpoint. Check every change at phone and desktop widths.
- Contrast: orange text on yellow uses `--orange-text` at 24px or larger (passes WCAG AA). Buttons are white 16px text on the brand `--orange` (3.4:1), which Lighthouse flags; this is a deliberate brand choice, so don't darken the orange or change the button text to fix it.
- Images live in `assets/images/<slug>-<7 hex>.<ext>`, mostly WebP. `_headers` caches images and fonts for a year, so a new or changed file needs a new name. Every `<img>` carries the file's real `width`/`height`, `loading="lazy"` unless it is above the fold, and the page's top photo gets `fetchpriority="high"`. Focal points go in `style="object-position:…"` (omit it for the 50% 50% default).
- Fonts in `fonts.css` section: only the faces in use (Roboto 400, 400 italic, 700; Space Grotesk 400, 500), Latin and Latin Extended. The two `<link rel="preload">` font tags in each page point at Roboto 400 and Space Grotesk 500 Latin.
- Link text must describe the destination (Lighthouse SEO flags "More Info", "here", "learn more"). Keep a short visible label by adding hidden context, e.g. `More Info<span class="visually-hidden"> on YouTube</span>`.
- `_headers` sets a Content-Security-Policy. Any new outside service (scripts, embeds, form endpoints, fonts) must be added there or browsers will block it.
- Files that must not be public go in `.assetsignore` (Markdown, scripts, `apps-script`, homepage sources are already listed).

## Preview

`node scripts/serve.mjs` (or the `buzzflix` config in `.claude/launch.json`) serves the site like Cloudflare: pretty URLs, `_redirects`, `_headers`, `.assetsignore` and the 404 page. ES modules don't run from `file://`.
