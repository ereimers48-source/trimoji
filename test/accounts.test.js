import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Stripe from 'stripe';
import { GET as verifyGet } from '../api/auth/verify.js';
import { POST as requestPost } from '../api/auth/request.js';
import { POST as checkoutPost } from '../api/checkout.js';
import {
  RATE_MESSAGE,
  SEND_FAILURE,
  SESSION_MAX_AGE,
  SIGNIN_MESSAGE,
  TOKEN_TTL_MS,
  hashEmail,
  hashToken,
  presentOrder,
  sessionCookieHeader,
  signSession,
  verifySession,
} from '../lib/accounts.js';
import { accountDocument, accountsPublic, comingSoonAccountDocument } from '../lib/accounts-page.js';
import {
  appendCheckoutOrder,
  createMemoryAccountStore,
  deleteAccount,
  readAccount,
  requestSignIn,
  verifySignIn,
} from '../lib/accounts-store.js';
import { createCheckoutSession } from '../lib/checkout.js';
import { fetchPrintfulOrderStatus, printfulExternalId } from '../lib/printful.js';
import { runtime } from '../lib/runtime.js';
import { deliverSignIn, signInMessage, smtpConfig } from '../lib/mailer.js';
import { handleStripeWebhook } from '../lib/webhook.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const SITE = 'https://trimojiapparel.com';
const NOW = Date.parse('2026-10-24T15:00:00.000Z');

function mailer() {
  const messages = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    },
  };
}

function env() {
  return { SESSION_SECRET: SECRET, SITE_URL: SITE, SMTP_FROM: 'hello@trimojiapparel.com' };
}

function tokenFrom(message) {
  const link = message.text.match(/https?:\/\/\S+/)[0];
  return new URL(link).searchParams.get('token');
}

test('sign-in tokens are hashed, expire, and work once', async () => {
  const store = createMemoryAccountStore();
  const sent = mailer();
  await requestSignIn({
    email: 'Ada@Example.com',
    store,
    now: NOW,
    env: env(),
    mailer: sent,
    ip: '1.1.1.1',
  });
  const token = tokenFrom(sent.messages[0]);
  assert.equal(token.length >= 43, true);
  assert.equal(await store.getToken(token), null);
  const record = await store.getToken(hashToken(token));
  assert.equal(record.email, 'ada@example.com');
  assert.equal(record.expiresAt, NOW + TOKEN_TTL_MS);
  assert.equal(JSON.stringify(record).includes(token), false);
  const expired = await verifySignIn({ token, store, env: env(), now: record.expiresAt, secure: false });
  assert.equal(expired.ok, false);
  await requestSignIn({
    email: 'ada@example.com',
    store,
    now: NOW,
    env: env(),
    mailer: sent,
    ip: '1.1.1.2',
  });
  const fresh = tokenFrom(sent.messages.at(-1));
  const ok = await verifySignIn({ token: fresh, store, env: env(), now: NOW + 1000, secure: false });
  assert.equal(ok.ok, true);
  assert.match(ok.cookie, /HttpOnly/);
  assert.match(ok.cookie, /SameSite=Lax/);
  assert.match(ok.cookie, new RegExp(`Max-Age=${SESSION_MAX_AGE}`));
  assert.doesNotMatch(ok.cookie, /Secure/);
  assert.equal(await store.getToken(hashToken(fresh)), null);
  const again = await verifySignIn({ token: fresh, store, env: env(), now: NOW + 1000, secure: false });
  assert.equal(again.ok, false);
  const user = await store.getUser(hashEmail('ada@example.com'));
  assert.equal(user.email, 'ada@example.com');
  assert.equal(Object.hasOwn(user, 'password'), false);
});

test('session cookies reject tampering and expired or cross-signed values', () => {
  const token = signSession('ada@example.com', SECRET, NOW);
  const session = verifySession(token, SECRET, NOW + 1000);
  assert.equal(session.email, 'ada@example.com');
  assert.equal(session.exp, NOW + SESSION_MAX_AGE * 1000);
  const [payload, sig] = token.split('.');
  const flipped = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}.${sig}`;
  assert.equal(verifySession(flipped, SECRET, NOW + 1000), null);
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  data.email = 'other@example.com';
  const forged = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`;
  assert.equal(verifySession(forged, SECRET, NOW + 1000), null);
  assert.equal(verifySession(token, `${SECRET}nope`, NOW + 1000), null);
  assert.equal(verifySession(token, SECRET, session.exp), null);
  assert.match(sessionCookieHeader(token, { secure: true }), /Secure/);
  assert.match(sessionCookieHeader(token, { secure: true }), /HttpOnly/);
  assert.doesNotMatch(sessionCookieHeader(token, { secure: false }), /Secure/);
});

