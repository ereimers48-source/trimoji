import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeRequest } from '../lib/coming-soon.js';
import { pageRedirect } from '../lib/redirect.js';

process.env.STRIPE_SECRET_KEY = 'sk_test_playwright';
process.env.SITE_URL = 'http://127.0.0.1:4173';

const { runtime } = await import('../lib/runtime.js');
runtime.createStripe = () => ({
  checkout: {
    sessions: {
      async create() {
        return {
          id: 'cs_test_playwright',
          url: 'https://checkout.stripe.com/c/pay/cs_test_playwright',
        };
      },
    },
  },
});

const { GET: configGet } = await import('../api/config.js');
const { POST: checkoutPost } = await import('../api/checkout.js');
const { POST: waitlistPost } = await import('../api/waitlist.js');

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function send(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const cleanPages = {
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/shipping': 'shipping.html',
  '/returns': 'returns.html',
  '/contact': 'contact.html',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1:4173');
    const redirect = pageRedirect(req.headers.host, url.pathname);
    if (redirect) {
      res.writeHead(308, { location: redirect + url.search });
      res.end();
      return;
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      await send(res, await configGet());
      return;
    }
    if ((url.pathname === '/api/checkout' || url.pathname === '/api/waitlist') && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const handler = url.pathname === '/api/waitlist' ? waitlistPost : checkoutPost;
      await send(res, await handler(new Request(url, {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
        body: Buffer.concat(chunks),
      })));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const route = routeRequest(url.pathname);
    if (route.type === 'missing') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('not found');
      return;
    }
    const rel = route.type === 'file'
      ? route.file
      : (cleanPages[url.pathname] || decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(`${root}/`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    let data = await readFile(file);
    const headers = { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (route.robots) {
      headers['x-robots-tag'] = route.robots;
      if (extname(file) === '.html') {
        const html = data.toString('utf8').replace('</head>', `<meta name="robots" content="${route.robots}">\n</head>`);
        data = Buffer.from(html);
        headers['content-type'] = 'text/html; charset=utf-8';
      }
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    console.error(err);
    res.writeHead(500);
    res.end('error');
  }
});

server.listen(4173, '127.0.0.1');
