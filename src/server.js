/**
 * Node entry: serves public/ as static files and delegates /api/* to the shared handler.
 * Zero dependencies. `node src/server.js`
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { SECURITY_HEADERS } from './core/headers.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

async function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400, { ...SECURITY_HEADERS, 'content-type': 'text/plain' }); return res.end('bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403, SECURITY_HEADERS); return res.end(); }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.html' ? 'public, max-age=60' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    const html = await readFile(join(PUBLIC, 'index.html')).catch(() => null);
    if (html && !extname(rel)) { res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES['.html'] }); return res.end(html); }
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
    res.end('not found');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api')) {
    const request = new Request(url, { method: req.method });
    const out = await handleApi(request);
    const headers = Object.fromEntries(out.headers);
    const body = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, { ...SECURITY_HEADERS, ...headers, 'content-length': body.length });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  return serveStatic(url.pathname, res);
}

export const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal error');
  });
});

server.listen(PORT, HOST, () => console.log(`TrueRate listening on http://localhost:${PORT}`));