test('https verify sets a Secure cookie and http does not', async () => {
  const store = createMemoryAccountStore();
  const sent = mailer();
  const previousAccount = runtime.accountStore;
  const previousMailer = runtime.mailer;
  const previousSecret = process.env.SESSION_SECRET;
  const previousSite = process.env.SITE_URL;
  runtime.accountStore = store;
  runtime.mailer = sent;
  process.env.SESSION_SECRET = SECRET;
  process.env.SITE_URL = 'http://127.0.0.1:4173';
  try {
    const issued = Date.now();
    await requestSignIn({ email: 'ada@example.com', store, now: issued, env: env(), mailer: sent, ip: '9.9.9.9' });
    const token = tokenFrom(sent.messages[0]);
    const secure = await verifyGet(new Request(`http://127.0.0.1:4173/api/auth/verify?token=${token}`, {
      headers: { 'x-forwarded-proto': 'https' },
    }));
    assert.equal(secure.status, 303);
    assert.match(secure.headers.get('set-cookie'), /Secure/);
    assert.match(secure.headers.get('set-cookie'), /HttpOnly/);
    assert.match(secure.headers.get('set-cookie'), /SameSite=Lax/);
    await requestSignIn({ email: 'ada@example.com', store, now: issued, env: env(), mailer: sent, ip: '9.9.9.10' });
    const plain = await verifyGet(new Request(`http://127.0.0.1:4173/api/auth/verify?token=${tokenFrom(sent.messages.at(-1))}`));
    assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/);
    const https = await verifySignIn({
      token: 'unused-token-value-that-is-long-enough-to-look-real',
      store,
      env: env(),
      now: NOW,
      secure: true,
    });
    assert.equal(https.ok, false);
  } finally {
    runtime.accountStore = previousAccount;
    runtime.mailer = previousMailer;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSite;
  }
});

