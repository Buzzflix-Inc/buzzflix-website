# Staff area and application storage

Staff sign in at **buzzflix.ca/login** (nothing on the site links to it) with a 6-digit code emailed to their @buzzflix.ca address. Once signed in, they can:

- see the applications assigned to them (the first tab), all of a year's applications (with a thin bar showing how many are at each step), or one step at a time, filtered by department, assignee or a search
- add an application by hand (Add application, /staff/new) for one that came in by email or on paper
- open an application to read the answers and the resume and portfolio PDFs
- assign it to a teammate from a dropdown, in the list or on the application, or tick several rows to assign or move them at once
- see who else has an application open (initial dots, in the list and on the application)
- after an interview, fill in the scorecard (Interview complete): five 1–5 ratings, notes, and Recommend or Reject
- email the applicant from a template (Invite to interview, Offer, Not this time), edited first and kept in the application's history
- move it through the hiring steps and add notes (general or interview notes)
- see each application's history (who changed what, and when)
- export a year to CSV

Several people can work at once: every open staff page checks every 10 seconds (while it's on screen) whether anything changed, and reloads its data if so. Changed rows and new notes flash yellow. A check is one tiny database read, well inside Cloudflare's free limits (one person with a page open for an 8-hour day makes about 2,900 checks; the free plan allows 100,000 Worker requests a day).

**Hiring steps** (`allowedStatuses` and `change` in `worker/staff.js`): New → In review → Interview → **Approve (pending)** or **Decline (pending)**, the interviewer's recommendation, made only through the scorecard (by the person assigned, or an admin) → admins see these under **Needs your decision** → **Hired** or **Not hired**, the admin's final decision, made from the Final decision box on the application. An application is New exactly while no one is assigned: assigning it moves it to In review, and unassigning it while In review sends it back to New. From Interview on it can be reassigned but not unassigned. Members can't choose Approve or Decline before Interview, can't make the final decision, and can't change it afterwards. Admins can choose any step for an assigned application.

Admins can also add teammates before their first sign-in, make someone an admin, block someone (this signs them out and unassigns their applications), and delete an application with its files (for privacy requests).

## How it fits together

| Piece | Where |
|---|---|
| Application form → `POST /api/apply` (applications and saved drafts) | `worker/apply.js` |
| Sign-in codes, sessions, staff API `/api/staff/*` | `worker/staff.js` |
| D1 database `buzzflix-applications` (binding `APPS`) | `worker/applications-schema.sql`, `worker/applications-store.js` |
| R2 bucket `buzzflix-application-documents` (binding `DOCUMENTS`) for PDFs | `worker/applications-store.js` |
| Email (sign-in codes, draft links, application confirmations) through Resend | `worker/mail.js` |
| Pages: `login.html`, `staff/index.html`, `staff/application.html`, `staff/team.html` | `assets/css/staff.css`, `assets/js/staff-*.js` |
| Settings (`APPLICATIONS_OPEN`, `ADMIN_EMAILS`, `MAIL_FROM`) | `wrangler.jsonc` → `vars` |

The Worker stops signed-out visitors at `/staff` and sends them to `/login`. Sign-in codes last 10 minutes and allow 5 wrong tries, and sessions last 14 days. Only hashes of codes and session tokens are stored. Anyone with an @buzzflix.ca address can sign in unless an admin blocks them. The addresses in `ADMIN_EMAILS` become admins on their first sign-in.

**Scorecard and email wording** live in `worker/hiring.js`. Invite to interview can be sent In review or at Interview by anyone; Offer (once Hired) and Not this time (once Not hired) by admins only. While `APPLICANT_EMAILS` in `wrangler.jsonc` is `"off"`, emails are saved to the application's history marked "Saved, not sent". Set it to `"on"` once buzzflix.ca is verified in Resend and `RESEND_API_KEY` is set.

## Example team members

Three made-up teammates are in the database so applications can be assigned before the real team signs in: Megan Tran, Owen Laurent and Priya Shah, all marked "(example)", at example.megan@, example.owen@ and example.priya@buzzflix.ca. The local preview adds them too (`scripts/demo-applications.mjs`). Remove them in the Cloudflare dashboard (D1 → buzzflix-applications → Console) with `DELETE FROM staff WHERE email LIKE 'example.%';`, or block them on the Team page.

## Temporary: sign-in without a code

While email can't be sent (no `RESEND_API_KEY` yet, and only Resend's test sender), `DEV_LOGIN_EMAIL` in `wrangler.jsonc` (jack@buzzflix.ca) signs in at /login with no code. Every other address still needs one. It's turned off automatically on buzzflix.ca and www.buzzflix.ca and once `APPLICATIONS_OPEN` is `"true"`, so it only works on the local preview and the modern-look-preview address. Anyone who knows the preview address and that email could sign in as an admin there, so keep real applicant data off the preview. **Delete `DEV_LOGIN_EMAIL` before merging into main.**

