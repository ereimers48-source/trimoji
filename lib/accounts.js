import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { itemsFromMetadata } from './design.js';
import { HttpError } from './http.js';
import { ALLOWED_ORIGINS } from './site.js';

export const SIGNIN_MESSAGE = 'If that address can sign in, we sent a link. It expires in 15 minutes.';
export const RATE_MESSAGE = 'Please wait and try again later.';
export const SEND_FAILURE = 'We could not send a sign-in link. Please try again later.';
export const SESSION_COOKIE = 'trimoji_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const DESIGN_LIMIT = 24;

const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  failed: 'Failed',
  canceled: 'Canceled',
  cancelled: 'Canceled',
  inprocess: 'In production',
  fulfilled: 'Shipped',
  shipped: 'Shipped',
  onhold: 'On hold',
};

export function sanitizePlain(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeEmail(value) {
  const text = sanitizePlain(value).toLowerCase();
  if (!text) return '';
  if (text.length > 254 || /[<>]/.test(text)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text;
}

export function hashEmail(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function hashBucket(bucket) {
  return createHash('sha256').update(`trimoji-accounts:${bucket}`).digest('hex').slice(0, 32);
}

export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0].trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

export function sessionSecret(env = process.env) {
  const secret = typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET : '';
  return secret.length >= 32 ? secret : '';
}

export function newSignInToken(bytes = randomBytes(32)) {
  return Buffer.from(bytes).toString('base64url');
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

export function signSession(email, secret, now = Date.now()) {
  if (!secret || String(secret).length < 32) throw new HttpError(500, 'Sign-in is not configured');
  const payload = b64url(JSON.stringify({
    email,
    iat: now,
    exp: now + SESSION_MAX_AGE * 1000,
  }));
  const sig = createHmac('sha256', secret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifySession(token, secret, now = Date.now()) {
  if (!secret || String(secret).length < 32 || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let given;
  try {
    given = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== 'number' || typeof data.iat !== 'number') return null;
  if (data.exp <= now) return null;
  const email = normalizeEmail(data.email);
  if (!email) return null;
  return { email, iat: data.iat, exp: data.exp };
}

export function requestIsHttps(request) {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch {
    return false;
  }
  const proto = request.headers.get('x-forwarded-proto') || '';
  return proto.split(',')[0].trim().toLowerCase() === 'https';
}

export function sessionCookieHeader(value, { secure = false, maxAge = SESSION_MAX_AGE } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  return sessionCookieHeader('', { secure, maxAge: 0 });
}

export function readCookie(request, name) {
  const header = request.headers?.get?.('cookie') || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return '';
}

export function sessionFromRequest(request, env = process.env, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  return verifySession(readCookie(request, SESSION_COOKIE), secret, now);
}

export function assertCsrf(request) {
  if (request.headers.get('x-trimoji-request') !== '1') throw new HttpError(403, 'Request was blocked');
  const origin = request.headers.get('origin') || '';
  let requestOrigin = '';
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    requestOrigin = '';
  }
  if (!origin || origin !== requestOrigin || !ALLOWED_ORIGINS.has(origin)) {
    throw new HttpError(403, 'Request was blocked');
  }
}

export function safeNext(value) {
  if (typeof value !== 'string' || value.length > 80) return '';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('@')) return '';
  let url;
  try {
    url = new URL(value, 'https://trimojiapparel.com');
  } catch {
    return '';
  }
  if (url.origin !== 'https://trimojiapparel.com') return '';
  if (url.pathname !== '/' && url.pathname !== '/shop-preview') return '';
  const keys = [...url.searchParams.keys()];
  if (keys.length > 1) return '';
  if (keys.length === 1 && !(keys[0] === 'resume' && url.searchParams.get('resume') === '1')) return '';
  return url.pathname + url.search;
}

export function normalizePersonName(value) {
  const text = sanitizePlain(value);
  if (!text) return '';
  if (text.length > 80) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(text)) return null;
  return text;
}

export function normalizeAddress(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'object') throw new HttpError(400, 'Enter a US shipping address.');
  const name = normalizePersonName(input.name);
  if (name == null) throw new HttpError(400, 'Enter a name, or leave it blank.');
  const line1 = sanitizePlain(input.line1);
  const line2 = sanitizePlain(input.line2 || '');
  const city = sanitizePlain(input.city);
  const state = sanitizePlain(input.state).toUpperCase();
  const postalCode = sanitizePlain(input.postalCode || input.zip || '');
  if (!line1 && !line2 && !city && !state && !postalCode && !name) return null;
  if (!line1 || line1.length > 80 || line2.length > 80) throw new HttpError(400, 'Enter a street address.');
  if (!city || city.length > 60) throw new HttpError(400, 'Enter a city.');
  if (!/^[A-Z]{2}$/.test(state)) throw new HttpError(400, 'Enter a two-letter state.');
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) throw new HttpError(400, 'Enter a ZIP code.');
  if (/[<>]/.test(`${line1}${line2}${city}`)) throw new HttpError(400, 'Enter a US shipping address.');
  return { name, line1, line2, city, state, postalCode };
}

export function normalizeProfile(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Enter your details.');
  const name = normalizePersonName(input.name);
  if (name == null) throw new HttpError(400, 'Enter a name, or leave it blank.');
  return { name, address: normalizeAddress(input.address) };
}

export function emptyAccount(email) {
  return { email, name: '', address: null, designs: [], orders: [] };
}

export function publicStatus(value) {
  return String(value || 'draft').replace(/[^a-z0-9 _-]/gi, '').slice(0, 40).trim() || 'draft';
}

export function statusLabel(value) {
  const key = publicStatus(value).toLowerCase().replace(/[\s_-]/g, '');
  return STATUS_LABELS[key] || 'Processing';
}

export function publicTracking(shipments) {
  if (!Array.isArray(shipments)) return [];
  const out = [];
  for (const shipment of shipments) {
    if (!shipment || typeof shipment !== 'object') continue;
    const number = String(shipment.tracking_number || shipment.trackingNumber || '').replace(/[^A-Za-z0-9 -]/g, '').slice(0, 40);
    const carrier = String(shipment.carrier || '').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 40);
    let url = '';
    const raw = String(shipment.tracking_url || shipment.trackingUrl || '');
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:') url = parsed.toString().slice(0, 300);
    } catch {
      url = '';
    }
    if (!number && !url) continue;
    out.push({ carrier, number, url });
    if (out.length >= 5) break;
  }
  return out;
}

