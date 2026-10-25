import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Stripe from 'stripe';
import { createCheckoutSession, promoCodesEnabled } from '../lib/checkout.js';
import { orderConfirmationMessage } from '../lib/order-mail.js';
import { discountFromSession, formatDiscountLine, publicOrder, settledPaymentStatus } from '../lib/order.js';
import { buildPrintfulOrder, printfulExternalId } from '../lib/printful.js';
import { priceCart } from '../lib/prices.js';
import { handlePrintfulWebhook } from '../lib/printful-webhook.js';
import { handleStripeWebhook } from '../lib/webhook.js';

const SITE = 'https://trimojiapparel.com';
const SECRET = 'whsec_test_secret';
const WEBHOOK_SECRET = 'pf_whsec_test_value';

function sampleItem(overrides = {}) {
  return {
    product: 'tee',
    color: 'Black',
    size: 'L',
    quantity: 1,
    emojis: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 100,
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
          return { id: 'cs_test_12345678', url: 'https://checkout.stripe.com/c/pay/cs_test_12345678' };
        },
      },
    },
  };
}

function teeMetadata() {
  return {
    v: '1',
    n: '1',
    i0: JSON.stringify({
      p: 'tee', c: 'Black', s: 'L', q: 1, e: ['🔥', '😎', '🍕'], slots: ['🔥', '😎', '🍕'], l: 'row', z: 100,
    }),
  };
}

function sessionShell(overrides = {}) {
  return {
    id: 'cs_test_12345678',
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 3499,
    currency: 'usd',
    metadata: teeMetadata(),
    customer_details: { email: 'ada@example.com', name: 'Ada Lovelace' },
    shipping_details: {
      name: 'Ada Lovelace',
      address: {
        line1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
      },
    },
    ...overrides,
  };
}

