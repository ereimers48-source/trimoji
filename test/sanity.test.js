import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Stripe from 'stripe';
import { POST as checkoutPost } from '../api/checkout.js';
import { GET as configGet } from '../api/config.js';
import { GET as printGet } from '../api/print-file.js';
import { POST as webhookPost } from '../api/stripe-webhook.js';
import { publicConfig } from '../lib/config.js';
import { createCheckoutSession } from '../lib/checkout.js';
import { decodeDesign, encodeDesign, itemsFromMetadata } from '../lib/design.js';
import { HttpError } from '../lib/http.js';
import { priceCart } from '../lib/prices.js';
import { buildPrintfulOrder } from '../lib/printful.js';
import { PRINT_PX, renderLogoPng } from '../lib/render.js';
import { runtime } from '../lib/runtime.js';
import { HAT_UNAVAILABLE, resolveVariant } from '../lib/variants.js';
import { handleStripeWebhook } from '../lib/webhook.js';

const SITE = 'https://trimoji.vercel.app';
const SECRET = 'whsec_test_secret';
const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
  <circle cx="18" cy="18" r="16" fill="url(#g)"/>
</svg>`;

function sampleItem(overrides = {}) {
  return {
    product: 'tee',
    color: 'Black',
    size: 'L',
    quantity: 1,
    emojis: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 100,
    background: { shape: 'circle', color: '#fde68a' },
    price: 1,
    ...overrides,
  };
}

function fakeStripe() {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        async create(params) {
          calls.push(params);
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' };
        },
      },
    },
  };
}

function completedSession(metadata) {
  return {
    id: 'cs_test_123',
    object: 'checkout.session',
    metadata,
    customer_details: { email: 'ada@example.com', name: 'Ada Lovelace' },
    shipping_details: {
      name: 'Ada Lovelace',
      address: {
        line1: '1 Main St',
        line2: 'Apt 2',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
      },
    },
  };
}

test('server prices ignore the client and add US shipping under $60', () => {
  const priced = priceCart([sampleItem({ quantity: 2, price: 100 })]);
  assert.equal(priced.lines[0].unitAmount, 2900);
  assert.equal(priced.lines[0].lineAmount, 5800);
  assert.equal(priced.shipping, 599);
  assert.equal(priced.total, 6399);
  const free = priceCart([sampleItem(), sampleItem({ product: 'hoodie', color: 'Navy', size: 'M' })]);
  assert.equal(free.subtotal, 2900 + 5400);
  assert.equal(free.shipping, 0);
});

test('variant map matches the Printful catalog lookup', () => {
  assert.equal(resolveVariant('tee', 'Black', 'L').variantId, 4018);
  assert.equal(resolveVariant('tee', 'Heather', 'S').printfulColor, 'Athletic Heather');
  assert.equal(resolveVariant('hoodie', 'Heather', '2XL').variantId, 5614);
  assert.equal(resolveVariant('hoodie', 'Pink', 'S').variantId, 10849);
  assert.equal(resolveVariant('hoodie', 'Pink', 'S').printfulColor, 'Light Pink');
  assert.deepEqual(resolveVariant('mug', 'White', '11 oz'), {
    variantId: 1320,
    printType: 'default',
    name: 'Mug',
    unitAmount: 1900,
    printfulColor: 'White',
    catalogProductId: 19,
  });
  assert.throws(() => resolveVariant('hoodie', 'Lilac', 'M'), HttpError);
  assert.throws(() => resolveVariant('mug', 'White', '15 oz'), HttpError);
  assert.throws(() => resolveVariant('hat', 'Black', 'One size'), (err) => err.message === HAT_UNAVAILABLE);
});

test('design token round-trips and checkout metadata survives a client price', async () => {
  const stripe = fakeStripe();
  const result = await createCheckoutSession({
    items: [sampleItem({ quantity: 2 })],
    stripe,
    siteUrl: `${SITE}/`,
  });
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
  const params = stripe.calls[0];
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.deepEqual(params.shipping_address_collection, { allowed_countries: ['US'] });
  assert.equal(params.success_url, `${SITE}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  assert.equal(params.cancel_url, `${SITE}/cancel.html`);
  assert.equal(params.line_items[0].price_data.unit_amount, 2900);
  assert.equal(params.line_items[0].quantity, 2);
  assert.equal(params.line_items[1].price_data.unit_amount, 599);
  assert.equal(JSON.stringify(params).includes('"unit_amount":100'), false);
  const restored = itemsFromMetadata(params.metadata);
  assert.deepEqual(restored[0].emojis, ['🔥', '😎', '🍕']);
  assert.equal(restored[0].variant.variantId, 4018);
  const design = decodeDesign(encodeDesign(restored[0]));
  assert.equal(design.background.color, '#fde68a');
  assert.equal(design.layout, 'row');
});

