import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeRequest } from '../lib/coming-soon.js';
import { metadataForItems, normalizeCart } from '../lib/design.js';
import { pageRedirect } from '../lib/redirect.js';
import { comingSoonDocument, storiesDocument, storiesPublic } from '../lib/stories-page.js';

process.env.STRIPE_SECRET_KEY = 'sk_test_playwright';
process.env.SITE_URL = 'http://127.0.0.1:4173';

const { runtime } = await import('../lib/runtime.js');
const { createMemoryStore } = await import('../lib/stories-store.js');
process.env.STORIES_ADMIN_TOKEN = 'test-admin-token';
runtime.storiesStore = createMemoryStore({ limit: 1000 });
const previewOrder = metadataForItems(normalizeCart([{
  product: 'case',
  color: 'Glossy',
  size: 'iPhone 16',
  quantity: 1,
  emojis: ['🔥', '😎', '🍕'],
  layout: 'row',
  logoSize: 100,
}]));
runtime.createStripe = () => ({
  checkout: {
    sessions: {
      async create() {
        return {
          id: 'cs_test_playwright',
          url: 'https://checkout.stripe.com/c/pay/cs_test_playwright',
        };
      },
      async retrieve(id) {
        if (id !== 'cs_test_playwright') {
          const error = new Error('No such checkout.session');
          error.statusCode = 404;
          error.code = 'resource_missing';
          throw error;
        }
        return {
          id,
          object: 'checkout.session',
          payment_status: 'paid',
          status: 'complete',
          amount_total: 3499,
          currency: 'usd',
          metadata: previewOrder,
          customer_details: { email: 'secret@example.com', name: 'Ada Lovelace' },
          shipping_details: {
            name: 'Ada Lovelace',
            address: {
              line1: '1 Secret St',
              city: 'Austin',
              state: 'TX',
              postal_code: '78701',
              country: 'US',
            },
          },
        };
      },
    },
  },
});

const { GET: configGet } = await import('../api/config.js');
const { GET: orderGet } = await import('../api/order.js');
const { POST: checkoutPost } = await import('../api/checkout.js');
const { POST: waitlistPost } = await import('../api/waitlist.js');
const { GET: storiesGet, POST: storiesPost } = await import('../api/stories.js');
const { GET: storiesPhotoGet } = await import('../api/stories-photo.js');
const { GET: storiesAdminGet, POST: storiesAdminPost } = await import('../api/stories-admin.js');
const { GET: storiesAdminPhotoGet } = await import('../api/stories-admin-photo.js');

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
  '/stories': 'stories.html',
  '/stories-admin': 'stories-admin.html',
};

async function toRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value != null) headers.set(key, String(value));
  }
  const chunks = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req) chunks.push(chunk);
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

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
    if (url.pathname === '/api/order' && req.method === 'GET') {
      await send(res, await orderGet(new Request(url)));
      return;
    }
    if (url.pathname === '/api/stories' && req.method === 'GET') {
      await send(res, await storiesGet(await toRequest(req, url)));
      return;
    }
    if (url.pathname === '/api/stories' && req.method === 'POST') {
      await send(res, await storiesPost(await toRequest(req, url)));
      return;
    }
    if (url.pathname === '/api/stories-photo' && req.method === 'GET') {
      await send(res, await storiesPhotoGet(await toRequest(req, url)));
      return;
    }
    if (url.pathname === '/api/stories-admin' && req.method === 'GET') {
      await send(res, await storiesAdminGet(await toRequest(req, url)));
      return;
    }
    if (url.pathname === '/api/stories-admin' && req.method === 'POST') {
      await send(res, await storiesAdminPost(await toRequest(req, url)));
      return;
    }
    if (url.pathname === '/api/stories-admin-photo' && req.method === 'GET') {
      await send(res, await storiesAdminPhotoGet(await toRequest(req, url)));
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
    const bare = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    const rel = route.type === 'file'
      ? route.file
      : (cleanPages[bare] || decodeURIComponent(bare).replace(/^\/+/, '') || 'index.html');
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(`${root}/`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    let data = await readFile(file);
    const headers = { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (extname(file) === '.html') {
      let html = data.toString('utf8');
      if (file.endsWith('/stories.html')) html = storiesDocument(html);
      if (file.endsWith('/coming-soon.html')) html = comingSoonDocument(html);
      if (route.robots) {
        headers['x-robots-tag'] = route.robots;
        html = html.replace('</head>', `<meta name="robots" content="${route.robots}">\n</head>`);
      }
      if (file.endsWith('/stories.html') && !storiesPublic()) headers['x-robots-tag'] = 'noindex, nofollow';
      if (file.endsWith('/stories-admin.html')) headers['x-robots-tag'] = 'noindex, nofollow';
      data = Buffer.from(html);
      headers['content-type'] = 'text/html; charset=utf-8';
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