test('discount lines use the code, then the coupon name', () => {
  assert.equal(formatDiscountLine(null), '');
  assert.equal(formatDiscountLine({ amount: 0, label: 'WELCOME' }), '');
  assert.equal(formatDiscountLine({ amount: 500 }), 'Discount -$5.00');
  assert.equal(formatDiscountLine({ amount: 500, label: '  WELCOME \n' }), 'Discount WELCOME -$5.00');
  assert.equal(formatDiscountLine({ amount: 3499, label: 'FREEBIE' }), 'Discount FREEBIE -$34.99');
  assert.equal(formatDiscountLine({ amount: 1000, label: 'Welcome five' }), 'Discount Welcome five -$10.00');

  const coded = discountFromSession({
    total_details: { amount_discount: 500 },
    discounts: [{
      promotion_code: { id: 'promo_welcome', code: 'WELCOME', coupon: { name: 'Welcome five' } },
      coupon: { id: 'coupon_welcome', name: 'Welcome five' },
    }],
  });
  assert.equal(coded.label, 'WELCOME');
  assert.equal(coded.line, 'Discount WELCOME -$5.00');

  const named = discountFromSession({
    total_details: { amount_discount: 1000 },
    discounts: [{ promotion_code: 'promo_123', coupon: { name: 'Friends and family' } }],
  });
  assert.equal(named.label, 'Friends and family');
  assert.equal(named.line, 'Discount Friends and family -$10.00');

  const nested = discountFromSession({
    total_details: { amount_discount: 200 },
    discounts: [{ promotion_code: { code: '', promotion: { coupon: { name: 'Spring' } } } }],
  });
  assert.equal(nested.label, 'Spring');

  const plain = discountFromSession({
    total_details: { amount_discount: 250 },
    discounts: [{ promotion_code: 'promo_123', coupon: 'coupon_123' }],
  });
  assert.equal(plain.label, '');
  assert.equal(plain.line, 'Discount -$2.50');
  assert.equal(discountFromSession({ total_details: { amount_discount: 0 } }), null);

  const message = orderConfirmationMessage({
    to: 'ada@example.com',
    reference: 'a'.repeat(32),
    items: [{ name: 'T-shirt', emojis: ['🔥'], color: 'Black', size: 'L', quantity: 1 }],
    total: 0,
    tax: 0,
    discount: { amount: 3499, label: '<script>FREEBIE' },
    shipTo: { name: 'Ada', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
  });
  assert.match(message.html, /Discount &lt;script&gt;FREEBIE -\$34\.99/);
  assert.match(message.text, /Discount <script>FREEBIE -\$34\.99/);
  assert.match(message.html, /Amount paid \$0\.00/);
  assert.match(message.text, /Amount paid \$0\.00/);
  assert.match(message.html, /Tax \$0\.00/);
  assert.equal(message.html.includes('<script>'), false);
});

test('a receipt keeps catalog shipping and uses amount paid after the discount', () => {
  const metadata = teeMetadata();
  const partial = publicOrder(sessionShell({
    metadata,
    amount_total: 3216,
    total_details: { amount_discount: 500, amount_shipping: 599, amount_tax: 217 },
    discounts: [{ promotion_code: { code: 'WELCOME' }, coupon: { name: 'Welcome five' } }],
  }));
  assert.equal(partial.subtotal, 2900);
  assert.equal(partial.shipping, 599);
  assert.equal(partial.tax, 217);
  assert.equal(partial.total, 3216);
  assert.equal(partial.discount.line, 'Discount WELCOME -$5.00');

  const free = publicOrder(sessionShell({
    payment_status: 'no_payment_required',
    amount_total: 0,
    total_details: { amount_discount: 3499, amount_shipping: 599, amount_tax: 0 },
    discounts: [{ promotion_code: { code: 'FREEBIE' } }],
  }));
  assert.equal(free.shipping, 599);
  assert.equal(free.tax, 0);
  assert.equal(free.total, 0);
  assert.equal(free.discount.amount, 3499);
  assert.equal(free.discount.line, 'Discount FREEBIE -$34.99');
  assert.equal(settledPaymentStatus('no_payment_required'), true);
  assert.equal(settledPaymentStatus('paid'), true);
  assert.equal(settledPaymentStatus('unpaid'), false);

  const over = priceCart([
    sampleItem(),
    sampleItem({ product: 'hoodie', color: 'Navy', size: 'M' }),
  ]);
  assert.equal(over.subtotal, 8300);
  assert.equal(over.shipping, 0);
  const discountedFreeShipping = publicOrder(sessionShell({
    metadata: {
      v: '1',
      n: '2',
      i0: JSON.stringify({
        p: 'tee', c: 'Black', s: 'L', q: 1, e: ['🔥', '😎', '🍕'], slots: ['🔥', '😎', '🍕'], l: 'row', z: 100,
      }),
      i1: JSON.stringify({
        p: 'hoodie', c: 'Navy', s: 'M', q: 1, e: ['🔥', '😎', '🍕'], slots: ['🔥', '😎', '🍕'], l: 'row', z: 100,
      }),
    },
    amount_total: 7300,
    total_details: { amount_discount: 1000, amount_shipping: 0, amount_tax: 0 },
    discounts: [{ coupon: { name: 'Ten off' } }],
  }));
  assert.equal(discountedFreeShipping.subtotal, 8300);
  assert.equal(discountedFreeShipping.shipping, 0);
  assert.equal(discountedFreeShipping.total, 7300);
  assert.equal(discountedFreeShipping.discount.line, 'Discount Ten off -$10.00');
});

test('promotion codes stay on with tax and can be switched off', async () => {
  assert.equal(promoCodesEnabled({}), true);
  assert.equal(promoCodesEnabled({ PROMO_CODES_ENABLED: 'true' }), true);
  assert.equal(promoCodesEnabled({ PROMO_CODES_ENABLED: '' }), true);
  for (const value of ['false', '0', 'no', 'off', 'FALSE', ' Off ']) {
    assert.equal(promoCodesEnabled({ PROMO_CODES_ENABLED: value }), false, value);
  }

  const stripe = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem()],
    stripe,
    siteUrl: SITE,
    env: {},
  });
  const params = stripe.calls[0];
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.payment_method_collection, undefined);
  assert.deepEqual(params.automatic_tax, { enabled: true });
  assert.equal(params.line_items[0].price_data.tax_behavior, 'exclusive');
  assert.equal(params.shipping_options[0].shipping_rate_data.tax_behavior, 'exclusive');
  assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, priceCart([sampleItem()]).shipping);
  assert.equal(params.discounts, undefined);

  const off = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem()],
    stripe: off,
    siteUrl: SITE,
    env: { PROMO_CODES_ENABLED: 'no', STRIPE_TAX_ENABLED: 'false' },
  });
  assert.equal(off.calls[0].allow_promotion_codes, undefined);
  assert.equal(off.calls[0].automatic_tax, undefined);
  assert.equal(off.calls[0].line_items[1].price_data.unit_amount, 599);
  assert.equal(off.calls[0].payment_method_collection, undefined);

  const success = readFileSync(new URL('../success.html', import.meta.url), 'utf8');
  assert.match(success, /id="discount"/);
  assert.match(success, /discount\.line/);
  assert.match(success, /data\.tax!=null/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /PROMO_CODES_ENABLED/);
  const doc = readFileSync(new URL('../docs/promotions.md', import.meta.url), 'utf8');
  assert.match(doc, /Products > Coupons|Product catalog → Coupons/);
  assert.match(doc, /Create promotion code/);
  assert.match(doc, /first-time/i);
  assert.match(doc, /minimum order/i);
  assert.match(doc, /expir/i);
});

