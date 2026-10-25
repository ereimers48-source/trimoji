import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Stripe from 'stripe';
import { POST as printfulWebhookPost } from '../api/printful-webhook.js';
import { SHIPPING_TAX_CODE, createCheckoutSession, stripeTaxEnabled } from '../lib/checkout.js';
import {
  orderConfirmationMessage,
  orderIdempotencyKey,
  sendOrderConfirmation,
  sessionIdFromPackingSlip,
  shipmentIdempotencyKey,
  shipmentMessage,
} from '../lib/order-mail.js';
import { handlePrintfulWebhook, webhookSecretMatches } from '../lib/printful-webhook.js';
import { buildPrintfulOrder, printfulExternalId } from '../lib/printful.js';
import { runtime } from '../lib/runtime.js';
import { handleStripeWebhook } from '../lib/webhook.js';

const SITE = 'https://trimojiapparel.com';
const SECRET = 'whsec_test_secret';
const WEBHOOK_SECRET = 'pf_whsec_test_value';
const RESEND_KEY = 're_test_key_marker';
const SESSION_ID = 'cs_test_12345678';

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
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' };
        },
      },
    },
  };
}

function paidSession(metadata, overrides = {}) {
  return {
    id: SESSION_ID,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 3716,
    total_details: { amount_tax: 217, amount_shipping: 599 },
    metadata,
    customer_details: { email: 'Ada@Example.com', name: 'Ada Lovelace', phone: '555-0100' },
    shipping_details: {
      name: 'Ada Lovelace',
      phone: '555-0199',
      address: {
        line1: '1 Main St',
        line2: 'Apt 2',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
      },
    },
    ...overrides,
  };
}

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

function resendOk(calls) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  };
}

