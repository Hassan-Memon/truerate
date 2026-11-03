/**
 * Node entry: serves public/ as static files and delegates /api/* to the shared handler.
 * Zero dependencies. `node src/server.js`
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

async function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.html' ? 'public, max-age=60' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    const html = await readFile(join(PUBLIC, 'index.html')).catch(() => null);
    if (html && !extname(rel)) { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(html); }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api')) {
    const request = new Request(url, { method: req.method, headers: req.headers });
    const out = await handleApi(request);
    const headers = Object.fromEntries(out.headers);
    const body = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, { ...headers, 'content-length': body.length });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  return serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => console.log(`TrueRate listening on http://localhost:${PORT}`));
