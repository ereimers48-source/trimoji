import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashEmail, sessionCookieHeader, sessionFromRequest, signSession } from '../lib/accounts.js';
import { accountDocument, accountsPublic, comingSoonAccountDocument } from '../lib/accounts-page.js';
import { routeRequest } from '../lib/coming-soon.js';
import { metadataForItems, normalizeCart } from '../lib/design.js';
import { pageRedirect } from '../lib/redirect.js';
import { comingSoonDocument, storiesDocument, storiesPublic } from '../lib/stories-page.js';

process.env.STRIPE_SECRET_KEY = 'sk_test_playwright';
process.env.SITE_URL = 'http://127.0.0.1:4173';
process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef';
process.env.PRINTFUL_API_TOKEN = 'pf_test_playwright';
process.env.PRINTFUL_STORE_ID = '18937301';

const { runtime } = await import('../lib/runtime.js');
const { createMemoryStore } = await import('../lib/stories-store.js');
const { createMemoryAccountStore } = await import('../lib/accounts-store.js');
process.env.STORIES_ADMIN_TOKEN = 'test-admin-token';
runtime.storiesStore = createMemoryStore({ limit: 1000 });
runtime.accountStore = createMemoryAccountStore({ limit: 1000 });
runtime.sentMail = [];
runtime.mailer = {
  async send(message) {
    runtime.sentMail.push({
      to: message.to,
      from: message.from,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  },
};
const realFetch = runtime.fetch;
runtime.fetch = async (url, init) => {
  const href = String(url);
  if (href.includes('cdn.jsdelivr.net') && href.endsWith('.svg')) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#ffcc4d"/></svg>';
    return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } });
  }
  return realFetch(url, init);
};
runtime.accountPrintfulFetch = async () => new Response(JSON.stringify({
  result: {
    status: 'fulfilled',
    shipments: [{
      carrier: 'USPS',
      tracking_number: 'TRACK123',
      tracking_url: 'https://example.com/track/TRACK123',
    }],
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });
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
          amount_total: 3716,
          currency: 'usd',
          total_details: { amount_tax: 217, amount_shipping: 599 },
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
const { POST: authRequestPost } = await import('../api/auth/request.js');
const { GET: authVerifyGet } = await import('../api/auth/verify.js');
const { POST: authSignoutPost } = await import('../api/auth/signout.js');
const { GET: accountGet, POST: accountPost } = await import('../api/account.js');
const { POST: accountDeletePost } = await import('../api/account/delete.js');
const { POST: designsPost } = await import('../api/account/designs.js');
const { POST: designsRemovePost } = await import('../api/account/designs/remove.js');
const { GET: previewGet } = await import('../api/account/preview.js');

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
  '/account': 'account.html',
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
    if (url.pathname === '/api/test/order' && req.method === 'POST') {
      const request = await toRequest(req, url);
      const session = sessionFromRequest(request);
      if (!session) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Sign in required' }));
        return;
      }
      const hash = hashEmail(session.email);
      const record = await runtime.accountStore.getUser(hash);
      if (!record) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Sign in required' }));
        return;
      }
      record.orders = Array.isArray(record.orders) ? record.orders : [];
      record.orders.push({
        reference: 'abc123abc123abc123abc123abc123ab',
        items: [{ name: 'T-shirt', emojis: ['🔥', null, '🍕'], color: 'Black', size: 'L', quantity: 1 }],
        total: 3499,
        currency: 'usd',
        shipping: { city: 'Austin', state: 'TX' },
        status: 'draft',
        createdAt: '2026-10-24T15:04:00.000Z',
        printfulOrderId: 4242,
      });
      await runtime.accountStore.putUser(hash, record);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/api/test/inbox' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ messages: runtime.sentMail }));
      return;
    }
    if (url.pathname === '/api/test/seed' && req.method === 'POST') {
      const request = await toRequest(req, url);
      const body = await request.json().catch(() => ({}));
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Enter a valid email.' }));
        return;
      }
      const record = {
        email,
        name: 'Sample Sam',
        address: {
          name: 'Sample Sam',
          line1: '1 Preview Way',
          line2: '',
          city: 'Austin',
          state: 'TX',
          postalCode: '78701',
        },
        designs: [{
          id: '11111111-1111-4111-8111-111111111111',
          slots: ['🔥', null, '🍕'],
          product: 'tee',
          color: 'Black',
          size: 'L',
          layout: 'row',
          logoSize: 100,
          createdAt: '2026-10-24T15:00:00.000Z',
        }],
        orders: [{
          reference: 'abc123abc123abc123abc123abc123ab',
          items: [{ name: 'T-shirt', emojis: ['🔥', null, '🍕'], color: 'Black', size: 'L', quantity: 1 }],
          total: 3499,
          currency: 'usd',
          shipping: { city: 'Austin', state: 'TX' },
          status: 'draft',
          createdAt: '2026-10-24T15:04:00.000Z',
          printfulOrderId: 4242,
        }],
      };
      await runtime.accountStore.putUser(hashEmail(email), record);
      const cookie = sessionCookieHeader(signSession(email, process.env.SESSION_SECRET, Date.now()), { secure: false });
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'set-cookie': cookie,
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const accountRoutes = {
      'POST /api/auth/request': authRequestPost,
      'GET /api/auth/verify': authVerifyGet,
      'POST /api/auth/signout': authSignoutPost,
      'GET /api/account': accountGet,
      'POST /api/account': accountPost,
      'POST /api/account/delete': accountDeletePost,
      'POST /api/account/designs': designsPost,
      'POST /api/account/designs/remove': designsRemovePost,
      'GET /api/account/preview': previewGet,
    };
    const accountHandler = accountRoutes[`${req.method} ${url.pathname}`];
    if (accountHandler) {
      await send(res, await accountHandler(await toRequest(req, url)));
      return;
    }
    if ((url.pathname === '/api/checkout' || url.pathname === '/api/waitlist') && req.method === 'POST') {
      const handler = url.pathname === '/api/waitlist' ? waitlistPost : checkoutPost;
      await send(res, await handler(await toRequest(req, url)));
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
      if (file.endsWith('/account.html')) html = accountDocument(html);
      if (file.endsWith('/coming-soon.html')) html = comingSoonAccountDocument(comingSoonDocument(html));
      if (route.robots) {
        headers['x-robots-tag'] = route.robots;
        html = html.replace('</head>', `<meta name="robots" content="${route.robots}">\n</head>`);
      }
      if (file.endsWith('/stories.html') && !storiesPublic()) headers['x-robots-tag'] = 'noindex, nofollow';
      if (file.endsWith('/account.html') && !accountsPublic()) headers['x-robots-tag'] = 'noindex, nofollow';
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