test('printful order is a draft unless PRINTFUL_AUTO_CONFIRM=true', async () => {
  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem({ product: 'mug', color: 'White', size: '11 oz' })], stripe, siteUrl: SITE });
  const session = completedSession(stripe.calls[0].metadata);
  const order = buildPrintfulOrder({ session, siteUrl: SITE });
  assert.equal(order.external_id, 'cs_test_123');
  assert.equal(order.recipient.country_code, 'US');
  assert.equal(order.recipient.state_code, 'TX');
  assert.equal(order.recipient.email, 'ada@example.com');
  assert.equal(order.items[0].variant_id, 1320);
  assert.equal(order.items[0].files[0].type, 'default');
  assert.match(order.items[0].files[0].url, /^https:\/\/trimoji\.vercel\.app\/api\/print-file\?design=/);

  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 200, result: { id: 99 } }), { status: 200 });
  };
  const env = {
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    PRINTFUL_API_TOKEN: 'pf_test_token',
    PRINTFUL_STORE_ID: '18937301',
    SITE_URL: SITE,
    PRINTFUL_AUTO_CONFIRM: 'false',
  };
  const payload = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  });
  const stripeLib = new Stripe('sk_test_placeholder');
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const ok = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env,
    stripe: stripeLib,
    fetchImpl,
  });
  assert.equal(ok.printfulOrderId, 99);
  assert.equal(ok.confirm, false);
  const called = new URL(seen[0].url);
  assert.equal(called.pathname, '/orders');
  assert.equal(called.searchParams.get('confirm'), 'false');
  assert.equal(seen[0].init.headers['X-PF-Store-Id'], '18937301');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer pf_test_token');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.items[0].variant_id, 1320);

  seen.length = 0;
  const live = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env: { ...env, PRINTFUL_AUTO_CONFIRM: 'true' },
    stripe: stripeLib,
    fetchImpl,
  });
  assert.equal(live.confirm, true);
  assert.equal(new URL(seen[0].url).searchParams.get('confirm'), 'true');
});

test('webhook rejects a bad signature and ignores other events', async () => {
  const stripeLib = new Stripe('sk_test_placeholder');
  const env = {
    STRIPE_WEBHOOK_SECRET: SECRET,
    PRINTFUL_API_TOKEN: 'pf_test_token',
    PRINTFUL_STORE_ID: '18937301',
    SITE_URL: SITE,
  };
  await assert.rejects(
    () => handleStripeWebhook({
      rawBody: '{}',
      signature: 't=1,v1=deadbeef',
      env,
      stripe: stripeLib,
      fetchImpl: async () => { throw new Error('should not call Printful'); },
    }),
    (err) => err.status === 400 && err.message === 'Invalid Stripe signature',
  );
  const payload = JSON.stringify({ id: 'evt_2', object: 'event', type: 'payment_intent.created', data: { object: {} } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const ignored = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env,
    stripe: stripeLib,
    fetchImpl: async () => { throw new Error('should not call Printful'); },
  });
  assert.equal(ignored.ignored, true);
});

test('config reports test mode without the key', async () => {
  const secret = 'sk_test_supersecretvalue';
  assert.deepEqual(publicConfig({ STRIPE_SECRET_KEY: secret }), { stripeTestMode: true });
  assert.equal(publicConfig({ STRIPE_SECRET_KEY: 'sk_live_supersecretvalue' }).stripeTestMode, false);
  assert.equal(publicConfig({}).stripeTestMode, false);
  assert.equal(JSON.stringify(publicConfig({ STRIPE_SECRET_KEY: secret })).includes('supersecret'), false);
  assert.equal(JSON.stringify(publicConfig({ STRIPE_SECRET_KEY: secret })).includes('sk_test'), false);

  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = secret;
  try {
    const response = await configGet();
    const text = await response.text();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(text.includes('supersecret'), false);
    assert.deepEqual(JSON.parse(text), { stripeTestMode: true });
  } finally {
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  }
});

