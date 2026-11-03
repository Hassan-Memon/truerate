/**
 * Cloudflare Worker entry. Static files come from the free Workers Assets binding;
 * /api/* runs the same handler as the Node server. Fits inside the free plan.
 */
import { handleApi } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      const cache = caches.default;
      const key = new Request(url.toString(), { method: 'GET' });
      if (request.method === 'GET') {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      const res = await handleApi(request);
      if (request.method === 'GET' && res.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    return env.ASSETS.fetch(request);
  },
};