test('sign-in responses do not reveal whether an email exists', async () => {
  const store = createMemoryAccountStore();
  await store.putUser(hashEmail('known@example.com'), {
    email: 'known@example.com', name: '', address: null, designs: [], orders: [],
  });
  const sent = mailer();
  const known = await requestSignIn({
    email: 'known@example.com', store, now: NOW, env: env(), mailer: sent, ip: '2.2.2.2',
  });
  const unknown = await requestSignIn({
    email: 'unknown@example.com', store, now: NOW, env: env(), mailer: sent, ip: '2.2.2.3',
  });
  assert.deepEqual(known, unknown);
  assert.equal(known.message, SIGNIN_MESSAGE);
  assert.equal(JSON.stringify(known).includes('known'), false);
  assert.equal(sent.messages[0].to, 'known@example.com');
  assert.equal(sent.messages[1].to, 'unknown@example.com');
  const logs = [];
  const original = console.error;
  console.error = (message) => logs.push(String(message));
  const previousAccount = runtime.accountStore;
  const previousMailer = runtime.mailer;
  const saved = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'RESEND_API_KEY', 'SESSION_SECRET', 'SITE_URL']
    .map((key) => [key, process.env[key]]);
  runtime.accountStore = store;
  runtime.mailer = null;
  process.env.SESSION_SECRET = SECRET;
  process.env.SITE_URL = SITE;
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'RESEND_API_KEY']) delete process.env[key];
  try {
    const first = await requestPost(new Request('http://127.0.0.1:4173/api/auth/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:4173',
        'x-trimoji-request': '1',
      },
      body: JSON.stringify({ email: 'known@example.com' }),
    }));
    const second = await requestPost(new Request('http://127.0.0.1:4173/api/auth/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:4173',
        'x-trimoji-request': '1',
      },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    }));
    assert.equal(first.status, 503);
    assert.equal(second.status, 503);
    assert.deepEqual(await first.json(), await second.json());
    assert.equal(JSON.stringify(logs).includes('known@example.com'), false);
    assert.equal(JSON.stringify(logs).includes('nobody@example.com'), false);
    assert.equal(smtpConfig({}), null);
  } finally {
    console.error = original;
    runtime.accountStore = previousAccount;
    runtime.mailer = previousMailer;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('sign-in requests are limited per IP and per email', async () => {
  const byIp = createMemoryAccountStore();
  const sent = mailer();
  for (let index = 0; index < 5; index += 1) {
    await requestSignIn({
      email: `person${index}@example.com`,
      store: byIp,
      now: NOW + index,
      env: env(),
      mailer: sent,
      ip: '4.4.4.4',
    });
  }
  await assert.rejects(
    () => requestSignIn({
      email: 'other@example.com', store: byIp, now: NOW, env: env(), mailer: sent, ip: '4.4.4.4',
    }),
    (err) => err.status === 429 && err.message === RATE_MESSAGE && !err.message.includes('@'),
  );
  const byEmail = createMemoryAccountStore();
  for (let index = 0; index < 5; index += 1) {
    await requestSignIn({
      email: 'repeat@example.com',
      store: byEmail,
      now: NOW + index,
      env: env(),
      mailer: sent,
      ip: `5.5.5.${index}`,
    });
  }
  await assert.rejects(
    () => requestSignIn({
      email: 'repeat@example.com', store: byEmail, now: NOW, env: env(), mailer: sent, ip: '8.8.8.8',
    }),
    (err) => err.status === 429 && err.message === RATE_MESSAGE,
  );
});

test('state-changing account routes require same-origin and a custom header', async () => {
  const blocked = await requestPost(new Request('http://127.0.0.1:4173/api/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4173' },
    body: JSON.stringify({ email: 'ada@example.com' }),
  }));
  assert.equal(blocked.status, 403);
  const foreign = await requestPost(new Request('http://127.0.0.1:4173/api/auth/request', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example',
      'x-trimoji-request': '1',
    },
    body: JSON.stringify({ email: 'ada@example.com' }),
  }));
  assert.equal(foreign.status, 403);
  const html = signInMessage({
    to: 'ada@example.com',
    link: 'https://trimojiapparel.com/api/auth/verify?token=abc<script>',
    from: 'Trimoji <hello@trimojiapparel.com>',
  });
  assert.equal(html.html.includes('<script>'), false);
  assert.match(html.html, /Sign in to Trimoji/);
  assert.match(html.text, /works once/);
});

