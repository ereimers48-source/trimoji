import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import Stripe from 'stripe';
import { OPTIONS as checkoutOptions, POST as checkoutPost } from '../api/checkout.js';
import { GET as configGet } from '../api/config.js';
import { GET as printGet } from '../api/print-file.js';
import { POST as webhookPost } from '../api/stripe-webhook.js';
import { comingSoonEnabled, routeRequest } from '../lib/coming-soon.js';
import { publicConfig } from '../lib/config.js';
import { createCheckoutSession } from '../lib/checkout.js';
import { decodeDesign, encodeDesign, itemsFromMetadata, resolveSiteUrl } from '../lib/design.js';
import { HttpError } from '../lib/http.js';
import { priceCart } from '../lib/prices.js';
import { buildPrintfulOrder, printfulExternalId } from '../lib/printful.js';
import { GET as orderGet } from '../api/order.js';
import { CASE_BOTTOM_INSET, CASE_CAMERA_TOP, CASE_LOGO_CENTER, CASE_PRINT_H, CASE_PRINT_W, HAT_PRINT_H, HAT_PRINT_W, PRINT_PX, composeSvg, renderLogoPng } from '../lib/render.js';
import { pageRedirect } from '../lib/redirect.js';
import { runtime } from '../lib/runtime.js';
import { orderReference, publicOrder } from '../lib/order.js';
import { resolveVariant } from '../lib/variants.js';
import { handleWaitlist, waitlistMailto } from '../lib/waitlist.js';
import { handleStripeWebhook } from '../lib/webhook.js';

const SITE = 'https://trimojiapparel.com';
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

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dlu = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dlu) return left;
  if (du <= dlu) return up;
  return upLeft;
}

function decodeRgba(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    } else if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[src + i];
      const left = i >= 4 ? pixels[y * stride + i - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= 4 ? pixels[(y - 1) * stride + i - 4] : 0;
      let decoded = value;
      if (filter === 1) decoded = (value + left) & 255;
      else if (filter === 2) decoded = (value + up) & 255;
      else if (filter === 3) decoded = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded = (value + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`png filter ${filter}`);
      pixels[y * stride + i] = decoded;
    }
    src += stride;
  }
  return { width, height, pixels };
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
  const hat = priceCart([sampleItem({ product: 'hat', color: 'Navy', size: 'One size', price: 1 })]);
  assert.equal(hat.lines[0].unitAmount, 3300);
  assert.equal(hat.shipping, 599);
  const phone = priceCart([sampleItem({ product: 'case', color: 'Matte', size: 'iPhone 16 Pro', price: 1 })]);
  assert.equal(phone.lines[0].unitAmount, 2900);
  assert.equal(phone.shipping, 599);
  assert.equal(phone.total, 3499);
  const freeCase = priceCart([
    sampleItem({ product: 'case', color: 'Glossy', size: 'iPhone 15', price: 0 }),
    sampleItem({ product: 'hoodie', color: 'Navy', size: 'M' }),
  ]);
  assert.equal(freeCase.subtotal, 2900 + 5400);
  assert.equal(freeCase.shipping, 0);
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
  assert.throws(() => resolveVariant('tee', 'Charcoal', 'M'), HttpError);
  assert.deepEqual(resolveVariant('hat', 'Black', 'One size'), {
    variantId: 4811,
    printType: 'front_dtf_hat',
    name: 'Trucker hat',
    unitAmount: 3300,
    printfulColor: 'Black',
    catalogProductId: 100,
    technique: 'dtfilm',
  });
  assert.equal(resolveVariant('hat', 'White', 'One size').variantId, 4810);
  assert.equal(resolveVariant('hat', 'Charcoal', 'One size').variantId, 4814);
  assert.equal(resolveVariant('hat', 'Navy', 'One size').variantId, 4816);
  assert.deepEqual(resolveVariant('case', 'Glossy', 'iPhone 16 Pro'), {
    variantId: 20304,
    printType: 'default',
    name: 'Tough phone case',
    unitAmount: 2900,
    printfulColor: 'White',
    catalogProductId: 601,
  });
  assert.equal(resolveVariant('case', 'Matte', 'iPhone 16 Pro').variantId, 20308);
  assert.equal(resolveVariant('case', 'Glossy', 'iPhone 15').variantId, 17714);
  assert.equal(resolveVariant('case', 'Matte', 'iPhone 15').variantId, 17715);
  assert.equal(resolveVariant('case', 'Glossy', 'iPhone 18 Pro Max').variantId, 52386);
  assert.equal(resolveVariant('case', 'Matte', 'iPhone 18 Pro Max').variantId, 52387);
  assert.equal(resolveVariant('case', 'Matte', 'iPhone 17 Air').variantId, 33990);
  assert.throws(() => resolveVariant('case', 'White', 'iPhone 16'), HttpError);
  assert.throws(() => resolveVariant('case', 'Glossy', 'iPhone 14'), HttpError);
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
  assert.deepEqual(design.background, { shape: 'none' });
  assert.equal(JSON.stringify(params.metadata).includes('fde68a'), false);
  assert.equal(Object.hasOwn(JSON.parse(params.metadata.i0), 'b'), false);
  assert.equal(design.layout, 'row');
});

