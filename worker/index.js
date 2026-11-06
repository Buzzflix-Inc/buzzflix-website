// Cloudflare Worker for the Buzzflix website. Only /api/* and /staff* reach it (run_worker_first in
// wrangler.jsonc); every other address, /login included, is served straight from the static files.
import {leaderboard, d1Store as scoreStore} from './leaderboard.js';
import {applyApi} from './apply.js';
import {staffApi, staffPage} from './staff.js';
import {d1Store, r2Files} from './applications-store.js';
import {resendMailer, DEFAULT_FROM} from './mail.js';

export default {
  async fetch(request, env, context) {
    const {pathname} = new URL(request.url);
    if (pathname.startsWith('/api/buzz-run/')) return leaderboard(request, scoreStore(env.DB));
    if (pathname === '/api/apply' || pathname.startsWith('/api/staff/') || pathname === '/staff' || pathname.startsWith('/staff/')) {
      const ctx = {
        store: d1Store(env.APPS),
        files: r2Files(env.DOCUMENTS),
        mailer: resendMailer(env.RESEND_API_KEY, env.MAIL_FROM || DEFAULT_FROM),
        now: Date.now(),
        open: env.APPLICATIONS_OPEN === 'true',
        // TEMPORARY: accept test applications before they open, except on buzzflix.ca. Remove with TEST_SUBMISSIONS.
        testSubmissions: env.TEST_SUBMISSIONS === 'true' && !/(^|\.)buzzflix\.ca$/.test(new URL(request.url).hostname),
        devLoginEmail: String(env.DEV_LOGIN_EMAIL || '').trim().toLowerCase(), // TEMPORARY: see worker/staff.js
        adminEmails: String(env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean),
        secure: new URL(request.url).protocol === 'https:',
        waitUntil: promise => context.waitUntil(promise)
      };
      if (pathname === '/api/apply') return applyApi(request, ctx);
      if (pathname.startsWith('/api/staff/')) return staffApi(request, ctx);
      return staffPage(request, ctx, () => env.ASSETS.fetch(request));
    }
    return env.ASSETS.fetch(request);
  }
};
