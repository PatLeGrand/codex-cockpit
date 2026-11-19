import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const webRoot = new URL('../web/', import.meta.url);
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);

export async function startServer(store, { port = 0 } = {}) {
  const token = randomBytes(32).toString('hex');
  let origin;
  let refreshing;
  // Share work among tabs, without retaining a snapshot across refreshes.
  const snapshot = id => {
    if (!refreshing) refreshing = store.snapshot().finally(() => { refreshing = null; });
    return id ? refreshing.then(() => store.snapshot(id)) : refreshing;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const fail = (code, message) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: message })); };
    if (req.headers.host !== new URL(origin).host) return fail(403, 'Host refused');
    if (req.headers.origin && req.headers.origin !== origin) return fail(403, 'Origin refused');
    if (req.method !== 'GET') return fail(405, 'GET only');
    const url = new URL(req.url, origin);
    try {
      if (url.pathname === '/api/snapshot') {
        const supplied = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return fail(401, 'Open the URL printed by Cockpit');
        const data = await snapshot(url.searchParams.get('session'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(data));
      }
      const asset = assets.get(url.pathname);
      if (!asset) return fail(404, 'Not found');
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
      res.end(await readFile(fileURLToPath(new URL(asset[0], webRoot))));
    } catch { fail(500, 'Unable to read local sessions'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}/#${token}`, snapshot, close: () => new Promise(resolve => server.close(resolve)) };
}