test('an empty middle slot stays a gap in checkout metadata and the print file', async () => {
  const slots = ['🔥', null, '🍕'];
  const stripe = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem({ emojis: slots, slots, layout: 'row', background: { shape: 'none' } })],
    stripe,
    siteUrl: SITE,
  });
  const packed = JSON.parse(stripe.calls[0].metadata.i0);
  assert.deepEqual(packed.slots, slots);
  assert.deepEqual(packed.e, slots);
  assert.match(stripe.calls[0].line_items[0].price_data.product_data.name, /🔥🍕/);
  assert.equal(stripe.calls[0].line_items[0].price_data.product_data.name.includes('null'), false);
  const restored = itemsFromMetadata(stripe.calls[0].metadata);
  assert.deepEqual(restored[0].emojis, slots);
  assert.deepEqual(restored[0].slots, slots);
  assert.deepEqual(decodeDesign(encodeDesign(restored[0])).emojis, slots);
  const order = buildPrintfulOrder({ session: completedSession(stripe.calls[0].metadata), siteUrl: SITE });
  const token = new URL(order.items[0].files[0].url).searchParams.get('design');
  assert.deepEqual(decodeDesign(token).emojis, slots);

  function marks(svg) {
    return [...svg.matchAll(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/g)].map((mark) => {
      const x = Number(mark[1]);
      const y = Number(mark[2]);
      const glyph = Number(mark[3]) * 36;
      return { x, y, glyph, cx: x + glyph / 2, cy: y + glyph / 2 };
    });
  }
  for (const product of ['tee', 'hoodie', 'mug', 'hat', 'case']) {
    const design = { product, layout: 'row', logoSize: 100, background: { shape: 'none' } };
    const full = marks(composeSvg({ ...design, emojis: ['🔥', '😎', '🍕'] }, [SVG, SVG, SVG]));
    const gapped = marks(composeSvg({ ...design, emojis: slots }, [SVG, SVG]));
    assert.equal(gapped.length, 2, product);
    assert.equal(gapped[0].glyph, full[0].glyph, product);
    assert.ok(gapped[1].cx - gapped[0].cx > gapped[0].glyph * 1.9, product);
    assert.ok(Math.abs(gapped[0].cx - full[0].cx) < 1, product);
    assert.ok(Math.abs(gapped[1].cx - full[2].cx) < 1, product);
    const width = product === 'hat' ? HAT_PRINT_W : product === 'case' ? CASE_PRINT_W : PRINT_PX;
    assert.ok(Math.abs((gapped[0].cx + gapped[1].cx) / 2 - width / 2) < gapped[0].glyph * 0.15, product);
    if (product === 'case') {
      const clear = CASE_PRINT_H * CASE_CAMERA_TOP;
      assert.ok(gapped[0].y >= clear - 0.5, `case camera ${gapped[0].y}`);
      assert.ok(full[0].y >= clear - 0.5, `case camera full ${full[0].y}`);
    }
  }
  const triangle = marks(composeSvg({
    product: 'tee', emojis: slots, layout: 'triangle', logoSize: 100, background: { shape: 'none' },
  }, [SVG, SVG]));
  assert.ok(triangle[1].cy > triangle[0].cy);
  assert.ok(triangle[1].cx - triangle[0].cx > triangle[0].glyph * 0.3);
  const stacked = marks(composeSvg({
    product: 'hoodie', emojis: slots, layout: 'stacked', logoSize: 100, background: { shape: 'none' },
  }, [SVG, SVG]));
  assert.ok(Math.abs(stacked[0].cx - stacked[1].cx) < 1);
  assert.ok(stacked[1].cy - stacked[0].cy > stacked[0].glyph * 1.9);
  const fetched = [];
  const png = await renderLogoPng({
    product: 'tee', emojis: slots, layout: 'row', logoSize: 100, background: { shape: 'none' },
  }, async () => { fetched.push(1); return SVG; });
  assert.equal(fetched.length, 2);
  assert.equal(png.readUInt32BE(16), PRINT_PX);

  await assert.rejects(
    () => createCheckoutSession({
      items: [sampleItem({ emojis: [null, null, null], slots: [null, null, null] })],
      stripe: fakeStripe(),
      siteUrl: SITE,
    }),
    (err) => err instanceof HttpError && /at least 1/.test(err.message),
  );
  await assert.rejects(
    () => createCheckoutSession({
      items: [sampleItem({ emojis: ['🔥', '🍕'] })],
      stripe: fakeStripe(),
      siteUrl: SITE,
    }),
    (err) => err instanceof HttpError && /3 emoji slots/.test(err.message),
  );
});

