import { HttpError } from './http.js';
import { resolveVariant } from './variants.js';

const LAYOUTS = new Set(['row', 'triangle', 'stacked']);
const BACKGROUNDS = new Set(['#fde68a', '#c7d2fe', '#fbcfe8', '#ffffff', '#111827']);
const MAX_ITEMS = 8;

export function normalizeEmojis(emojis) {
  if (!Array.isArray(emojis) || emojis.length !== 3) {
    throw new HttpError(400, 'Each item needs exactly 3 emojis');
  }
  return emojis.map((emoji) => {
    if (typeof emoji !== 'string' || emoji.length < 1 || emoji.length > 32) {
      throw new HttpError(400, 'Each emoji must be a short emoji character');
    }
    if (/[\u0000-\u001f<>]/.test(emoji)) throw new HttpError(400, 'Invalid emoji');
    return emoji;
  });
}

export function normalizeLogoSize(value) {
  const n = value == null || value === '' ? 100 : Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Logo size is invalid');
  const rounded = Math.round(n);
  if (rounded < 60 || rounded > 140) throw new HttpError(400, 'Logo size must be between 60 and 140');
  return rounded;
}

export function normalizeBackground(input) {
  if (input == null || input === 'none' || (typeof input === 'object' && input.shape === 'none')) {
    return { shape: 'none' };
  }
  const color = typeof input === 'string' ? input : input.color;
  if (typeof color !== 'string') throw new HttpError(400, 'Choose a logo background from the swatches');
  const hex = color.toLowerCase();
  if (!BACKGROUNDS.has(hex)) throw new HttpError(400, 'Choose a logo background from the swatches');
  return { shape: 'circle', color: hex };
}

export function normalizeQuantity(value) {
  const n = value == null || value === '' ? 1 : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new HttpError(400, 'Quantity must be from 1 to 10');
  return n;
}

export function normalizeDesign(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Design is invalid');
  const emojis = normalizeEmojis(input.emojis || input.e);
  const layout = input.layout || input.l;
  if (!LAYOUTS.has(layout)) throw new HttpError(400, 'Choose a row, triangle, or stacked layout');
  return {
    emojis,
    layout,
    logoSize: normalizeLogoSize(input.logoSize ?? input.z),
    background: normalizeBackground(input.background ?? input.b),
  };
}

export function normalizeItem(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Cart item is invalid');
  const design = normalizeDesign(input);
  if (typeof input.color !== 'string' || typeof input.size !== 'string') {
    throw new HttpError(400, 'Choose a color and size');
  }
  const quantity = normalizeQuantity(input.quantity);
  const variant = resolveVariant(input.product, input.color, input.size);
  return {
    product: input.product,
    color: input.color,
    size: input.size,
    quantity,
    ...design,
    variant,
  };
}

export function normalizeCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Your cart is empty');
  if (items.length > MAX_ITEMS) throw new HttpError(400, `Cart is limited to ${MAX_ITEMS} items`);
  return items.map(normalizeItem);
}

export function metadataForItems(items) {
  const meta = { v: '1', n: String(items.length) };
  items.forEach((item, index) => {
    const packed = JSON.stringify({
      p: item.product,
      c: item.color,
      s: item.size,
      q: item.quantity,
      e: item.emojis,
      l: item.layout,
      z: item.logoSize,
      b: item.background.shape === 'circle' ? item.background.color : 'none',
    });
    if (packed.length > 500) throw new HttpError(400, 'That design is too detailed to check out');
    meta[`i${index}`] = packed;
  });
  return meta;
}

export function itemsFromMetadata(metadata) {
  if (!metadata || metadata.v !== '1') throw new HttpError(400, 'Order metadata is missing');
  const count = Number(metadata.n);
  if (!Number.isInteger(count) || count < 1 || count > MAX_ITEMS) {
    throw new HttpError(400, 'Order metadata is invalid');
  }
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const raw = metadata[`i${index}`];
    if (typeof raw !== 'string') throw new HttpError(400, 'Order metadata is incomplete');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Order metadata is invalid');
    }
    items.push(normalizeItem({
      product: parsed.p,
      color: parsed.c,
      size: parsed.s,
      quantity: parsed.q,
      emojis: parsed.e,
      layout: parsed.l,
      logoSize: parsed.z,
      background: parsed.b,
    }));
  }
  return items;
}

export function encodeDesign(item) {
  const packed = {
    e: item.emojis,
    l: item.layout,
    z: item.logoSize,
    b: item.background.shape === 'circle' ? item.background.color : 'none',
  };
  if (item.product === 'hat') packed.p = 'hat';
  return Buffer.from(JSON.stringify(packed), 'utf8').toString('base64url');
}

export function decodeDesign(token) {
  if (typeof token !== 'string' || token.length < 4 || token.length > 2000) {
    throw new HttpError(400, 'Design is invalid');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Design is invalid');
  }
  const design = normalizeDesign(parsed);
  if (parsed.p === 'hat') design.product = 'hat';
  return design;
}

export function normalizeSiteUrl(value) {
  if (!value || typeof value !== 'string') throw new HttpError(500, 'SITE_URL is not configured');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(500, 'SITE_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(500, 'SITE_URL must be http or https');
  }
  const path = url.pathname.replace(/\/$/, '');
  return url.origin + path;
}

export function printFileUrl(siteUrl, item) {
  return `${normalizeSiteUrl(siteUrl)}/api/print-file?design=${encodeDesign(item)}`;
}