test('order and shipping templates escape customer text and keep the receipt facts', () => {
  const message = orderConfirmationMessage({
    to: 'ada@example.com',
    reference: 'a'.repeat(32),
    items: [{ name: 'T-shirt', emojis: ['<b>', '🔥'], color: 'Black"<', size: 'L', quantity: 2 }],
    total: 3716,
    tax: 217,
    shipTo: {
      name: '<script>alert(1)</script>',
      line1: '1 "Main" & Co',
      line2: '',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
    },
  });
  assert.equal(message.from, 'Trimoji <hello@trimojiapparel.com>');
  assert.equal(message.subject, 'Your Trimoji order');
  assert.equal(message.html.includes('<script>'), false);
  assert.equal(message.html.includes('<b>'), false);
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.html, /&lt;b&gt;/);
  assert.match(message.html, /&quot;/);
  assert.match(message.html, /&amp;/);
  assert.match(message.html, /T-shirt/);
  assert.match(message.html, /🔥/);
  assert.match(message.html, /2 ×/);
  assert.match(message.html, /Amount paid \$37\.16/);
  assert.match(message.html, /Tax \$2\.17/);
  assert.equal(message.html.includes('Amount paid $34.99'), false);
  assert.match(message.text, /Amount paid \$37\.16/);
  assert.match(message.text, /Tax \$2\.17/);
  assert.match(message.html, /We'll email tracking when it ships/);
  assert.match(message.text, /We'll email tracking when it ships/);
  assert.match(message.html, /2–5 business days/);
  assert.match(message.html, /3–4 business days/);
  assert.match(message.text, /made to order/i);
  assert.match(message.html, /https:\/\/trimojiapparel\.com\/returns/);
  assert.match(message.html, /hello@trimojiapparel\.com/);
  assert.match(message.html, /Austin/);
  assert.match(message.html, /78701/);

  const zeroTax = orderConfirmationMessage({
    to: 'ada@example.com',
    reference: 'b'.repeat(32),
    items: [{ name: 'Mug', emojis: ['🔥'], color: 'White', size: '11 oz', quantity: 1 }],
    total: 2499,
    tax: 0,
    shipTo: { name: 'Ada', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
  });
  assert.match(zeroTax.html, /Amount paid \$24\.99/);
  assert.match(zeroTax.html, /Tax \$0\.00/);

  const shipped = shipmentMessage({
    to: 'ada@example.com',
    reference: 'abc',
    items: [{ name: 'Hoodie <i>', quantity: 1 }],
    carrier: 'USPS <x>',
    trackingNumber: '1Z999',
    trackingUrl: 'javascript:alert(1)',
    city: 'Austin<script>',
    state: 'TX',
  });
  assert.equal(shipped.subject, 'Your Trimoji order has shipped');
  assert.equal(shipped.html.includes('javascript:'), false);
  assert.equal(shipped.html.includes('<script>'), false);
  assert.equal(shipped.html.includes('<i>'), false);
  assert.equal(shipped.html.includes('<x>'), false);
  assert.match(shipped.html, /USPS/);
  assert.match(shipped.html, /1Z999/);
  assert.match(shipped.html, /Austin/);
  assert.match(shipped.html, /TX/);
  assert.equal(shipped.html.includes('1 Secret'), false);
  assert.equal(shipped.text.includes('1 Secret'), false);

  const linked = shipmentMessage({
    to: 'ada@example.com',
    reference: 'abc',
    items: [{ name: 'T-shirt', quantity: 2 }],
    carrier: 'UPS',
    trackingNumber: '1Z999',
    trackingUrl: 'https://www.ups.com/track?tracknum=1Z999',
    city: 'Austin',
    state: 'TX',
  });
  assert.match(linked.html, /href="https:\/\/www\.ups\.com\/track\?tracknum=1Z999"/);
  assert.match(linked.html, /Track your order/);
  assert.match(linked.html, /2 ×/);
  assert.match(linked.text, /https:\/\/www\.ups\.com\/track\?tracknum=1Z999/);
});

test('stripe tax stays exclusive and can be switched off', async () => {
  assert.equal(stripeTaxEnabled({}), true);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'true' }), true);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'false' }), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'OFF' }), false);
  assert.equal(SHIPPING_TAX_CODE, 'txcd_92010001');

  const stripe = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem(), sampleItem({ product: 'hoodie', color: 'Navy', size: 'M' })],
    stripe,
    siteUrl: SITE,
    env: {},
  });
  const taxed = stripe.calls[0];
  assert.deepEqual(taxed.automatic_tax, { enabled: true });
  assert.equal(taxed.allow_promotion_codes, true);
  assert.equal(taxed.payment_method_collection, undefined);
  assert.deepEqual(taxed.shipping_address_collection, { allowed_countries: ['US'] });
  assert.equal(taxed.line_items.length, 2);
  assert.equal(taxed.line_items[0].price_data.unit_amount, 2900);
  assert.equal(taxed.line_items[1].price_data.unit_amount, 5400);
  assert.equal(taxed.line_items[0].price_data.tax_behavior, 'exclusive');
  assert.equal(taxed.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
  assert.equal(taxed.shipping_options[0].shipping_rate_data.tax_behavior, 'exclusive');
  assert.equal(taxed.shipping_options[0].shipping_rate_data.tax_code, 'txcd_92010001');
  assert.equal(JSON.stringify(taxed.line_items).includes('"unit_amount":599'), false);

  const off = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem({ product: 'mug', color: 'White', size: '11 oz' })],
    stripe: off,
    siteUrl: SITE,
    env: { STRIPE_TAX_ENABLED: 'false' },
  });
  const plain = off.calls[0];
  assert.equal(plain.automatic_tax, undefined);
  assert.equal(plain.shipping_options, undefined);
  assert.equal(plain.line_items[0].price_data.unit_amount, 1900);
  assert.equal(plain.line_items[0].price_data.tax_behavior, undefined);
  assert.equal(plain.line_items[1].price_data.unit_amount, 599);
  assert.equal(plain.line_items[1].price_data.product_data.name, 'US shipping');
  assert.equal(plain.line_items[1].price_data.tax_behavior, undefined);
  assert.deepEqual(plain.shipping_address_collection, { allowed_countries: ['US'] });

  const hat = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem({ product: 'hat', color: 'Navy', size: 'One size' })],
    stripe: hat,
    siteUrl: SITE,
    env: {},
  });
  assert.equal(hat.calls[0].line_items[0].price_data.unit_amount, 3300);
  assert.equal(hat.calls[0].shipping_options[0].shipping_rate_data.fixed_amount.amount, 599);

  const phone = fakeStripe();
  await createCheckoutSession({
    items: [sampleItem({ product: 'case', color: 'Matte', size: 'iPhone 16' })],
    stripe: phone,
    siteUrl: SITE,
    env: {},
  });
  assert.equal(phone.calls[0].line_items[0].price_data.unit_amount, 2900);
  assert.match(phone.calls[0].line_items[0].price_data.product_data.name, /Tough phone case/);
});