test('a paid order is appended once and delete removes the account', async () => {
  const stripe = {
    calls: [],
    checkout: { sessions: { async create(params) { this.calls.push(params); return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }; } } },
  };
  stripe.checkout.sessions.create = stripe.checkout.sessions.create.bind(stripe);
  await createCheckoutSession({
    items: [{
      product: 'tee', color: 'Black', size: 'L', quantity: 1,
      emojis: ['🔥', null, '🍕'], slots: ['🔥', null, '🍕'], layout: 'row', logoSize: 100,
    }],
    stripe,
    siteUrl: SITE,
  });
  assert.equal(Object.hasOwn(stripe.calls[0], 'customer_email'), false);
  const emailed = await createCheckoutSession({
    items: [{
      product: 'tee', color: 'Black', size: 'L', quantity: 1,
      emojis: ['🔥', null, '🍕'], layout: 'row', logoSize: 100,
    }],
    stripe,
    siteUrl: SITE,
    customerEmail: 'ada@example.com',
  });
  assert.equal(emailed.url.includes('checkout.stripe.com'), true);
  assert.equal(stripe.calls[1].customer_email, 'ada@example.com');

  const metadata = stripe.calls[0].metadata;
  const session = {
    id: 'cs_test_123',
    object: 'checkout.session',
    amount_total: 3499,
    metadata,
    customer_details: { email: 'Ada@Example.com', name: 'Ada Lovelace' },
    shipping_details: {
      name: 'Ada Lovelace',
      address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
    },
  };
  const store = createMemoryAccountStore();
  const envVars = {
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_value',
    PRINTFUL_API_TOKEN: 'pf_secret_marker',
    PRINTFUL_STORE_ID: '18937301',
    SITE_URL: SITE,
  };
  const payload = JSON.stringify({
    id: 'evt_account', object: 'event', type: 'checkout.session.completed', data: { object: session },
  });
  const stripeLib = new Stripe('sk_test_placeholder');
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: envVars.STRIPE_WEBHOOK_SECRET });
  const fetchImpl = async () => new Response(JSON.stringify({ code: 200, result: { id: 99, status: 'draft' } }), { status: 200 });
  const ok = await handleStripeWebhook({
    rawBody: payload, signature: header, env: envVars, stripe: stripeLib, fetchImpl, accountStore: store,
  });
  assert.equal(ok.printfulOrderId, 99);
  const record = await store.getUser(hashEmail('ada@example.com'));
  assert.equal(record.orders.length, 1);
  const order = record.orders[0];
  assert.equal(order.reference, printfulExternalId('cs_test_123'));
  assert.equal(order.shipping.city, 'Austin');
  assert.equal(order.shipping.state, 'TX');
  assert.equal(order.printfulOrderId, 99);
  assert.deepEqual(order.items[0].emojis, ['🔥', null, '🍕']);
  const packed = JSON.stringify(order);
  assert.equal(packed.includes('Main'), false);
  assert.equal(packed.includes('78701'), false);
  assert.equal(packed.includes('@'), false);
  assert.equal(packed.includes('pf_secret_marker'), false);
  const duplicate = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env: envVars,
    stripe: stripeLib,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: 'Order with External ID already exists' },
    }), { status: 400 }),
    accountStore: store,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal((await store.getUser(hashEmail('ada@example.com'))).orders.length, 1);

  const broken = {
    ...store,
    async putUser() {
      throw new Error('blob down for ada@example.com');
    },
  };
  const logs = [];
  const original = console.error;
  console.error = (message) => logs.push(String(message));
  try {
    const still = await handleStripeWebhook({
      rawBody: payload, signature: header, env: envVars, stripe: stripeLib, fetchImpl, accountStore: broken,
    });
    assert.equal(still.received, true);
    assert.equal(still.printfulOrderId, 99);
    assert.equal(JSON.stringify(logs).includes('ada@example.com'), false);
  } finally {
    console.error = original;
  }

  const live = await fetchPrintfulOrderStatus(99, {
    token: 'pf_secret_marker',
    storeId: '18937301',
    fetchImpl: async () => new Response(JSON.stringify({
      result: {
        status: 'fulfilled',
        secret: 'do-not-leak',
        shipments: [{ carrier: 'USPS', tracking_number: 'TRACK123', tracking_url: 'https://example.com/track/TRACK123' }],
      },
    }), { status: 200 }),
  });
  assert.equal(live.secret, undefined);
  const view = await readAccount({ email: 'ada@example.com', iat: NOW, exp: NOW + 1000 }, store, {
    token: 'pf_secret_marker',
    storeId: '18937301',
    fetchImpl: async () => new Response(JSON.stringify({
      result: { status: 'fulfilled', shipments: live.shipments },
    }), { status: 200 }),
  });
  assert.equal(view.orders[0].status, 'Shipped');
  assert.equal(view.orders[0].tracking[0].url, 'https://example.com/track/TRACK123');
  assert.equal(JSON.stringify(view).includes('pf_secret_marker'), false);
  assert.equal(JSON.stringify(view).includes('printfulOrderId'), false);
  assert.equal(JSON.stringify(view).includes('do-not-leak'), false);
  assert.deepEqual(Object.keys(presentOrder(order)).sort(), ['createdAt', 'currency', 'items', 'reference', 'shipping', 'status', 'total', 'tracking']);

  const cookieSession = { email: 'ada@example.com', iat: NOW, exp: NOW + 1000 };
  await deleteAccount(cookieSession, store, NOW + 5000);
  assert.equal(await store.getUser(hashEmail('ada@example.com')), null);
  const after = await readAccount(cookieSession, store, {});
  assert.deepEqual(after, { signedIn: false });
  const sent = mailer();
  const next = await requestSignIn({
    email: 'ada@example.com', store, now: NOW + 8000, env: env(), mailer: sent, ip: '6.6.6.6',
  });
  assert.equal(next.message, SIGNIN_MESSAGE);
  const revived = await verifySignIn({
    token: tokenFrom(sent.messages[0]), store, env: env(), now: NOW + 9000, secure: true,
  });
  assert.equal(revived.ok, true);
  assert.match(revived.cookie, /Secure/);
});