test('a 100% discount webhook still creates the Printful order at catalog retail', async () => {
  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem()], stripe, siteUrl: SITE, env: {} });
  const metadata = stripe.calls[0].metadata;
  const session = sessionShell({
    id: 'cs_test_freeorder1',
    payment_status: 'no_payment_required',
    amount_total: 0,
    metadata,
    total_details: { amount_discount: 3499, amount_shipping: 599, amount_tax: 0 },
    discounts: [{
      coupon: { id: 'coupon_free', name: 'Free order', percent_off: 100 },
      promotion_code: { id: 'promo_free', code: 'FREEBIE' },
    }],
  });
  const built = buildPrintfulOrder({ session, siteUrl: SITE });
  assert.equal(built.items[0].retail_price, '29.00');
  assert.equal(built.items[0].quantity, 1);
  assert.equal(built.shipping, 'STANDARD');
  assert.equal(JSON.stringify(built).includes('FREEBIE'), false);
  assert.equal(JSON.stringify(built).includes('amount_discount'), false);

  const env = {
    STRIPE_WEBHOOK_SECRET: SECRET,
    PRINTFUL_API_TOKEN: 'pf_test_token',
    PRINTFUL_STORE_ID: '18937301',
    SITE_URL: SITE,
    RESEND_API_KEY: 're_test_key_marker',
    PRINTFUL_AUTO_CONFIRM: 'false',
  };
  const payload = JSON.stringify({
    id: 'evt_free',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  });
  const stripeLib = new Stripe('sk_test_placeholder');
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const calls = [];
  const ok = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env,
    stripe: stripeLib,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('api.resend.com')) {
        return new Response(JSON.stringify({ id: 'email_free' }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { id: 77, status: 'draft' } }), { status: 200 });
    },
  });
  assert.equal(ok.received, true);
  assert.equal(ok.confirm, false);
  assert.equal(ok.printfulOrderId, 77);
  const printful = calls.find((call) => call.url.includes('api.printful.com/orders'));
  const body = JSON.parse(printful.options.body);
  assert.equal(body.external_id, printfulExternalId(session.id));
  assert.equal(body.items[0].retail_price, '29.00');
  assert.equal(body.items[0].variant_id, 4018);
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.shipping, 'STANDARD');
  assert.equal(JSON.stringify(body).includes('0.00'), false);
  assert.equal(new URL(printful.url).searchParams.get('confirm'), 'false');
  const mail = JSON.parse(calls.find((call) => call.url.includes('api.resend.com')).options.body);
  assert.match(mail.html, /Discount FREEBIE -\$34\.99/);
  assert.match(mail.text, /Discount FREEBIE -\$34\.99/);
  assert.match(mail.html, /Amount paid \$0\.00/);
  assert.match(mail.text, /Amount paid \$0\.00/);
  assert.match(mail.html, /Tax \$0\.00/);
  assert.match(mail.html, /T-shirt/);

  const bare = {
    ...session,
    id: 'cs_test_freeorder2',
    discounts: [{ coupon: 'coupon_free', promotion_code: 'promo_free' }],
  };
  const barePayload = JSON.stringify({
    id: 'evt_free_expand',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: bare },
  });
  const bareHeader = Stripe.webhooks.generateTestHeaderString({ payload: barePayload, secret: SECRET });
  const retrieved = [];
  const expandedCalls = [];
  const expanded = await handleStripeWebhook({
    rawBody: barePayload,
    signature: bareHeader,
    env,
    stripe: {
      webhooks: stripeLib.webhooks,
      checkout: {
        sessions: {
          async retrieve(id, params) {
            retrieved.push({ id, params });
            return {
              ...bare,
              discounts: [{ promotion_code: { code: 'FREEBIE' }, coupon: { name: 'Free order' } }],
            };
          },
        },
      },
    },
    fetchImpl: async (url, options) => {
      expandedCalls.push({ url: String(url), options });
      if (String(url).includes('api.resend.com')) {
        return new Response(JSON.stringify({ id: 'email_free_2' }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { id: 78 } }), { status: 200 });
    },
  });
  assert.equal(expanded.printfulOrderId, 78);
  assert.deepEqual(retrieved, [{
    id: 'cs_test_freeorder2',
    params: { expand: ['discounts.promotion_code', 'discounts.coupon'] },
  }]);
  const expandedBody = JSON.parse(expandedCalls.find((call) => call.url.includes('api.printful.com')).options.body);
  assert.equal(expandedBody.items[0].retail_price, '29.00');
  const expandedMail = JSON.parse(expandedCalls.find((call) => call.url.includes('api.resend.com')).options.body);
  assert.match(expandedMail.html, /Discount FREEBIE -\$34\.99/);
  assert.match(expandedMail.text, /Amount paid \$0\.00/);

  let printfulCalled = false;
  const unpaidPayload = JSON.stringify({
    id: 'evt_unpaid',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { ...session, id: 'cs_test_unpaid01', payment_status: 'unpaid' } },
  });
  const unpaidHeader = Stripe.webhooks.generateTestHeaderString({ payload: unpaidPayload, secret: SECRET });
  const ignored = await handleStripeWebhook({
    rawBody: unpaidPayload,
    signature: unpaidHeader,
    env,
    stripe: stripeLib,
    fetchImpl: async () => {
      printfulCalled = true;
      return new Response(JSON.stringify({ result: { id: 1 } }), { status: 200 });
    },
  });
  assert.deepEqual(ignored, { received: true, ignored: true });
  assert.equal(printfulCalled, false);

  const paidZero = {
    ...session,
    id: 'cs_test_paidzero1',
    payment_status: 'paid',
  };
  const paidPayload = JSON.stringify({
    id: 'evt_paid_zero',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: paidZero },
  });
  const paidHeader = Stripe.webhooks.generateTestHeaderString({ payload: paidPayload, secret: SECRET });
  const paidCalls = [];
  const paid = await handleStripeWebhook({
    rawBody: paidPayload,
    signature: paidHeader,
    env,
    stripe: stripeLib,
    fetchImpl: async (url, options) => {
      paidCalls.push({ url: String(url), options });
      if (String(url).includes('api.resend.com')) {
        return new Response(JSON.stringify({ id: 'email_paid_zero' }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { id: 79 } }), { status: 200 });
    },
  });
  assert.equal(paid.printfulOrderId, 79);
  const paidBody = JSON.parse(paidCalls.find((call) => call.url.includes('api.printful.com')).options.body);
  assert.equal(paidBody.items[0].retail_price, '29.00');
  const paidMail = JSON.parse(paidCalls.find((call) => call.url.includes('api.resend.com')).options.body);
  assert.match(paidMail.html, /Amount paid \$0\.00/);
});

