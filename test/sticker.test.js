import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { stickerSheetEnabled } from '../lib/config.js';
import { createCheckoutSession } from '../lib/checkout.js';
import { decodeDesign, encodeDesign } from '../lib/design.js';
import { HttpError } from '../lib/http.js';
import { orderConfirmationMessage, shipmentMessage } from '../lib/order-mail.js';
import { publicOrder } from '../lib/order.js';
import { priceCart } from '../lib/prices.js';
import { buildPrintfulOrder, stickerFilePosition } from '../lib/printful.js';
import {
  STICKER_PRINT_H,
  STICKER_PRINT_W,
  composeStickerSvg,
  composeSvg,
  renderLogoPng,
  stickerGlyphCenters,
  stickerLayout,
} from '../lib/render.js';
import { resolveVariant } from '../lib/variants.js';

const SITE = 'https://trimojiapparel.com';
const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="16" fill="#ffcc4d"/>
</svg>`;

function sampleItem(overrides = {}) {
  return {
    product: 'sticker',
    color: 'White',
    size: '5.83×8.27 in',
    quantity: 1,
    emojis: ['🔥', '😎', '🍕'],
    layout: 'triangle',
    logoSize: 100,
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
          return { id: 'cs_test_sticker', url: 'https://checkout.stripe.com/c/pay/cs_test_sticker' };
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

function pixel(bitmap, x, y) {
  const index = (y * bitmap.width + x) * 4;
  return [
    bitmap.pixels[index],
    bitmap.pixels[index + 1],
    bitmap.pixels[index + 2],
    bitmap.pixels[index + 3],
  ];
}

function dpiOf(png) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'pHYs') return Math.round(png.readUInt32BE(offset + 8) * 0.0254);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return 0;
}

test('sticker sheet grid is 15 tiles on a 1750×2482 sheet', () => {
  const layout = stickerLayout();
  assert.equal(layout.width, 1750);
  assert.equal(layout.height, 2482);
  assert.equal(STICKER_PRINT_W, 1750);
  assert.equal(STICKER_PRINT_H, 2482);
  assert.equal(layout.margin, 150);
  assert.equal(layout.gap, 50);
  assert.equal(layout.cols, 3);
  assert.equal(layout.rows, 5);
  assert.equal(layout.bw, 450);
  assert.equal(layout.bh, 396);
  assert.equal(layout.x0, 150);
  assert.equal(layout.y0, 151);
  assert.equal(layout.glyph, 152);
  assert.equal(layout.tiles.length, 15);
  assert.deepEqual(layout.tiles[0], { x: 150, y: 151, w: 450, h: 396 });
  assert.deepEqual(layout.tiles[1], { x: 650, y: 151, w: 450, h: 396 });
  assert.deepEqual(layout.tiles[14], { x: 1150, y: 1935, w: 450, h: 396 });
  const centers = stickerGlyphCenters(450, 396);
  assert.ok(Math.abs(centers[0][0] - 225) < 0.001);
  assert.ok(Math.abs(centers[0][1] - 112.86) < 0.001);
  assert.ok(Math.abs(centers[1][0] - 128.25) < 0.001);
  assert.ok(Math.abs(centers[1][1] - 267.3) < 0.001);
  assert.ok(Math.abs(centers[2][0] - 321.75) < 0.001);
  assert.ok(Math.abs(centers[2][1] - 267.3) < 0.001);
});

test('sticker print SVG repeats one trio and stays transparent outside the tiles', () => {
  const design = {
    product: 'sticker',
    emojis: ['🔥', '😎', '🍕'],
    layout: 'row',
    logoSize: 140,
  };
  const svg = composeStickerSvg(design, [SVG, SVG, SVG]);
  assert.equal(composeSvg(design, [SVG, SVG, SVG]), svg);
  assert.equal(svg.includes('width="1750"'), true);
  assert.equal(svg.includes('height="2482"'), true);
  assert.equal((svg.match(/<g transform="translate\(\d+ \d+\)">/g) || []).length, 15);
  assert.equal((svg.match(/fill="#FFF4E1"/g) || []).length, 15);
  assert.equal((svg.match(/fill="#DEDEE4"/g) || []).length, 15);
  assert.equal((svg.match(/translate\(149 36\.86\)/g) || []).length, 15);
  assert.equal(svg.includes('fill="#ffffff"'), false);
  assert.equal(svg.includes('fill="#fff"'), false);
});

test('sticker print file is 1750×2482 with transparent corners and 15 tiles', async () => {
  const png = await renderLogoPng({
    product: 'sticker',
    emojis: ['🔥', '😎', '🍕'],
    layout: 'triangle',
    logoSize: 100,
  }, async () => SVG);
  assert.equal(png.readUInt32BE(16), 1750);
  assert.equal(png.readUInt32BE(20), 2482);
  assert.equal(png[25], 6);
  assert.equal(dpiOf(png), 300);
  const bitmap = decodeRgba(png);
  assert.deepEqual(pixel(bitmap, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(bitmap, 1749, 2481), [0, 0, 0, 0]);
  assert.equal(pixel(bitmap, 150, 151)[3], 0);
  assert.deepEqual(pixel(bitmap, 375, 155), [222, 222, 228, 255]);
  assert.deepEqual(pixel(bitmap, 375, 167), [255, 244, 225, 255]);
  assert.equal(pixel(bitmap, 620, 349)[3], 0);
  const layout = stickerLayout();
  for (const tile of layout.tiles) {
    assert.deepEqual(pixel(bitmap, tile.x + 225, tile.y + 16), [255, 244, 225, 255]);
  }
});

test('sticker price is $9 with the same shipping rules', () => {
  const alone = priceCart([sampleItem({ price: 100 })]);
  assert.equal(alone.lines[0].unitAmount, 900);
  assert.equal(alone.lines[0].lineAmount, 900);
  assert.equal(alone.subtotal, 900);
  assert.equal(alone.shipping, 599);
  assert.equal(alone.total, 1499);
  const withTee = priceCart([
    sampleItem({ product: 'tee', color: 'Black', size: 'L', price: 0 }),
    sampleItem({ price: 0 }),
  ]);
  assert.equal(withTee.subtotal, 3800);
  assert.equal(withTee.shipping, 599);
  assert.equal(withTee.total, 4399);
  const free = priceCart([
    sampleItem({ product: 'hoodie', color: 'Navy', size: 'M', price: 1 }),
    sampleItem({ price: 1 }),
  ]);
  assert.equal(free.subtotal, 6300);
  assert.equal(free.shipping, 0);
  assert.equal(free.total, 6300);
});

test('sticker variant, checkout, and Printful order use 12917', async () => {
  assert.deepEqual(resolveVariant('sticker', 'White', '5.83×8.27 in'), {
    variantId: 12917,
    printType: 'default',
    name: 'Kiss-Cut Sticker Sheet',
    unitAmount: 900,
    printfulColor: 'White',
    catalogProductId: 505,
  });
  assert.throws(() => resolveVariant('sticker', 'Black', '5.83×8.27 in'), HttpError);
  assert.equal(stickerSheetEnabled({}), true);
  assert.equal(stickerSheetEnabled({ STICKER_SHEET_ENABLED: 'true' }), true);
  assert.equal(stickerSheetEnabled({ STICKER_SHEET_ENABLED: ' false ' }), false);
  assert.equal(stickerSheetEnabled({ STICKER_SHEET_ENABLED: '0' }), false);
  assert.equal(stickerSheetEnabled({ STICKER_SHEET_ENABLED: 'off' }), false);
  assert.equal(stickerSheetEnabled({ STICKER_SHEET_ENABLED: 'NO' }), false);

  const stripe = fakeStripe();
  await createCheckoutSession({ items: [sampleItem()], stripe, siteUrl: SITE });
  const params = stripe.calls[0];
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.line_items.length, 1);
  assert.equal(params.line_items[0].price_data.unit_amount, 900);
  assert.equal(params.line_items[0].price_data.tax_behavior, 'exclusive');
  assert.equal(params.line_items[0].price_data.product_data.tax_code, undefined);
  assert.match(params.line_items[0].price_data.product_data.name, /Kiss-Cut Sticker Sheet/);
  assert.match(params.line_items[0].price_data.product_data.description, /White \/ 5\.83×8\.27 in \/ triangle/);
  assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 599);
  assert.equal(params.shipping_options[0].shipping_rate_data.tax_code, 'txcd_92010001');
  await assert.rejects(
    () => createCheckoutSession({
      items: [sampleItem()],
      stripe,
      siteUrl: SITE,
      env: { STICKER_SHEET_ENABLED: 'false', STRIPE_TAX_ENABLED: 'true' },
    }),
    (err) => err instanceof HttpError && err.status === 400 && err.message === 'Sticker sheets are not available',
  );

  const session = {
    id: 'cs_test_sticker',
    object: 'checkout.session',
    metadata: params.metadata,
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
  };
  const order = buildPrintfulOrder({ session, siteUrl: SITE });
  assert.equal(order.items[0].variant_id, 12917);
  assert.equal(order.items[0].retail_price, '9.00');
  assert.equal(order.items[0].name, 'Trimoji Kiss-Cut Sticker Sheet');
  assert.equal(order.items[0].files[0].type, 'default');
  assert.deepEqual(order.items[0].files[0].position, stickerFilePosition());
  assert.deepEqual(order.items[0].files[0].position, {
    area_width: 1750,
    area_height: 2482,
    width: 1750,
    height: 2482,
    top: 0,
    left: 0,
  });
  assert.equal(order.items[0].options, undefined);
  const design = decodeDesign(new URL(order.items[0].files[0].url).searchParams.get('design'));
  assert.equal(design.product, 'sticker');
  assert.deepEqual(design.emojis, ['🔥', '😎', '🍕']);
  assert.equal(encodeDesign(design).length > 10, true);

  const paid = publicOrder({
    ...session,
    payment_status: 'paid',
    amount_total: 1499,
    currency: 'usd',
  });
  assert.equal(paid.items[0].name, 'Kiss-Cut Sticker Sheet');
  assert.equal(paid.subtotal, 900);
  assert.equal(paid.shipping, 599);
  assert.equal(paid.total, 1499);
  assert.equal(paid.discount, null);
  assert.deepEqual(Object.keys(paid).sort(), ['currency', 'discount', 'items', 'reference', 'shipping', 'subtotal', 'tax', 'total']);
  const discounted = publicOrder({
    ...session,
    payment_status: 'paid',
    amount_total: 1299,
    total_details: { amount_discount: 200, amount_shipping: 599, amount_tax: 0 },
    discounts: [{ promotion_code: { code: 'SHEET' } }],
  });
  assert.equal(discounted.total, 1299);
  assert.equal(discounted.shipping, 599);
  assert.equal(discounted.discount.amount, 200);
  assert.equal(discounted.discount.line, 'Discount SHEET -$2.00');
  assert.deepEqual(Object.keys(discounted).sort(), ['currency', 'discount', 'items', 'reference', 'shipping', 'subtotal', 'tax', 'total']);

  const confirmation = orderConfirmationMessage({
    to: 'ada@example.com',
    reference: 'abc',
    items: [{ name: 'Kiss-Cut Sticker Sheet', emojis: ['🔥', '😎', '🍕'], color: 'White', size: '5.83×8.27 in', quantity: 1 }],
    total: 1499,
    tax: 0,
    shipTo: { name: 'Ada', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
  });
  assert.match(confirmation.text, /Kiss-Cut Sticker Sheet/);
  assert.match(confirmation.html, /Kiss-Cut Sticker Sheet/);
  const shipped = shipmentMessage({
    to: 'ada@example.com',
    reference: 'abc',
    items: [{ name: 'Trimoji Kiss-Cut Sticker Sheet', quantity: 1 }],
    carrier: 'USPS',
    trackingNumber: 'TRACK1',
    trackingUrl: 'https://example.test/track',
    city: 'Austin',
    state: 'TX',
  });
  assert.match(shipped.text, /Trimoji Kiss-Cut Sticker Sheet/);
  assert.match(shipped.html, /Kiss-Cut Sticker Sheet/);
});
