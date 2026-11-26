import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCheckoutSession } from '../lib/checkout.js';
import {
  PROMO_CODE,
  PROMO_WINDOW,
  PROMO_WINDOW_SAMPLE_ISO,
  promoWindowBounds,
  promoWindowOpen,
  saleBannerText,
  zonedWallTimeToUtcMs,
} from '../lib/promo-window.js';

const SITE = 'https://trimojiapparel.com';
const BEFORE = '2026-11-27T07:59:59.999Z';
const START = '2026-11-27T08:00:00.000Z';
const END = '2026-12-01T07:59:59.999Z';
const AFTER = '2026-12-01T08:00:00.000Z';
const BANNER = 'Black Friday: 15% off everything with code HOLIDAY15 · ends Mon 11/30 11:59 PM PT';

function sampleItem() {
  return {
    product: 'tee',
    color: 'Black',
    size: 'L',
    quantity: 1,
    emojis: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 100,
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
          return { id: 'cs_test_promo', url: 'https://checkout.stripe.com/c/pay/cs_test_promo' };
        },
      },
    },
  };
}

function wallInZone(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(iso));
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  return map;
}

test('the holiday window is Pacific time, inclusive of both edges', () => {
  assert.equal(PROMO_WINDOW.timeZone, 'America/Los_Angeles');
  assert.equal(PROMO_CODE, 'HOLIDAY15');
  assert.equal(new Date(promoWindowBounds().startMs).toISOString(), START);
  assert.equal(new Date(promoWindowBounds().endMs).toISOString(), END);
  assert.deepEqual(wallInZone(START, PROMO_WINDOW.timeZone), {
    year: 2026, month: 11, day: 27, hour: 0, minute: 0, second: 0,
  });
  assert.deepEqual(wallInZone('2026-12-01T07:59:59.000Z', PROMO_WINDOW.timeZone), {
    year: 2026, month: 11, day: 30, hour: 23, minute: 59, second: 59,
  });

  assert.equal(zonedWallTimeToUtcMs(PROMO_WINDOW.start), Date.parse(START));
  assert.equal(zonedWallTimeToUtcMs(PROMO_WINDOW.end), Date.parse('2026-12-01T07:59:59.000Z'));
  assert.equal(
    zonedWallTimeToUtcMs({ year: 2026, month: 7, day: 1, hour: 0, minute: 0, second: 0 }),
    Date.parse('2026-07-01T07:00:00.000Z'),
  );

  assert.equal(promoWindowOpen(new Date('2026-11-26T18:00:00.000Z')), false);
  assert.equal(promoWindowOpen(new Date(BEFORE)), false);
  assert.equal(promoWindowOpen(new Date(START)), true);
  assert.equal(promoWindowOpen(new Date(PROMO_WINDOW_SAMPLE_ISO)), true);
  assert.equal(promoWindowOpen(new Date('2026-11-30T20:00:00.000Z')), true);
  assert.equal(promoWindowOpen(new Date('2026-12-01T07:59:59.000Z')), true);
  assert.equal(promoWindowOpen(new Date(END)), true);
  assert.equal(promoWindowOpen(new Date(AFTER)), false);
  assert.equal(promoWindowOpen(new Date('2026-12-02T00:00:00.000Z')), false);
  assert.equal(promoWindowOpen(new Date(NaN)), false);
  assert.equal(promoWindowOpen('not-a-date'), false);

  const summer = {
    timeZone: 'America/Los_Angeles',
    start: { year: 2026, month: 7, day: 1, hour: 0, minute: 0, second: 0 },
    end: { year: 2026, month: 7, day: 1, hour: 23, minute: 59, second: 59 },
  };
  assert.equal(promoWindowOpen(new Date('2026-07-01T06:59:59.999Z'), summer), false);
  assert.equal(promoWindowOpen(new Date('2026-07-01T07:00:00.000Z'), summer), true);
  assert.equal(promoWindowOpen(new Date('2026-07-02T06:59:59.999Z'), summer), true);
  assert.equal(promoWindowOpen(new Date('2026-07-02T07:00:00.000Z'), summer), false);
});

test('the banner states the real end and nothing else', () => {
  assert.equal(saleBannerText(), BANNER);
  assert.equal(saleBannerText().includes('countdown'), false);
  assert.equal(saleBannerText().includes('left'), false);
  assert.equal(saleBannerText().includes('review'), false);
});

test('checkout offers a code only inside the window and never sends discounts', async () => {
  async function sessionAt(iso, env = {}) {
    const stripe = fakeStripe();
    await createCheckoutSession({
      items: [sampleItem()],
      stripe,
      siteUrl: SITE,
      env,
      now: new Date(iso),
    });
    return stripe.calls[0];
  }

  const during = await sessionAt(PROMO_WINDOW_SAMPLE_ISO);
  const before = await sessionAt(BEFORE);
  const start = await sessionAt(START);
  const end = await sessionAt(END);
  const after = await sessionAt(AFTER);
  const killed = await sessionAt(PROMO_WINDOW_SAMPLE_ISO, { PROMO_CODES_ENABLED: 'off' });

  assert.equal(during.allow_promotion_codes, true);
  assert.equal(start.allow_promotion_codes, true);
  assert.equal(end.allow_promotion_codes, true);
  assert.equal(before.allow_promotion_codes, undefined);
  assert.equal(after.allow_promotion_codes, undefined);
  assert.equal(killed.allow_promotion_codes, undefined);
  for (const params of [during, before, start, end, after, killed]) {
    assert.equal(params.discounts, undefined);
    assert.equal(params.line_items[0].price_data.unit_amount, 2900);
    assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 599);
  }

  const opened = { ...during };
  const closed = { ...before };
  delete opened.allow_promotion_codes;
  delete closed.allow_promotion_codes;
  assert.deepEqual(opened, closed);

  const source = readFileSync(new URL('../lib/checkout.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /params\.discounts\s*=/);
  assert.doesNotMatch(source, /discounts:\s*\[/);
});

test('the shop banner uses the same window and sits under test mode', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const topbar = html.slice(html.indexOf('<div class="topbar">'), html.indexOf('<section class="hero">'));
  assert.ok(topbar.indexOf('id="testmode"') < topbar.indexOf('id="sale"'));
  assert.ok(topbar.indexOf('id="sale"') < topbar.indexOf('<nav'));
  assert.match(html, /id="sale" hidden/);
  assert.match(html, /import \{ promoWindowOpen, saleBannerText \} from '\/lib\/promo-window\.js'/);
  assert.match(html, /promoWindowOpen\(new Date\(\)\)/);
  assert.doesNotMatch(html, /getTimezoneOffset|getHours\(\)/);
  const rule = html.match(/#sale\{[^}]*\}/);
  assert.ok(rule);
  assert.doesNotMatch(rule[0], /position:\s*(absolute|fixed)/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /lib\/promo-window\.js/);
  const doc = readFileSync(new URL('../docs/promotions.md', import.meta.url), 'utf8');
  assert.match(doc, /HOLIDAY15/);
  assert.match(doc, /2026-12-01T07:59:59Z/);
  assert.match(doc, /allow_promotion_codes/);
  assert.match(doc, /discounts/);
});
