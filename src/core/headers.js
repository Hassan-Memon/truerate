/**
 * Security headers applied to every response, static and API alike.
 *
 * The page ships no inline scripts, so `script-src` stays strict: nothing runs
 * unless it came from this origin. `style-src` has to allow inline, because the
 * range strip and the chart position elements with `style="left:…"` at render
 * time; CSS-only attacks are neutered anyway by `img-src` and `connect-src`
 * being same-origin. `connect-src 'self'` is deliberate — the browser only
 * talks to our own /api, never to an upstream feed directly.
 *
 * `upgrade-insecure-requests` is intentionally omitted: it breaks plain-http
 * local development, and production is HTTPS-only via HSTS below.
 */
export const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
});

/** Copy a Response with the security headers merged in. */
export function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