test('account pages stay private until ACCOUNTS_PUBLIC is on', () => {
  assert.equal(accountsPublic({}), false);
  assert.equal(accountsPublic({ ACCOUNTS_PUBLIC: 'true' }), true);
  const account = readFileSync(new URL('../account.html', import.meta.url), 'utf8');
  assert.match(account, /Email me a sign-in link/);
  assert.match(account, /Delete my account and data/);
  assert.match(account, /data-account-robots/);
  assert.match(account, /We do not store a password/);
  const hidden = accountDocument(account, {});
  assert.match(hidden, /data-account-robots/);
  assert.match(hidden, /data-shop="\/shop-preview"/);
  const opened = accountDocument(account, { ACCOUNTS_PUBLIC: 'true', COMING_SOON: 'false' });
  assert.equal(opened.includes('data-account-robots'), false);
  assert.match(opened, /data-shop="\/"/);
  const soon = '<nav aria-label="Policies"><a href="/contact">Contact</a></nav>';
  assert.equal(comingSoonAccountDocument(soon, {}), soon);
  assert.match(comingSoonAccountDocument(soon, { ACCOUNTS_PUBLIC: 'yes' }), /href="\/account"/);
  const withStories = soon.replace('</nav>', '<a href="/stories">Stories</a></nav>');
  const both = comingSoonAccountDocument(withStories, { ACCOUNTS_PUBLIC: '1' });
  assert.match(both, /Stories<\/a><a href="\/account">Account<\/a>/);
  const coming = readFileSync(new URL('../coming-soon.html', import.meta.url), 'utf8');
  assert.doesNotMatch(coming, /href="\/account"/);
  const shop = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(shop, /<a href="\/account">Account<\/a>/);
  assert.match(shop, /Save design/);
  assert.match(shop, /function all\(\)\{slots\(\);controls\(\);draw\(\);syncProduct\(\)\}/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const name of ['SESSION_SECRET', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'ACCOUNTS_PUBLIC']) {
    assert.match(readme, new RegExp(name));
  }
});

test('checkout uses the signed-in email from the session cookie', async () => {
  const previous = {
    key: process.env.STRIPE_SECRET_KEY,
    secret: process.env.SESSION_SECRET,
    stripe: runtime.createStripe,
    store: runtime.accountStore,
  };
  const store = createMemoryAccountStore();
  runtime.accountStore = store;
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  process.env.SESSION_SECRET = SECRET;
  const calls = [];
  runtime.createStripe = () => ({
    checkout: { sessions: { async create(params) { calls.push(params); return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }; } } },
  });
  try {
    const cookie = signSession('ada@example.com', SECRET, NOW);
    await store.putUser(hashEmail('ada@example.com'), {
      email: 'ada@example.com', name: '', address: null, designs: [], orders: [],
    });
    const response = await checkoutPost(new Request('http://127.0.0.1:4173/api/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:4173',
        cookie: `trimoji_session=${cookie}`,
      },
      body: JSON.stringify({
        items: [{
          product: 'tee', color: 'Black', size: 'L', quantity: 1,
          emojis: ['🔥', '😎', '🍕'], layout: 'row', logoSize: 100,
        }],
      }),
    }));
    assert.equal(response.status, 200);
    assert.equal(calls[0].customer_email, 'ada@example.com');
    await appendCheckoutOrder(store, {
      amount_total: 1,
      metadata: calls[0].metadata,
      customer_details: { email: 'ada@example.com' },
    }, { external_id: 'abc', recipient: { city: 'Austin', state_code: 'TX', address1: '1 Main St' } }, { result: { id: 5, status: 'draft' } });
    const saved = await store.getUser(hashEmail('ada@example.com'));
    assert.equal(saved.orders[0].shipping.city, 'Austin');
    assert.equal(JSON.stringify(saved.orders[0]).includes('Main'), false);
  } finally {
    runtime.createStripe = previous.stripe;
    runtime.accountStore = previous.store;
    if (previous.key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous.secret;
  }
});

function captureErrors(fn) {
  const logs = [];
  const original = console.error;
  console.error = (message) => logs.push(String(message));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = original;
    })
    .then(() => logs);
}

