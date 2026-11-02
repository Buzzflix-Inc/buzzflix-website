// Cloudflare Worker for the Buzzflix website. Only /api/* reaches it (run_worker_first in wrangler.jsonc);
// every other address is served straight from the static files.
import {leaderboard, d1Store} from './leaderboard.js';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/buzz-run/')) return leaderboard(request, d1Store(env.DB));
    return env.ASSETS.fetch(request);
  }
};
