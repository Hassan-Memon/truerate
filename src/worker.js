/**
 * Cloudflare Worker entry. Static files come from the free Workers Assets binding;
 * /api/* runs the same handler as the Node server. Fits inside the free plan.
 */
import { handleApi } from './api.js';
import { withSecurityHeaders } from './core/headers.js';
import { pairFromUrl, renderPairHtml } from './core/pages.js';

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
      const res = withSecurityHeaders(await handleApi(request));
      if (request.method === 'GET' && res.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    const pair = pairFromUrl(url);
    if (pair) {
      const page = await env.ASSETS.fetch(new Request(new URL('/', url)));
      return withSecurityHeaders(new Response(renderPairHtml(await page.text(), pair), {
        status: page.status,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
      }));
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