Also temporary: `TEST_SUBMISSIONS` in `wrangler.jsonc` and `testSubmissions` in `assets/js/application-config.js` make the apply page really submit (instead of previewing) everywhere except buzzflix.ca, so test applications show up in /staff. **Delete both before merging into main**, and delete the test applications from the staff area.

## One-time setup

Run these from the website folder. `npx wrangler` asks you to log in to Cloudflare the first time.

1. ~~Create the database~~ Done on 2026-11-06: `buzzflix-applications` (eastern North America), schema applied, ID in `wrangler.jsonc`. To apply later schema changes:
   ```sh
   npx wrangler d1 execute buzzflix-applications --remote --file worker/applications-schema.sql
   ```
2. ~~Create the private bucket for PDFs~~ Done on 2026-11-06 (eastern North America, private, no public URL). The command, for reference:
   ```sh
   npx wrangler r2 bucket create buzzflix-application-documents
   ```
3. Set up Resend. **For now the site sends from Resend's test address `onboarding@resend.dev`** (`MAIL_FROM` in `wrangler.jsonc`). Resend delivers test-address mail only to the email the Resend account was made with, so until buzzflix.ca is verified:
   - only that person gets sign-in codes, and only if it's their @buzzflix.ca address; anyone else sees “We couldn’t send a code”
   - applicants' draft links and confirmations don't arrive (the draft save shows an error; a submitted application is still saved)

   When the domain is verified, change `MAIL_FROM` back to `Buzzflix <no-reply@buzzflix.ca>` and deploy.
   - ~~Add the domain `buzzflix.ca`~~ Added 2026-11-06 (sending only, us-east-1, no open/click tracking). Add the four DNS records Resend lists for it (Resend → Domains → buzzflix.ca) in Cloudflare (DNS → Records) and wait for **Verified**. They sit on `resend._domainkey`, `send` and `rsend`, so they don't touch Google Workspace email.
   - Create an API key with **Sending access**, then store it as a Worker secret:
   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```
4. Deploy. The first person in `ADMIN_EMAILS` signs in at /login.

## When applications open

- Set `"APPLICATIONS_OPEN": "true"` in `wrangler.jsonc`.
- Remove `data-preview` from the form in `apply.html`.
- Deploy.

Until then, the API refuses submissions. Saved drafts work in either state.

## Moving off Google Apps Script

The form no longer posts to Apps Script. There were no applications or drafts in the Google Sheet to carry over (checked 2026-11-06), so the Apps Script deployment, `apps-script/Code.gs`, `scripts/test-apps-script.mjs` and `APPS-SCRIPT-SETUP.md` can be retired.

## Local preview

```sh
DEMO=1 APPLICATIONS_OPEN=true node scripts/serve.mjs
```

The preview keeps everything in memory, and it's emptied on restart. Emails, including sign-in codes, print in the terminal instead of being sent. `DEMO=1` adds made-up applications and three teammates. Sign in as jack@buzzflix.ca with the code from the terminal. The `buzzflix-staff-demo` entry in `.claude/launch.json` does the same on port 4175.

Tests: `node --test scripts/test-staff.mjs`.