test('confirmation mail is idempotent and a send failure does not fail the order', async () => {
  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem()], stripe, siteUrl: SITE, env: { STRIPE_TAX_ENABLED: 'false' } });
  const session = paidSession(stripe.calls[0].metadata, {
    shipping_details: {
      name: '<script>alert(1)</script>',
      phone: '555-0199',
      address: {
        line1: '1 Main <b>St',
        line2: 'Apt 2',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
      },
    },
  });
  const externalId = printfulExternalId(session.id);
  assert.equal(orderIdempotencyKey(externalId), `order-confirmation/${externalId}`);
  const order = buildPrintfulOrder({ session, siteUrl: SITE });
  assert.equal(order.recipient.email, undefined);
  assert.equal(order.recipient.phone, undefined);
  assert.equal(JSON.stringify(order).includes('Ada@Example.com'), false);
  assert.equal(JSON.stringify(order).includes('555-0199'), false);
  assert.equal(order.packing_slip.message, `Stripe session ${session.id}`);

  const calls = [];
  const env = {
    STRIPE_WEBHOOK_SECRET: SECRET,
    PRINTFUL_API_TOKEN: 'pf_test_token',
    PRINTFUL_STORE_ID: '18937301',
    SITE_URL: SITE,
    RESEND_API_KEY: RESEND_KEY,
  };
  const payload = JSON.stringify({
    id: 'evt_mail',
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
    fetchImpl: async (url, options) => {
      const href = String(url);
      calls.push({ url: href, options });
      if (href.includes('api.resend.com')) {
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { id: 99 } }), { status: 200 });
    },
  });
  assert.equal(ok.printfulOrderId, 99);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /api\.printful\.com\/orders/);
  const printfulBody = JSON.parse(calls[0].options.body);
  assert.equal(printfulBody.recipient.email, undefined);
  assert.equal(printfulBody.recipient.phone, undefined);
  assert.equal(JSON.stringify(printfulBody).includes('Ada@Example.com'), false);
  assert.equal(JSON.stringify(printfulBody).includes('555-'), false);
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  assert.equal(calls[1].options.headers['Idempotency-Key'], `order-confirmation/${externalId}`);
  assert.equal(calls[1].options.headers['Idempotency-Key'].includes('@'), false);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${RESEND_KEY}`);
  const mail = JSON.parse(calls[1].options.body);
  assert.equal(mail.from, 'Trimoji <hello@trimojiapparel.com>');
  assert.equal(mail.to, 'ada@example.com');
  assert.equal(mail.reply_to, 'hello@trimojiapparel.com');
  assert.match(mail.html, /T-shirt/);
  assert.match(mail.html, /🔥/);
  assert.match(mail.html, /Black/);
  assert.match(mail.html, /L/);
  assert.match(mail.html, /Amount paid \$37\.16/);
  assert.match(mail.html, /Tax \$2\.17/);
  assert.match(mail.html, /Austin/);
  assert.match(mail.html, /78701/);
  assert.equal(mail.html.includes('<script>'), false);
  assert.equal(mail.html.includes('<b>'), false);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /&lt;b&gt;/);

  calls.length = 0;
  const logs = await captureErrors(async () => {
    const still = await handleStripeWebhook({
      rawBody: payload,
      signature: header,
      env,
      stripe: stripeLib,
      fetchImpl: async (url, options) => {
        const href = String(url);
        calls.push({ url: href, options });
        if (href.includes('api.resend.com')) {
          return new Response(JSON.stringify({
            name: 'validation_error',
            message: `bad ada@example.com ${RESEND_KEY} BODYMARKER order-confirmation/${externalId} 1 Main St`,
          }), { status: 422 });
        }
        return new Response(JSON.stringify({ result: { id: 99 } }), { status: 200 });
      },
    });
    assert.equal(still.printfulOrderId, 99);
    assert.equal(still.received, true);
  });
  assert.deepEqual(logs, ['order mail failed via resend status=422 name=validation_error']);
  const logged = logs.join('\n');
  assert.equal(logged.includes(RESEND_KEY), false);
  assert.equal(logged.includes('ada@example.com'), false);
  assert.equal(logged.includes('BODYMARKER'), false);
  assert.equal(logged.includes(externalId), false);
  assert.equal(logged.includes('1 Main'), false);
  assert.equal(calls[1].options.headers['Idempotency-Key'], calls[0] && `order-confirmation/${externalId}`);

  const network = new TypeError(`connect failed ${RESEND_KEY} ada@example.com BODYMARKER`);
  network.code = 'ECONNRESET';
  const networkLogs = await captureErrors(async () => {
    const still = await handleStripeWebhook({
      rawBody: payload,
      signature: header,
      env,
      stripe: stripeLib,
      fetchImpl: async (url) => {
        if (String(url).includes('api.resend.com')) throw network;
        return new Response(JSON.stringify({ result: { id: 98 } }), { status: 200 });
      },
    });
    assert.equal(still.printfulOrderId, 98);
  });
  assert.deepEqual(networkLogs, ['order mail failed via resend status=none name=TypeError code=ECONNRESET']);
  assert.equal(networkLogs.join('\n').includes(RESEND_KEY), false);
  assert.equal(networkLogs.join('\n').includes('ada@example.com'), false);

  let resendCalled = false;
  await assert.rejects(
    () => handleStripeWebhook({
      rawBody: payload,
      signature: header,
      env,
      stripe: stripeLib,
      fetchImpl: async (url) => {
        if (String(url).includes('api.resend.com')) resendCalled = true;
        return new Response(JSON.stringify({ error: { message: 'Invalid variant' } }), { status: 400 });
      },
    }),
    (err) => err.status === 400 && err.message === 'Invalid variant',
  );
  assert.equal(resendCalled, false);

  const replayCalls = [];
  const duplicate = await handleStripeWebhook({
    rawBody: payload,
    signature: header,
    env,
    stripe: stripeLib,
    fetchImpl: async (url, options) => {
      replayCalls.push({ url: String(url), options });
      if (String(url).includes('api.resend.com')) {
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        error: { message: 'Order with External ID already exists' },
      }), { status: 400 });
    },
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.received, true);
  const replayMail = replayCalls.find((call) => call.url.includes('api.resend.com'));
  assert.equal(replayMail.options.headers['Idempotency-Key'], `order-confirmation/${externalId}`);

  const missingLogs = await captureErrors(() => sendOrderConfirmation({
    session: { ...session, customer_details: { email: '' } },
    externalId,
    env,
    fetchImpl: async () => { throw new Error('should not send'); },
  }));
  assert.deepEqual(missingLogs, ['order mail failed via resend status=none name=no_recipient']);
});

test('printful webhook secret is required and shipment mail uses the stripe session', async () => {
  assert.equal(webhookSecretMatches('short', 'a-much-longer-secret'), false);
  assert.equal(webhookSecretMatches('abc', 'abcdef'), false);
  assert.equal(webhookSecretMatches('abcdef', 'abc'), false);
  assert.equal(webhookSecretMatches('', WEBHOOK_SECRET), false);
  assert.equal(webhookSecretMatches(WEBHOOK_SECRET, ''), false);
  assert.equal(webhookSecretMatches(null, WEBHOOK_SECRET), false);
  assert.equal(webhookSecretMatches(WEBHOOK_SECRET, WEBHOOK_SECRET), true);
  assert.equal(webhookSecretMatches(WEBHOOK_SECRET, `  ${WEBHOOK_SECRET}  `), true);
  assert.equal(sessionIdFromPackingSlip(`Stripe session ${SESSION_ID}`), SESSION_ID);
  assert.equal(sessionIdFromPackingSlip('Stripe session nope'), '');
  assert.equal(shipmentIdempotencyKey(13, '1Z999'), 'shipment/13/1Z999');
  assert.notEqual(shipmentIdempotencyKey(13, '1Z999'), shipmentIdempotencyKey(13, '1Z998'));

  const url = `https://trimojiapparel.com/api/printful-webhook?secret=${WEBHOOK_SECRET}`;
  let read = false;
  const deniedLogs = await captureErrors(() => assert.rejects(
    () => handlePrintfulWebhook({
      url: 'https://trimojiapparel.com/api/printful-webhook?secret=wrong-secret',
      readBody: async () => {
        read = true;
        return '{}';
      },
      env: { PRINTFUL_WEBHOOK_SECRET: WEBHOOK_SECRET },
      stripe: { checkout: { sessions: { retrieve() { throw new Error('should not retrieve'); } } } },
    }),
    (err) => err.status === 401 && err.message === 'Unauthorized' && !err.message.includes(WEBHOOK_SECRET),
  ));
  assert.equal(read, false);
  assert.equal(deniedLogs.join('\n').includes(WEBHOOK_SECRET), false);
  assert.equal(deniedLogs.join('\n').includes('wrong-secret'), false);

  const ignored = await handlePrintfulWebhook({
    url,
    rawBody: 'not-json ada@example.com',
    env: { PRINTFUL_WEBHOOK_SECRET: WEBHOOK_SECRET },
  });
  assert.deepEqual(ignored, { received: true, ignored: true });

  const externalId = printfulExternalId(SESSION_ID);
  const shipped = {
    type: 'package_shipped',
    data: {
      shipment: {
        id: 10,
        carrier: 'USPS',
        tracking_number: '1Z999',
        tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=1Z999',
        items: [{ item_id: 1, quantity: 1 }],
      },
      order: {
        id: 13,
        external_id: externalId,
        packing_slip: { message: `Stripe session ${SESSION_ID}` },
        recipient: {
          email: 'decoy@example.com',
          phone: '555-0199',
          address1: '9 Hidden Rd',
          city: 'Austin<script>',
          state_code: 'TX',
        },
        items: [
          { id: 1, name: 'Trimoji T-shirt <b>', quantity: 1 },
          { id: 2, name: 'Trimoji Mug', quantity: 1 },
        ],
      },
    },
  };
  const retrieved = [];
  const calls = [];
  const stripe = {
    checkout: {
      sessions: {
        async retrieve(id) {
          retrieved.push(id);
          return {
            id,
            payment_status: 'paid',
            customer_details: { email: 'Buyer@Example.com' },
          };
        },
      },
    },
  };
  const env = {
    PRINTFUL_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PRINTFUL_API_TOKEN: 'pf_test_token',
    PRINTFUL_STORE_ID: '18937301',
    RESEND_API_KEY: RESEND_KEY,
  };
  const sent = await handlePrintfulWebhook({
    url,
    rawBody: JSON.stringify(shipped),
    env,
    fetchImpl: async (requestUrl, options) => {
      const href = String(requestUrl);
      calls.push({ url: href, options });
      if (href.includes('api.printful.com')) throw new Error('payload already has the session id');
      return new Response(JSON.stringify({ id: 'email_2' }), { status: 200 });
    },
    stripe,
  });
  assert.deepEqual(sent, { received: true, emailed: true });
  assert.deepEqual(retrieved, [SESSION_ID]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'shipment/13/1Z999');
  const mail = JSON.parse(calls[0].options.body);
  assert.equal(mail.to, 'buyer@example.com');
  assert.equal(mail.reply_to, 'hello@trimojiapparel.com');
  assert.match(mail.html, /USPS/);
  assert.match(mail.html, /1Z999/);
  assert.match(mail.html, /href="https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=1Z999"/);
  assert.match(mail.html, /Trimoji T-shirt/);
  assert.equal(mail.html.includes('Trimoji Mug'), false);
  assert.equal(mail.html.includes('<b>'), false);
  assert.match(mail.html, /&lt;b&gt;/);
  assert.match(mail.html, /Austin/);
  assert.match(mail.html, /TX/);
  assert.equal(mail.html.includes('<script>'), false);
  assert.equal(mail.html.includes('9 Hidden'), false);
  assert.equal(mail.html.includes('decoy@example.com'), false);
  assert.equal(mail.html.includes('555-0199'), false);
  assert.equal(mail.text.includes('9 Hidden'), false);

  calls.length = 0;
  shipped.data.shipment.tracking_number = '1Z998';
  const again = await handlePrintfulWebhook({
    url,
    rawBody: JSON.stringify(shipped),
    env,
    fetchImpl: resendOk(calls),
    stripe,
  });
  assert.equal(again.emailed, true);
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'shipment/13/1Z998');
  shipped.data.shipment.tracking_number = '1Z999';
  calls.length = 0;
  await handlePrintfulWebhook({
    url,
    rawBody: JSON.stringify(shipped),
    env,
    fetchImpl: resendOk(calls),
    stripe,
  });
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'shipment/13/1Z999');

  const fetched = [];
  const lookup = await handlePrintfulWebhook({
    url,
    rawBody: JSON.stringify({
      type: 'package_shipped',
      data: {
        shipment: {
          carrier: 'UPS',
          tracking_number: '1Z777',
          tracking_url: 'https://www.ups.com/track?tracknum=1Z777',
          items: [{ item_id: 4, quantity: 1 }],
        },
        order: { id: 44 },
      },
    }),
    env,
    fetchImpl: async (requestUrl, options) => {
      const href = String(requestUrl);
      fetched.push({ url: href, options });
      if (href.includes('api.printful.com/orders/44')) {
        return new Response(JSON.stringify({
          result: {
            id: 44,
            external_id: externalId,
            packing_slip: { message: `Stripe session ${SESSION_ID}` },
            recipient: {
              email: 'decoy@example.com',
              phone: '555-0100',
              address1: '9 Hidden Rd',
              city: 'Dallas',
              state_code: 'TX',
            },
            items: [{ id: 4, name: 'Trimoji Hoodie', quantity: 1 }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'email_3' }), { status: 200 });
    },
    stripe,
  });
  assert.equal(lookup.emailed, true);
  assert.equal(fetched[0].url, 'https://api.printful.com/orders/44');
  assert.equal(fetched[0].options.headers.Authorization, 'Bearer pf_test_token');
  assert.equal(fetched[0].options.headers['X-PF-Store-Id'], '18937301');
  const lookedUp = JSON.parse(fetched[1].options.body);
  assert.equal(lookedUp.to, 'buyer@example.com');
  assert.match(lookedUp.html, /Dallas/);
  assert.match(lookedUp.html, /Hoodie/);
  assert.equal(lookedUp.html.includes('decoy@example.com'), false);
  assert.equal(lookedUp.html.includes('555-0100'), false);
  assert.equal(lookedUp.html.includes('9 Hidden'), false);
  assert.equal(fetched[1].options.headers['Idempotency-Key'], 'shipment/44/1Z777');

  const mismatchLogs = await captureErrors(async () => {
    const mismatch = await handlePrintfulWebhook({
      url,
      rawBody: JSON.stringify({
        type: 'package_shipped',
        data: {
          shipment: { carrier: 'USPS', tracking_number: '1Z999', tracking_url: 'https://example.com/t' },
          order: {
            id: 13,
            external_id: 'f'.repeat(32),
            packing_slip: { message: `Stripe session ${SESSION_ID}` },
            recipient: { email: 'decoy@example.com', city: 'Austin', state_code: 'TX' },
          },
        },
      }),
      env,
      fetchImpl: async () => { throw new Error('should not send'); },
      stripe: { checkout: { sessions: { async retrieve() { throw new Error('should not retrieve ada@example.com'); } } } },
    });
    assert.deepEqual(mismatch, { received: true, emailed: false });
  });
  assert.deepEqual(mismatchLogs, ['shipment mail failed via resend status=none name=order_mismatch']);
  assert.equal(mismatchLogs.join('\n').includes('ada@example.com'), false);

  const failedLogs = await captureErrors(async () => {
    const failed = await handlePrintfulWebhook({
      url,
      rawBody: JSON.stringify({
        type: 'order_failed',
        data: {
          reason: 'print file failed for ada@example.com at 1 Main St',
          order: { id: 13, recipient: { email: 'ada@example.com', address1: '1 Main St' } },
        },
      }),
      env,
      fetchImpl: async () => { throw new Error('should not send'); },
    });
    assert.deepEqual(failed, { received: true, emailed: false });
    const canceled = await handlePrintfulWebhook({
      url,
      rawBody: JSON.stringify({
        type: 'order_canceled',
        data: {
          reason: 'canceled ada@example.com',
          order: { id: '13 ada@example.com', recipient: { email: 'ada@example.com' } },
        },
      }),
      env,
      fetchImpl: async () => { throw new Error('should not send'); },
    });
    assert.equal(canceled.emailed, false);
  });
  assert.deepEqual(failedLogs, [
    'printful webhook order_failed id=13',
    'printful webhook order_canceled id=unknown',
  ]);
  assert.equal(failedLogs.join('\n').includes('ada@example.com'), false);
  assert.equal(failedLogs.join('\n').includes('1 Main'), false);
  assert.equal(failedLogs.join('\n').includes(WEBHOOK_SECRET), false);

  const mailFailLogs = await captureErrors(async () => {
    const failedMail = await handlePrintfulWebhook({
      url,
      rawBody: JSON.stringify(shipped),
      env,
      fetchImpl: async () => new Response(JSON.stringify({
        name: RESEND_KEY,
        message: 'BODYMARKER ada@example.com 9 Hidden Rd',
      }), { status: 500 }),
      stripe,
    });
    assert.deepEqual(failedMail, { received: true, emailed: false });
  });
  assert.deepEqual(mailFailLogs, ['shipment mail failed via resend status=500 name=unknown']);
  assert.equal(mailFailLogs.join('\n').includes(RESEND_KEY), false);
  assert.equal(mailFailLogs.join('\n').includes('ada@example.com'), false);
  assert.equal(mailFailLogs.join('\n').includes('BODYMARKER'), false);

  const previous = {
    secret: process.env.PRINTFUL_WEBHOOK_SECRET,
    key: process.env.STRIPE_SECRET_KEY,
    resend: process.env.RESEND_API_KEY,
    fetch: runtime.fetch,
    stripe: runtime.createStripe,
  };
  process.env.PRINTFUL_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  process.env.RESEND_API_KEY = RESEND_KEY;
  runtime.fetch = resendOk([]);
  runtime.createStripe = () => stripe;
  try {
    const blocked = await printfulWebhookPost(new Request(
      `https://trimojiapparel.com/api/printful-webhook?secret=wrong-secret`,
      {
        method: 'POST',
        body: JSON.stringify({ type: 'package_shipped', data: { order: { recipient: { email: 'ada@example.com' } } } }),
      },
    ));
    assert.equal(blocked.status, 401);
    const blockedText = await blocked.text();
    assert.equal(blockedText.includes(WEBHOOK_SECRET), false);
    assert.equal(blockedText.includes('wrong-secret'), false);
    assert.equal(blockedText.includes('ada@example.com'), false);

    const accepted = await printfulWebhookPost(new Request(url, {
      method: 'POST',
      body: JSON.stringify({
        type: 'order_canceled',
        data: { reason: 'stop', order: { id: 8, recipient: { email: 'ada@example.com' } } },
      }),
    }));
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.deepEqual(acceptedBody, { received: true, emailed: false });
  } finally {
    runtime.fetch = previous.fetch;
    runtime.createStripe = previous.stripe;
    if (previous.secret === undefined) delete process.env.PRINTFUL_WEBHOOK_SECRET;
    else process.env.PRINTFUL_WEBHOOK_SECRET = previous.secret;
    if (previous.key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous.key;
    if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.resend;
  }

  const success = readFileSync(new URL('../success.html', import.meta.url), 'utf8');
  assert.match(success, /data\.tax!=null/);
  assert.match(success, /Tax /);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /PRINTFUL_WEBHOOK_SECRET/);
  assert.match(readme, /STRIPE_TAX_ENABLED/);
  assert.match(readme, /api\/printful-webhook\?secret=/);
  assert.match(readme, /package_shipped/);
  assert.match(readme, /txcd_92010001/);
});