test('RESEND_API_KEY sends the sign-in message and SMTP stays the fallback', async () => {
  const store = createMemoryAccountStore();
  const previousFetch = runtime.fetch;
  const previousGlobal = globalThis.fetch;
  const calls = [];
  const key = 're_test_key_marker';
  runtime.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'email_123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const sent = await requestSignIn({
      email: 'Ada@Example.com',
      store,
      now: NOW,
      env: { SESSION_SECRET: SECRET, SITE_URL: SITE, RESEND_API_KEY: key },
      ip: '7.7.7.1',
    });
    assert.equal(sent.message, SIGNIN_MESSAGE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.match(calls[0].options.headers['Idempotency-Key'], /^sign-in\/[a-f0-9]{64}$/);
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'reply_to', 'subject', 'text', 'to']);
    assert.equal(body.from, 'Trimoji <hello@trimojiapparel.com>');
    assert.equal(body.to, 'ada@example.com');
    assert.equal(body.subject, 'Sign in to Trimoji');
    assert.equal(body.reply_to, 'hello@trimojiapparel.com');
    const link = body.text.match(/https?:\/\/\S+/)[0];
    const expected = signInMessage({ to: body.to, link, from: body.from });
    assert.equal(body.text, expected.text);
    assert.equal(body.html, expected.html);
    assert.equal(calls[0].options.headers['Idempotency-Key'].includes(new URL(link).searchParams.get('token')), false);
    const verified = await verifySignIn({
      token: new URL(link).searchParams.get('token'),
      store,
      env: env(),
      now: NOW + 1000,
      secure: true,
    });
    assert.equal(verified.ok, true);

    calls.length = 0;
    await requestSignIn({
      email: 'from@example.com',
      store,
      now: NOW,
      env: {
        SESSION_SECRET: SECRET,
        SITE_URL: SITE,
        RESEND_API_KEY: `  ${key}  `,
        SMTP_FROM: 'Studio <orders@trimojiapparel.com>',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1',
        SMTP_USER: 'smtp-user',
        SMTP_PASS: 'smtp-secret-pass',
      },
      ip: '7.7.7.2',
    });
    const named = JSON.parse(calls[0].options.body);
    assert.equal(named.from, 'Studio <orders@trimojiapparel.com>');
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);

    calls.length = 0;
    await deliverSignIn({
      to: 'bare@example.com',
      link: 'https://trimojiapparel.com/api/auth/verify?token=abc',
      env: { RESEND_API_KEY: key, SMTP_FROM: 'orders@trimojiapparel.com' },
    });
    assert.equal(JSON.parse(calls[0].options.body).from, 'Trimoji <orders@trimojiapparel.com>');

    calls.length = 0;
    await deliverSignIn({
      to: 'bad-from@example.com',
      link: 'https://trimojiapparel.com/api/auth/verify?token=abc',
      env: { RESEND_API_KEY: key, SMTP_FROM: 'not an email' },
    });
    assert.equal(JSON.parse(calls[0].options.body).from, 'Trimoji <hello@trimojiapparel.com>');

    const injected = mailer();
    calls.length = 0;
    await requestSignIn({
      email: 'ada@example.com',
      store,
      now: NOW,
      env: { ...env(), RESEND_API_KEY: key },
      mailer: injected,
      ip: '7.7.7.3',
    });
    assert.equal(calls.length, 0);
    assert.equal(injected.messages[0].from, 'Trimoji <hello@trimojiapparel.com>');
    assert.equal(injected.messages[0].to, 'ada@example.com');

    runtime.fetch = undefined;
    const globalCalls = [];
    globalThis.fetch = async (url, options) => {
      globalCalls.push({ url, options });
      return new Response(JSON.stringify({ id: 'email_456' }), { status: 200 });
    };
    await deliverSignIn({
      to: 'global@example.com',
      link: 'https://trimojiapparel.com/api/auth/verify?token=abc',
      env: { RESEND_API_KEY: key },
    });
    assert.equal(globalCalls[0].url, 'https://api.resend.com/emails');
    assert.equal(globalCalls[0].options.headers.Authorization, `Bearer ${key}`);
  } finally {
    runtime.fetch = previousFetch;
    globalThis.fetch = previousGlobal;
  }
});