test('the same emoji can fill more than one slot', async () => {
  const triple = ['🔥', '🔥', '🔥'];
  const gapped = ['🔥', null, '🔥'];
  const stripe = fakeStripe();
  await createCheckoutSession({
    items: [
      sampleItem({ emojis: triple, slots: triple, layout: 'row', background: { shape: 'none' } }),
      sampleItem({ emojis: gapped, slots: gapped, layout: 'row', background: { shape: 'none' }, quantity: 1 }),
    ],
    stripe,
    siteUrl: SITE,
  });
  const meta = stripe.calls[0].metadata;
  assert.equal(meta.n, '2');
  assert.deepEqual(JSON.parse(meta.i0).slots, triple);
  assert.deepEqual(JSON.parse(meta.i0).e, triple);
  assert.deepEqual(JSON.parse(meta.i1).slots, gapped);
  const restored = itemsFromMetadata(meta);
  assert.deepEqual(restored[0].emojis, triple);
  assert.deepEqual(restored[1].slots, gapped);
  assert.deepEqual(decodeDesign(encodeDesign(restored[0])).emojis, triple);
  assert.deepEqual(decodeDesign(encodeDesign(restored[1])).emojis, gapped);
  const order = buildPrintfulOrder({ session: completedSession(meta), siteUrl: SITE });
  assert.equal(order.items.length, 2);
  assert.deepEqual(decodeDesign(new URL(order.items[0].files[0].url).searchParams.get('design')).emojis, triple);
  assert.deepEqual(decodeDesign(new URL(order.items[1].files[0].url).searchParams.get('design')).emojis, gapped);

  function marks(svg) {
    return [...svg.matchAll(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/g)].map((mark) => {
      const x = Number(mark[1]);
      const glyph = Number(mark[3]) * 36;
      return { cx: x + glyph / 2, glyph };
    });
  }
  const full = marks(composeSvg({
    product: 'tee', emojis: ['🔥', '😎', '🍕'], layout: 'row', logoSize: 100, background: { shape: 'none' },
  }, [SVG, SVG, SVG]));
  const repeated = composeSvg({
    product: 'tee', emojis: triple, layout: 'row', logoSize: 100, background: { shape: 'none' },
  }, [SVG, SVG, SVG]);
  const repeatedMarks = marks(repeated);
  assert.equal(repeatedMarks.length, 3);
  assert.match(repeated, /id="e0_/);
  assert.match(repeated, /id="e2_/);
  repeatedMarks.forEach((mark, index) => {
    assert.ok(Math.abs(mark.cx - full[index].cx) < 1);
  });
  const outer = marks(composeSvg({
    product: 'hat', emojis: gapped, layout: 'row', logoSize: 100, background: { shape: 'none' },
  }, [SVG, SVG]));
  const hatFull = marks(composeSvg({
    product: 'hat', emojis: ['🔥', '😎', '🍕'], layout: 'row', logoSize: 100, background: { shape: 'none' },
  }, [SVG, SVG, SVG]));
  assert.equal(outer.length, 2);
  assert.ok(Math.abs(outer[0].cx - hatFull[0].cx) < 1);
  assert.ok(Math.abs(outer[1].cx - hatFull[2].cx) < 1);
  const fetched = [];
  await renderLogoPng({
    product: 'tee', emojis: triple, layout: 'row', logoSize: 100, background: { shape: 'none' },
  }, async () => { fetched.push('🔥'); return SVG; });
  assert.equal(fetched.length, 3);
});

test('printful order is a draft unless PRINTFUL_AUTO_CONFIRM=true', async () => {
  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem({ product: 'mug', color: 'White', size: '11 oz' })], stripe, siteUrl: SITE });
  const session = completedSession(stripe.calls[0].metadata);
  const order = buildPrintfulOrder({ session, siteUrl: SITE });
  assert.equal(order.external_id, printfulExternalId('cs_test_123'));
  assert.equal(order.packing_slip.message, 'Stripe session cs_test_123');
  assert.equal(order.recipient.country_code, 'US');
  assert.equal(order.recipient.state_code, 'TX');
  assert.equal(order.recipient.email, 'ada@example.com');
  assert.equal(order.items[0].variant_id, 1320);
  assert.equal(order.items[0].files[0].type, 'default');
  assert.equal(order.items[0].options, undefined);
  assert.match(order.items[0].files[0].url, /^https:\/\/trimojiapparel\.com\/api\/print-file\?design=/);

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
  assert.equal(body.external_id, printfulExternalId(session.id));
  assert.ok(body.external_id.length <= 32);
  assert.equal(body.packing_slip.message, `Stripe session ${session.id}`);
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

test('printful external id is 32 characters and stable per session', () => {
  const long = `cs_test_${'a'.repeat(58)}`;
  const id = printfulExternalId(long);
  assert.equal(id.length, 32);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(printfulExternalId(long), id);
  assert.notEqual(printfulExternalId(`${long}b`), id);
  assert.notEqual(printfulExternalId('cs_test_123'), printfulExternalId('cs_test_124'));
  const session = completedSession({ v: '1', n: '1', i0: JSON.stringify({
    p: 'tee', c: 'Black', s: 'L', q: 1, e: ['🔥', '😎', '🍕'], slots: ['🔥', '😎', '🍕'], l: 'row', z: 100,
  }) });
  session.id = long;
  const order = buildPrintfulOrder({ session, siteUrl: SITE });
  assert.equal(order.external_id, id);
  assert.equal(order.packing_slip.message, `Stripe session ${long}`);
});

test('a replayed checkout is safe when Printful says the external id already exists', async () => {
  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem()], stripe, siteUrl: SITE });
  const session = completedSession(stripe.calls[0].metadata);
  const env = {
    STRIPE_WEBHOOK_SECRET: SECRET,
    PRINTFUL_API_TOKEN: 'pf_test_token',
    PRINTFUL_STORE_ID: '18937301',
    SITE_URL: SITE,
  };
  const payload = JSON.stringify({
    id: 'evt_replay',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  });
  const stripeLib = new Stripe('sk_test_placeholder');
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const duplicate = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env,
    stripe: stripeLib,
    fetchImpl: async () => new Response(JSON.stringify({
      code: 400,
      result: 'Order with External ID already exists',
      error: { reason: 'BadRequest', message: 'Order with External ID already exists' },
    }), { status: 400 }),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.received, true);
  const confirmed = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env,
    stripe: stripeLib,
    fetchImpl: async () => new Response(JSON.stringify({
      code: 400,
      result: 'Order already exists and cannot be updated',
      error: { reason: 'BadRequest', message: 'Order already exists and cannot be updated' },
    }), { status: 400 }),
  });
  assert.equal(confirmed.duplicate, true);
  await assert.rejects(
    () => handleStripeWebhook({
      rawBody: payload,
      signature: header,
      env,
      stripe: stripeLib,
      fetchImpl: async () => new Response(JSON.stringify({
        code: 400,
        result: 'Invalid External ID specified',
        error: { reason: 'BadRequest', message: 'Invalid External ID specified' },
      }), { status: 400 }),
    }),
    (err) => err instanceof HttpError && err.status === 400 && err.message === 'Invalid External ID specified',
  );
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

  const requestedCircle = {
    emojis: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 100,
    background: { shape: 'circle', color: '#fde68a' },
  };
  const art = composeSvg(requestedCircle, [SVG, SVG, SVG]);
  assert.equal(art.includes('#fde68a'), false);
  const clear = decodeRgba(await renderLogoPng(requestedCircle, async () => SVG));
  const alpha = (bitmap, x, y) => bitmap.pixels[(y * bitmap.width + x) * 4 + 3];
  assert.equal(alpha(clear, 0, 0), 0);
  assert.equal(alpha(clear, 900, 40), 0);
  assert.ok(alpha(clear, 900, 900) > 200);
  const legacy = Buffer.from(JSON.stringify({
    e: ['🔥', '😎', '🍕'], l: 'row', z: 100, b: '#fde68a',
  }), 'utf8').toString('base64url');
  assert.deepEqual(decodeDesign(legacy).background, { shape: 'none' });

  const hatDesign = decodeDesign(encodeDesign({
    product: 'hat',
    emojis: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 100,
    background: { shape: 'circle', color: '#fde68a' },
  }));
  assert.equal(hatDesign.product, 'hat');
  const hatPng = await renderLogoPng(hatDesign, async () => SVG);
  assert.equal(hatPng.readUInt32BE(16), HAT_PRINT_W);
  assert.equal(hatPng.readUInt32BE(20), HAT_PRINT_H);
  assert.equal(hatPng[25], 6);
  const hatPixels = decodeRgba(hatPng);
  assert.equal(alpha(hatPixels, 0, 0), 0);
  assert.equal(alpha(hatPixels, 825, 40), 0);
  assert.ok(alpha(hatPixels, 825, 375) > 200);
  let offset = 8;
  let dpi = null;
  while (offset + 12 <= hatPng.length) {
    const length = hatPng.readUInt32BE(offset);
    const type = hatPng.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'pHYs') dpi = Math.round(hatPng.readUInt32BE(offset + 8) * 0.0254);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  assert.equal(dpi, 300);
  const apparel = decodeDesign(encodeDesign(sampleItem()));
  assert.equal(apparel.product, undefined);

  function glyphBounds(svg) {
    const marks = [...svg.matchAll(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/g)];
    const boxes = marks.map((mark) => {
      const x = Number(mark[1]);
      const y = Number(mark[2]);
      const glyph = Number(mark[3]) * 36;
      return { x, y, w: glyph, h: glyph };
    });
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.w));
    const top = Math.min(...boxes.map((box) => box.y));
    const bottom = Math.max(...boxes.map((box) => box.y + box.h));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }
  const hatArt = (layout, logoSize) => composeSvg({
    product: 'hat',
    emojis: ['🔥', '😎', '🍕'],
    layout,
    logoSize,
    background: { shape: 'none' },
  }, [SVG, SVG, SVG]);
  const row = glyphBounds(hatArt('row', 100));
  assert.ok(row.width > HAT_PRINT_W * 0.85, `row width ${row.width}`);
  assert.ok(row.left > HAT_PRINT_W * 0.02 && row.right < HAT_PRINT_W * 0.98);
  assert.ok(Math.abs((row.top + row.bottom) / 2 - HAT_PRINT_H / 2) < 8);
  const smaller = glyphBounds(hatArt('row', 60));
  assert.ok(smaller.width < row.width * 0.75);
  const stacked = glyphBounds(hatArt('stacked', 100));
  assert.ok(stacked.height > HAT_PRINT_H * 0.85, `stacked height ${stacked.height}`);
  assert.ok(Math.abs((stacked.left + stacked.right) / 2 - HAT_PRINT_W / 2) < 8);
  const triangle = glyphBounds(hatArt('triangle', 100));
  assert.ok(triangle.height > HAT_PRINT_H * 0.8, `triangle height ${triangle.height}`);
  assert.ok(Math.abs((triangle.top + triangle.bottom) / 2 - HAT_PRINT_H / 2) < 8);
  function inside(box, width, height, label) {
    assert.ok(box.left > 4, `${label} left ${box.left}`);
    assert.ok(box.top > 4, `${label} top ${box.top}`);
    assert.ok(box.right < width - 4, `${label} right ${box.right}`);
    assert.ok(box.bottom < height - 4, `${label} bottom ${box.bottom}`);
  }
  for (const layout of ['stacked', 'triangle', 'row']) {
    inside(glyphBounds(hatArt(layout, 140)), HAT_PRINT_W, HAT_PRINT_H, `hat ${layout}`);
    for (const product of ['tee', 'mug']) {
      const art = composeSvg({
        product,
        emojis: ['🔥', '😎', '🍕'],
        layout,
        logoSize: 140,
        background: { shape: 'none' },
      }, [SVG, SVG, SVG]);
      inside(glyphBounds(art), PRINT_PX, PRINT_PX, `${product} ${layout}`);
    }
  }
});