export function presentOrder(order, live = null) {
  const items = Array.isArray(order.items) ? order.items.map((item) => ({
    name: sanitizePlain(item.name).slice(0, 80),
    emojis: Array.isArray(item.emojis) ? item.emojis.map((emoji) => (emoji ? sanitizePlain(emoji).slice(0, 32) : null)) : [],
    color: sanitizePlain(item.color).slice(0, 40),
    size: sanitizePlain(item.size).slice(0, 40),
    quantity: Number.isInteger(item.quantity) ? item.quantity : 1,
  })) : [];
  return {
    reference: String(order.reference || '').slice(0, 32),
    createdAt: String(order.createdAt || ''),
    items,
    total: Number.isInteger(order.total) ? order.total : 0,
    currency: 'usd',
    shipping: {
      city: sanitizePlain(order.shipping?.city).slice(0, 60),
      state: sanitizePlain(order.shipping?.state).slice(0, 8),
    },
    status: statusLabel(live?.status || order.status),
    tracking: Array.isArray(live?.tracking) ? live.tracking : [],
  };
}

export function presentDesign(design) {
  return {
    id: design.id,
    slots: Array.isArray(design.slots) ? design.slots.map((emoji) => emoji || null) : [],
    product: design.product,
    color: design.color,
    size: design.size,
    layout: design.layout,
    logoSize: design.logoSize,
    createdAt: design.createdAt,
  };
}

export function presentProfile(record) {
  return {
    email: record.email,
    name: record.name || '',
    address: record.address ? { ...record.address } : null,
  };
}

export function accountOrderRecord(session, printfulOrder, created, now = Date.now()) {
  const city = sanitizePlain(printfulOrder?.recipient?.city).slice(0, 60);
  const state = sanitizePlain(printfulOrder?.recipient?.state_code).toUpperCase().slice(0, 8);
  const items = itemsFromMetadata(session.metadata).map((item) => ({
    name: item.variant.name,
    emojis: item.emojis.map((emoji) => emoji || null),
    color: item.color,
    size: item.size,
    quantity: item.quantity,
  }));
  const id = created?.result?.id;
  return {
    reference: String(printfulOrder.external_id || '').slice(0, 32),
    items,
    total: Number.isInteger(session.amount_total) ? session.amount_total : 0,
    currency: 'usd',
    shipping: { city, state },
    status: publicStatus(created?.result?.status || 'draft'),
    createdAt: new Date(now).toISOString(),
    printfulOrderId: typeof id === 'number' || (typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id)) ? id : null,
  };
}