test('a fully discounted order can still receive the shipment email', async () => {
  const sessionId = 'cs_test_12345678';
  const externalId = printfulExternalId(sessionId);
  const url = `https://trimojiapparel.com/api/printful-webhook?secret=${WEBHOOK_SECRET}`;
  const calls = [];
  const result = await handlePrintfulWebhook({
    url,
    rawBody: JSON.stringify({
      type: 'package_shipped',
      data: {
        shipment: {
          carrier: 'USPS',
          tracking_number: '1Z000',
          tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=1Z000',
          items: [{ item_id: 1, quantity: 1 }],
        },
        order: {
          id: 21,
          external_id: externalId,
          packing_slip: { message: `Stripe session ${sessionId}` },
          recipient: { city: 'Austin', state_code: 'TX' },
          items: [{ id: 1, name: 'Trimoji T-shirt', quantity: 1 }],
        },
      },
    }),
    env: {
      PRINTFUL_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RESEND_API_KEY: 're_test_key_marker',
    },
    fetchImpl: async (requestUrl, options) => {
      calls.push({ url: String(requestUrl), options });
      return new Response(JSON.stringify({ id: 'email_ship' }), { status: 200 });
    },
    stripe: {
      checkout: {
        sessions: {
          async retrieve() {
            return {
              id: sessionId,
              payment_status: 'no_payment_required',
              amount_total: 0,
              customer_details: { email: 'buyer@example.com' },
            };
          },
        },
      },
    },
  });
  assert.equal(result.emailed, true);
  const mail = JSON.parse(calls[0].options.body);
  assert.equal(mail.to, 'buyer@example.com');
  assert.match(mail.html, /1Z000/);
});
