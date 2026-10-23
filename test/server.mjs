import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1:4173');
    if (url.pathname === '/api/config' && req.method === 'GET') {
      await send(res, await configGet());
      return;
    }
    if (url.pathname === '/api/checkout' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await send(res, await checkoutPost(new Request(url, {
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
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(`${root}/`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
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