test('mail failures stay generic and log only the provider status and error name', async () => {
  const store = createMemoryAccountStore();
  const previousFetch = runtime.fetch;
  const key = 're_secret_marker';
  const raw = 'fixed-token-value-that-is-long-enough-0123456789abcd';
  runtime.fetch = async () => new Response(JSON.stringify({
    name: 'validation_error',
    message: `Invalid to ada@example.com key ${key} <html>BODYMARKER</html>`,
  }), { status: 422, headers: { 'content-type': 'application/json' } });
  try {
    const logs = await captureErrors(async () => {
      await assert.rejects(
        () => requestSignIn({
          email: 'ada@example.com',
          store,
          now: NOW,
          env: { SESSION_SECRET: SECRET, SITE_URL: SITE, RESEND_API_KEY: key },
          ip: '7.7.7.4',
          token: raw,
        }),
        (err) => err.status === 503 && err.message === SEND_FAILURE && !err.message.includes(key),
      );
    });
    assert.deepEqual(logs, ['sign-in mail failed via resend status=422 name=validation_error']);
    assert.equal(logs.join('\n').includes(key), false);
    assert.equal(logs.join('\n').includes('ada@example.com'), false);
    assert.equal(logs.join('\n').includes('BODYMARKER'), false);
    assert.equal(logs.join('\n').includes(raw), false);
    assert.equal(await store.getToken(hashToken(raw)), null);

    runtime.fetch = async () => new Response(`plain ${key} BODYMARKER ada@example.com`, { status: 500 });
    const plainLogs = await captureErrors(() => assert.rejects(
      () => deliverSignIn({
        to: 'ada@example.com',
        link: `https://trimojiapparel.com/api/auth/verify?token=${raw}`,
        env: { RESEND_API_KEY: key },
      }),
      (err) => err.status === 503 && err.message === SEND_FAILURE,
    ));
    assert.deepEqual(plainLogs, ['sign-in mail failed via resend status=500 name=Error']);

    runtime.fetch = async () => new Response(JSON.stringify({ name: key, message: `body ${key}` }), { status: 401 });
    const secretLogs = await captureErrors(() => assert.rejects(
      () => deliverSignIn({
        to: 'ada@example.com',
        link: `https://trimojiapparel.com/api/auth/verify?token=${raw}`,
        env: { RESEND_API_KEY: key },
      }),
      (err) => err.status === 503 && err.message === SEND_FAILURE && !err.message.includes(key),
    ));
    assert.deepEqual(secretLogs, ['sign-in mail failed via resend status=401 name=unknown']);
    assert.equal(secretLogs.join('\n').includes(key), false);

    const network = new TypeError(`connect failed ${key} ada@example.com BODYMARKER`);
    network.code = 'ECONNRESET';
    runtime.fetch = async () => { throw network; };
    const networkLogs = await captureErrors(() => assert.rejects(
      () => deliverSignIn({
        to: 'ada@example.com',
        link: `https://trimojiapparel.com/api/auth/verify?token=${raw}`,
        env: { RESEND_API_KEY: key },
      }),
      (err) => err.status === 503 && err.message === SEND_FAILURE,
    ));
    assert.deepEqual(networkLogs, ['sign-in mail failed via resend status=none name=TypeError code=ECONNRESET']);

    let called = false;
    runtime.fetch = async () => { called = true; return new Response('no', { status: 500 }); };
    const smtpLogs = await captureErrors(() => assert.rejects(
      () => requestSignIn({
        email: 'ada@example.com',
        store,
        now: NOW,
        env: {
          SESSION_SECRET: SECRET,
          SITE_URL: SITE,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1',
          SMTP_USER: 'smtp-user',
          SMTP_PASS: 'smtp-secret-pass',
          SMTP_FROM: 'hello@trimojiapparel.com',
        },
        ip: '7.7.7.5',
        token: raw,
      }),
      (err) => err.status === 503 && err.message === SEND_FAILURE && !err.message.includes('smtp-secret-pass'),
    ));
    assert.equal(called, false);
    assert.deepEqual(smtpLogs, ['sign-in mail failed via smtp name=Error code=ESOCKET']);
    assert.equal(smtpLogs.join('\n').includes('smtp-secret-pass'), false);
    assert.equal(smtpLogs.join('\n').includes('ada@example.com'), false);
    assert.equal(await store.getToken(hashToken(raw)), null);

    called = false;
    await assert.rejects(
      () => requestSignIn({
        email: 'ada@example.com',
        store,
        now: NOW,
        env: { ...env(), RESEND_API_KEY: '   ' },
        ip: '7.7.7.6',
        token: raw,
      }),
      (err) => err.status === 503 && err.message === SEND_FAILURE,
    );
    assert.equal(called, false);
    assert.equal(await store.getToken(hashToken(raw)), null);
  } finally {
    runtime.fetch = previousFetch;
  }
});
