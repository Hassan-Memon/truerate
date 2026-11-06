/* Boots the real Node server on a spare port and checks static serving. No upstream calls. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../src/server.js', import.meta.url));
let child;
let base;

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }).on('error', reject);
});

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [ENTRY], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited with ${code}`)); });
  });
});

after(() => child?.kill());

test('serves index.html at / with an HTML type', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /<title>TrueRate/);
});

test('serves assets with the right content types', async () => {
  for (const [path, type] of [['/app.js', /text\/javascript/], ['/styles.css', /text\/css/], ['/favicon.svg', /image\/svg\+xml/], ['/manifest.webmanifest', /manifest\+json/]]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), type, path);
    await r.arrayBuffer();
  }
});

test('extension-less unknown paths fall back to the app; missing files 404', async () => {
  const spa = await fetch(base + '/usd-to-pkr');
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<title>TrueRate/);
  const missing = await fetch(base + '/nope.png');
  assert.equal(missing.status, 404);
  await missing.text();
});

test('path traversal cannot escape public/', async () => {
  for (const p of ['/..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..%5cpackage.json']) {
    const r = await fetch(base + p);
    const text = await r.text();
    assert.ok(!text.includes('"name": "truerate"'), `${p} leaked package.json`);
  }
});

test('a malformed URL gets 400 and the server stays up', async () => {
  const bad = await fetch(base + '/%E0%A4%A');
  assert.equal(bad.status, 400);
  await bad.text();
  const ok = await fetch(base + '/api/health');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});

test('API is routed through the shared handler', async () => {
  const r = await fetch(base + '/api', { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('every response carries the security headers', async () => {
  for (const path of ['/', '/app.js', '/api/health', '/nope.png']) {
    const r = await fetch(base + path);
    await r.arrayBuffer();
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', path);
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
    assert.match(r.headers.get('strict-transport-security') ?? '', /max-age=31536000/, path);
    const csp = r.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.match(csp, /script-src 'self'(;|$)/, `${path} script-src must stay strict`);
    assert.ok(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), `${path} script-src allows inline or eval`);
  }
});