test('phone case print file stays below the camera and checks out at $29', async () => {
  const item = sampleItem({
    product: 'case',
    color: 'Glossy',
    size: 'iPhone 17 Pro Max',
    emojis: ['🔥', '😎', '🍕'],
    slots: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 100,
    price: 0,
  });
  const stripe = fakeStripe();
  await createCheckoutSession({ items: [item], stripe, siteUrl: SITE });
  assert.equal(stripe.calls[0].line_items[0].price_data.unit_amount, 2900);
  assert.match(stripe.calls[0].line_items[0].price_data.product_data.name, /Tough phone case/);
  assert.equal(stripe.calls[0].line_items[1].price_data.unit_amount, 599);
  const order = buildPrintfulOrder({ session: completedSession(stripe.calls[0].metadata), siteUrl: SITE });
  assert.equal(order.items[0].name, 'Trimoji Tough phone case');
  assert.equal(order.items[0].variant_id, 33988);
  assert.equal(order.items[0].retail_price, '29.00');
  assert.equal(order.items[0].files[0].type, 'default');
  assert.equal(order.items[0].options, undefined);
  const token = new URL(order.items[0].files[0].url).searchParams.get('design');
  const design = decodeDesign(token);
  assert.equal(design.product, 'case');
  assert.deepEqual(design.emojis, ['🔥', '😎', '🍕']);
  assert.deepEqual(design.background, { shape: 'none' });

  function bounds(svg) {
    const boxes = [...svg.matchAll(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/g)].map((mark) => {
      const x = Number(mark[1]);
      const y = Number(mark[2]);
      const glyph = Number(mark[3]) * 36;
      return { x, y, r: x + glyph, b: y + glyph };
    });
    return {
      top: Math.min(...boxes.map((box) => box.y)),
      bottom: Math.max(...boxes.map((box) => box.b)),
      left: Math.min(...boxes.map((box) => box.x)),
      right: Math.max(...boxes.map((box) => box.r)),
    };
  }
  const clear = CASE_PRINT_H * CASE_CAMERA_TOP;
  for (const layout of ['row', 'stacked', 'triangle']) {
    for (const logoSize of [60, 100, 140]) {
      const box = bounds(composeSvg({
        product: 'case',
        emojis: ['🔥', null, '🍕'],
        layout,
        logoSize,
        background: { shape: 'none' },
      }, [SVG, SVG]));
      const floor = CASE_PRINT_H * (1 - CASE_BOTTOM_INSET);
      assert.ok(box.top >= clear - 0.5, `${layout} ${logoSize} top ${box.top}`);
      assert.ok(box.left > 4, `${layout} ${logoSize} left ${box.left}`);
      assert.ok(box.right < CASE_PRINT_W - 4, `${layout} ${logoSize} right ${box.right}`);
      assert.ok(box.bottom <= floor + 0.5, `${layout} ${logoSize} bottom ${box.bottom}`);
    }
  }

  const png = await renderLogoPng(design, async () => SVG);
  assert.equal(png.readUInt32BE(16), CASE_PRINT_W);
  assert.equal(png.readUInt32BE(20), CASE_PRINT_H);
  assert.equal(png[25], 6);
  let offset = 8;
  let dpi = null;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'pHYs') dpi = Math.round(png.readUInt32BE(offset + 8) * 0.0254);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  assert.equal(dpi, 300);
  const pixels = decodeRgba(png);
  const alpha = (bitmap, x, y) => bitmap.pixels[(y * bitmap.width + x) * 4 + 3];
  assert.equal(alpha(pixels, 0, 0), 0);
  assert.equal(alpha(pixels, Math.round(CASE_PRINT_W / 2), Math.round(clear * 0.5)), 0);
  assert.ok(alpha(pixels, Math.round(CASE_PRINT_W / 2), Math.round(CASE_PRINT_H * CASE_LOGO_CENTER)) > 200);
  assert.equal(alpha(pixels, Math.round(CASE_PRINT_W / 2), Math.round(CASE_PRINT_H * 0.92)), 0);
  const rowBox = bounds(composeSvg(design, [SVG, SVG, SVG]));
  assert.ok(Math.abs((rowBox.top + rowBox.bottom) / 2 - CASE_PRINT_H * CASE_LOGO_CENTER) < 2);
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
    const hatStripe = fakeStripe();
    runtime.createStripe = () => hatStripe;
    const hatOk = await checkoutPost(new Request('https://trimojiapparel.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [sampleItem({ product: 'hat', color: 'Black', size: 'One size', price: 0 })] }),
    }));
    assert.equal(hatOk.status, 200);
    assert.equal(hatStripe.calls[0].line_items[0].price_data.unit_amount, 3300);
    assert.match(hatStripe.calls[0].line_items[0].price_data.product_data.name, /Trucker hat/);
    const hatOrder = buildPrintfulOrder({
      session: completedSession(hatStripe.calls[0].metadata),
      siteUrl: SITE,
    });
    assert.equal(hatOrder.items[0].variant_id, 4811);
    assert.equal(hatOrder.items[0].retail_price, '33.00');
    assert.equal(hatOrder.items[0].files[0].type, 'front_dtf_hat');
    assert.deepEqual(hatOrder.items[0].options, [{ id: 'technique', value: 'dtfilm' }]);
    const hatToken = new URL(hatOrder.items[0].files[0].url).searchParams.get('design');
    assert.equal(decodeDesign(hatToken).product, 'hat');

    const stripe = fakeStripe();
    runtime.createStripe = () => stripe;
    const ok = await checkoutPost(new Request('https://trimojiapparel.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify({ items: [sampleItem()] }),
    }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
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
    const hooked = await webhookPost(new Request('https://trimojiapparel.com/api/stripe-webhook', {
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
    const file = await printGet(new Request(`https://trimojiapparel.com/api/print-file?design=${token}`));
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

test('the custom domain is the checkout fallback and older origins stay allowed', async () => {
  assert.equal(resolveSiteUrl(undefined), SITE);
  assert.equal(resolveSiteUrl('  '), SITE);
  assert.equal(resolveSiteUrl('https://trimoji.vercel.app/'), 'https://trimoji.vercel.app');
  assert.equal(resolveSiteUrl('https://ereimers48-source.github.io/trimoji/'), 'https://ereimers48-source.github.io/trimoji');

  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem()], stripe, siteUrl: resolveSiteUrl(undefined) });
  assert.equal(stripe.calls[0].success_url, `${SITE}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  assert.equal(stripe.calls[0].cancel_url, `${SITE}/cancel.html`);

  const legacy = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem()],
    stripe: legacy,
    siteUrl: resolveSiteUrl('https://trimoji.vercel.app'),
  });
  assert.equal(legacy.calls[0].success_url, 'https://trimoji.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(legacy.calls[0].cancel_url, 'https://trimoji.vercel.app/cancel.html');

  for (const origin of [SITE, 'https://www.trimojiapparel.com', 'https://trimoji.vercel.app', 'https://ereimers48-source.github.io']) {
    const pre = await checkoutOptions(new Request(`${SITE}/api/checkout`, { method: 'OPTIONS', headers: { origin } }));
    assert.equal(pre.status, 204, origin);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);
  }
  const denied = await checkoutOptions(new Request(`${SITE}/api/checkout`, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example' },
  }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const previous = { site: process.env.SITE_URL, key: process.env.STRIPE_SECRET_KEY };
  delete process.env.SITE_URL;
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  const originalStripe = runtime.createStripe;
  const routed = fakeStripe();
  runtime.createStripe = () => routed;
  try {
    const response = await checkoutPost(new Request(`${SITE}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://trimoji.vercel.app' },
      body: JSON.stringify({ items: [sampleItem()] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://trimoji.vercel.app');
    assert.equal(routed.calls[0].success_url, `${SITE}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    assert.equal(routed.calls[0].cancel_url, `${SITE}/cancel.html`);
  } finally {
    runtime.createStripe = originalStripe;
    if (previous.site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous.site;
    if (previous.key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous.key;
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
  assert.match(html, /Trucker hat/);
  assert.match(html, /Tough phone case/);
  assert.match(html, /function caseLogoSVG\(\)\{const W=1392,H=2220,cam=0\.28,inset=0\.16/);
  assert.match(html, /let cy=H\*0\.48/);
  assert.match(html, /aria-label="iPhone model"/);
  assert.match(html, /1392\/2220/);
  assert.match(html, /setAttribute\('data-hat','trucker'\)/);
  assert.match(html, /assets\/products\//);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /rel="canonical" href="https:\/\/trimojiapparel\.com\/"/);
  assert.match(html, /property="og:url" content="https:\/\/trimojiapparel\.com\/"/);
  assert.doesNotMatch(html, /trimoji\.vercel\.app/);
  assert.doesNotMatch(html, /github\.io/);
  for (const page of ['success.html', 'cancel.html']) {
    const extra = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(extra, /rel="canonical" href="https:\/\/trimojiapparel\.com\//);
    assert.match(extra, /property="og:url" content="https:\/\/trimojiapparel\.com\//);
  }
  assert.doesNotMatch(html, /id="bgs"/);
  assert.doesNotMatch(html, /Backdrop/);
  assert.doesNotMatch(html, /id="showcase"/);
  assert.doesNotMatch(html, /mug example/);
  assert.doesNotMatch(html, /Dad hat/);
  assert.doesNotMatch(html, /backdrop-filter/);
  assert.doesNotMatch(html, /assets\/svg\//);
  assert.doesNotMatch(html, /<a href="#builder"><button/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /sk_test_/);
  assert.match(readme, /\/api\/stripe-webhook/);
  assert.match(readme, /checkout\.session\.completed/);
  assert.match(readme, /sk_live_/);
});

test('policy pages share a footer and old hosts keep /api', () => {
  const footer = '<nav aria-label="Policies"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/shipping">Shipping</a><a href="/returns">Returns</a><a href="/contact">Contact</a></nav>';
  for (const page of ['index.html', 'coming-soon.html', 'success.html', 'cancel.html', 'privacy.html', 'terms.html', 'shipping.html', 'returns.html', 'contact.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(footer), page);
    assert.match(html, /© Trimoji/);
    assert.doesNotMatch(html, /\bLLC\b|\bL\.L\.C\b|Incorporated/);
  }
  const mains = {
    'privacy.html': [/Privacy Policy/, /hello@trimojiapparel\.com/, /does not sell personal information/],
    'terms.html': [/Terms of Service/, /made to order/i, /United States/],
    'shipping.html': [/Shipping Policy/, /Printful/, /2–7 business days/, /\$5\.99/, /\$60 or more/, /tracking number is emailed/i],
    'returns.html': [/Returns &amp; Refund Policy/, /change of mind/, /30 days/, /clear photo/, /free replacement/, /full refund/, /mailto:hello@trimojiapparel\.com/, /Damaged, defective, or incorrect items/, /Sizing/, /Order changes and cancellations/, /Lost or delayed packages/, /5 to 10 business days/, /Shipping address/],
    'contact.html': [/mailto:hello@trimojiapparel\.com/],
  };
  for (const [page, patterns] of Object.entries(mains)) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
    for (const pattern of patterns) assert.match(main, pattern, `${page} ${pattern}`);
    assert.doesNotMatch(main, /\b\d{5}\b|Street|Avenue|\bSuite\b|P\.O\. Box/i, page);
  }
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /href="\/shipping">Shipping<\/a> · <a href="\/returns">Returns<\/a>/);
  const made = 'Custom-made to order. See our <a href="/returns">Returns policy</a>.';
  assert.equal(index.split(made).length - 1, 2);
  assert.doesNotMatch(index, /Returns policy<\/a>[^<]*target=/);
  const returns = readFileSync(new URL('../returns.html', import.meta.url), 'utf8');
  assert.doesNotMatch(returns, /noindex/i);
  assert.match(returns, /rel="canonical" href="https:\/\/trimojiapparel\.com\/returns"/);
  const success = readFileSync(new URL('../success.html', import.meta.url), 'utf8');
  assert.match(success, /Tracking is emailed when it ships/);
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const host of ['www.trimojiapparel.com', 'trimoji.vercel.app']) {
    const rules = config.redirects.filter((rule) => rule.has?.some((item) => item.type === 'host' && item.value === host));
    assert.ok(rules.some((rule) => rule.source === '/' && rule.destination === `${SITE}/` && rule.permanent === true), host);
    const wild = rules.find((rule) => rule.source === '/:path((?!api(?:/|$)).*)');
    assert.equal(wild.destination, `${SITE}/:path*`);
    assert.equal(wild.permanent, true);
  }
  assert.equal(config.redirects.some((rule) => rule.has?.some((item) => item.value === 'trimojiapparel.com')), false);
  for (const path of ['/privacy', '/terms', '/shipping', '/returns', '/contact']) {
    assert.ok(config.rewrites.some((rule) => rule.source === path && rule.destination === `${path}.html`));
  }
  for (const host of ['www.trimojiapparel.com', 'trimoji.vercel.app']) {
    assert.equal(pageRedirect(host, '/'), `${SITE}/`);
    assert.equal(pageRedirect(host, '/privacy'), `${SITE}/privacy`);
    assert.equal(pageRedirect(host, '/success.html'), `${SITE}/success.html`);
    assert.equal(pageRedirect(host, '/api/stripe-webhook'), null);
    assert.equal(pageRedirect(host, '/api/checkout'), null);
    assert.equal(pageRedirect(host, '/api'), null);
  }
  assert.equal(pageRedirect('trimojiapparel.com', '/'), null);
  assert.equal(pageRedirect('trimoji-git-preview.vercel.app', '/privacy'), null);
});

test('coming soon is the default and one flag opens the shop', () => {
  assert.equal(comingSoonEnabled({}), true);
  assert.equal(comingSoonEnabled({ COMING_SOON: '' }), true);
  assert.equal(comingSoonEnabled({ COMING_SOON: 'true' }), true);
  assert.equal(comingSoonEnabled({ COMING_SOON: 'false' }), false);
  assert.equal(comingSoonEnabled({ COMING_SOON: '0' }), false);
  assert.equal(comingSoonEnabled({ COMING_SOON: 'no' }), false);
  assert.equal(comingSoonEnabled({ COMING_SOON: 'off' }), false);
  assert.equal(comingSoonEnabled({ COMING_SOON: 'OFF' }), false);
  assert.deepEqual(routeRequest('/', {}), { type: 'file', file: 'coming-soon.html', robots: null });
  assert.deepEqual(routeRequest('/index.html', {}), { type: 'file', file: 'coming-soon.html', robots: null });
  assert.deepEqual(routeRequest('/shop-preview', {}), { type: 'file', file: 'index.html', robots: 'noindex, nofollow' });
  assert.deepEqual(routeRequest('/shop-preview/', {}), { type: 'file', file: 'index.html', robots: 'noindex, nofollow' });
  assert.deepEqual(routeRequest('/privacy', {}), { type: 'static' });
  assert.deepEqual(routeRequest('/', { COMING_SOON: 'false' }), { type: 'static' });
  assert.deepEqual(routeRequest('/index.html', { COMING_SOON: 'false' }), { type: 'static' });
  assert.deepEqual(routeRequest('/shop-preview', { COMING_SOON: 'false' }), { type: 'missing' });
});

test('waitlist emails go to hello when there is no store', async () => {
  const mail = await handleWaitlist('  Ada@Example.com  ');
  assert.equal(mail.delivery, 'mailto');
  assert.equal(mail.mailto, waitlistMailto('ada@example.com'));
  assert.match(mail.mailto, /^mailto:hello@trimojiapparel\.com\?/);
  assert.match(decodeURIComponent(mail.mailto), /ada@example.com/);
  await assert.rejects(() => handleWaitlist('not-an-email'), /valid email/);
  let posted = null;
  const stored = await handleWaitlist('ada@example.com', {
    webhookUrl: 'https://example.test/hook',
    fetchImpl: async (url, init) => {
      posted = { url, init };
      return { ok: true };
    },
  });
  assert.equal(stored.delivery, 'stored');
  assert.equal(posted.url, 'https://example.test/hook');
  assert.equal(JSON.parse(posted.init.body).email, 'ada@example.com');
  await assert.rejects(() => handleWaitlist('ada@example.com', {
    webhookUrl: 'https://example.test/hook',
    fetchImpl: async () => ({ ok: false }),
  }), /Could not save/);
});

test('coming soon page is public and the shop preview is not linked', () => {
  const html = readFileSync(new URL('../coming-soon.html', import.meta.url), 'utf8');
  assert.match(html, /Three emojis\.<br>One you\./);
  assert.match(html, /Custom 3-emoji logos on tees, hoodies, mugs, hats, and phone cases\./);
  assert.match(html, /og:image" content="https:\/\/trimojiapparel\.com\/assets\/og\.png"/);
  assert.match(html, /https:\/\/www\.instagram\.com\/trimojiapparel\//);
  assert.doesNotMatch(html, /tiktok/i);
  assert.doesNotMatch(html, /shop-preview/);
  assert.doesNotMatch(html, /formspree/i);
  const shop = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(shop, /shop-preview/);
  const robots = readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /Disallow: \/shop-preview/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /COMING_SOON/);
  assert.match(readme, /WAITLIST_WEBHOOK_URL/);
  const checkout = readFileSync(new URL('../api/checkout.js', import.meta.url), 'utf8');
  assert.doesNotMatch(checkout, /COMING_SOON|comingSoon/);
  const png = readFileSync(new URL('../assets/og.png', import.meta.url));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const source of ['/shop-preview', '/shop-preview/']) {
    const rule = config.headers.find((item) => item.source === source);
    assert.equal(rule.headers[0].key, 'X-Robots-Tag');
    assert.match(rule.headers[0].value, /noindex/);
  }
});

test('order receipt uses the session id and hides the customer', async () => {
  assert.equal(orderReference('cs_test_playwright'), printfulExternalId('cs_test_playwright'));
  assert.throws(() => orderReference('not-a-session'), (err) => err instanceof HttpError && err.status === 400);
  const metadata = {
    v: '1',
    n: '1',
    i0: JSON.stringify({
      p: 'case', c: 'Glossy', s: 'iPhone 16', q: 1, e: ['🔥', '😎', '🍕'], slots: ['🔥', '😎', '🍕'], l: 'row', z: 100,
    }),
  };
  const session = {
    id: 'cs_test_playwright',
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 3499,
    currency: 'usd',
    metadata,
    customer_details: { email: 'secret@example.com', name: 'Ada Lovelace' },
    shipping_details: { address: { line1: '1 Secret St' } },
  };
  const order = publicOrder(session);
  assert.equal(order.reference, printfulExternalId('cs_test_playwright'));
  assert.equal(order.items[0].name, 'Tough phone case');
  assert.deepEqual(order.items[0].emojis, ['🔥', '😎', '🍕']);
  assert.equal(order.items[0].amount, 2900);
  assert.equal(order.shipping, 599);
  assert.equal(order.total, 3499);
  assert.deepEqual(Object.keys(order).sort(), ['currency', 'items', 'reference', 'shipping', 'subtotal', 'total']);
  const packed = JSON.stringify(order);
  assert.equal(packed.includes('secret@'), false);
  assert.equal(packed.includes('Secret'), false);
  assert.equal(packed.includes('sk_'), false);
  assert.equal(packed.includes('cs_test_playwright'), false);
  assert.throws(() => publicOrder({ ...session, payment_status: 'unpaid' }), (err) => err instanceof HttpError && err.status === 404);

  const previous = process.env.STRIPE_SECRET_KEY;
  const originalStripe = runtime.createStripe;
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  const calls = [];
  runtime.createStripe = () => ({
    checkout: {
      sessions: {
        async retrieve(id) {
          calls.push(id);
          if (id !== session.id) {
            const error = new Error('No such checkout.session');
            error.statusCode = 404;
            error.code = 'resource_missing';
            throw error;
          }
          return session;
        },
      },
    },
  });
  try {
    const ok = await orderGet(new Request(`${SITE}/api/order?session_id=cs_test_playwright`));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ok.json(), order);
    const missing = await orderGet(new Request(`${SITE}/api/order?session_id=cs_test_missing01`));
    assert.equal(missing.status, 404);
    const bad = await orderGet(new Request(`${SITE}/api/order?session_id=nope`));
    assert.equal(bad.status, 400);
    assert.deepEqual(calls, ['cs_test_playwright', 'cs_test_missing01']);
  } finally {
    runtime.createStripe = originalStripe;
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  }
});