test('print file is a transparent PNG from Twemoji SVG', async () => {
  const design = decodeDesign(encodeDesign({
    emojis: ['🔥', '😎', '🍕'],
    layout: 'triangle',
    logoSize: 120,
    background: { shape: 'none' },
  }));
  const png = await renderLogoPng(design, async () => SVG);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), PRINT_PX);
  assert.equal(png.readUInt32BE(20), PRINT_PX);
  assert.equal(png[25], 6);
});

test('HTTP handlers: checkout redirect, webhook, and print file', async () => {
  const previous = {
    key: process.env.STRIPE_SECRET_KEY,
    site: process.env.SITE_URL,
    wh: process.env.STRIPE_WEBHOOK_SECRET,
    token: process.env.PRINTFUL_API_TOKEN,
    store: process.env.PRINTFUL_STORE_ID,
    confirm: process.env.PRINTFUL_AUTO_CONFIRM,
  };
  const originalStripe = runtime.createStripe;
  const originalFetch = runtime.fetch;
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  process.env.SITE_URL = SITE;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.PRINTFUL_API_TOKEN = 'pf_test_token';
  process.env.PRINTFUL_STORE_ID = '18937301';
  process.env.PRINTFUL_AUTO_CONFIRM = 'false';
  runtime.createStripe = () => fakeStripe();
  runtime.fetch = async () => new Response(SVG, { status: 200, headers: { 'content-type': 'image/svg+xml' } });
  try {
    const denied = await checkoutPost(new Request('https://trimoji.vercel.app/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [sampleItem({ product: 'hat', price: 0 })] }),
    }));
    assert.equal(denied.status, 400);
    assert.match((await denied.json()).error, /embroidery/i);

    const stripe = fakeStripe();
    runtime.createStripe = () => stripe;
    const ok = await checkoutPost(new Request('https://trimoji.vercel.app/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [sampleItem()] }),
    }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).url, 'https://checkout.stripe.com/c/pay/cs_test_123');

    const payload = JSON.stringify({
      id: 'evt_route',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: completedSession(stripe.calls[0].metadata) },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    runtime.createStripe = () => new Stripe('sk_test_placeholder');
    runtime.fetch = async () => new Response(JSON.stringify({ result: { id: 7 } }), { status: 200 });
    const hooked = await webhookPost(new Request('https://trimoji.vercel.app/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': header, 'content-type': 'application/json' },
      body: payload,
    }));
    assert.equal(hooked.status, 200);
    assert.equal((await hooked.json()).printfulOrderId, 7);

    const token = encodeDesign(sampleItem());
    runtime.fetch = async (url) => {
      assert.match(String(url), /twemoji@latest\/assets\/svg\/.+\.svg$/);
      return new Response(SVG, { status: 200 });
    };
    const file = await printGet(new Request(`https://trimoji.vercel.app/api/print-file?design=${token}`));
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString('hex'), '89504e47');
  } finally {
    runtime.createStripe = originalStripe;
    runtime.fetch = originalFetch;
    for (const [name, value] of Object.entries({
      STRIPE_SECRET_KEY: previous.key,
      SITE_URL: previous.site,
      STRIPE_WEBHOOK_SECRET: previous.wh,
      PRINTFUL_API_TOKEN: previous.token,
      PRINTFUL_STORE_ID: previous.store,
      PRINTFUL_AUTO_CONFIRM: previous.confirm,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the static shop asks the server for checkout and test mode', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="testmode"/);
  assert.match(html, /fetch\('\/api\/config'/);
  assert.match(html, /fetch\('\/api\/checkout'/);
  assert.match(html, /stripeTestMode===true/);
  assert.match(html, /assets\/72x72\//);
  assert.match(html, /touch-action:manipulation/);
  assert.match(html, /DOMParser/);
  assert.match(html, /xlink:href/);
  assert.match(html, /function all\(\)\{slots\(\);controls\(\);draw\(\);syncProduct\(\)\}/);
  assert.doesNotMatch(html, /backdrop-filter/);
  assert.doesNotMatch(html, /assets\/svg\//);
  assert.doesNotMatch(html, /<a href="#builder"><button/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /sk_test_/);
  assert.match(readme, /\/api\/stripe-webhook/);
  assert.match(readme, /checkout\.session\.completed/);
  assert.match(readme, /sk_live_/);
});
