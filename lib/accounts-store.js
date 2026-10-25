import { randomUUID } from 'node:crypto';
import { del, get, list, put } from '@vercel/blob';
import {
  DESIGN_LIMIT,
  RATE_LIMIT_MAX,
  RATE_MESSAGE,
  RATE_WINDOW_MS,
  SEND_FAILURE,
  SIGNIN_MESSAGE,
  TOKEN_TTL_MS,
  accountOrderRecord,
  emptyAccount,
  hashBucket,
  hashEmail,
  hashToken,
  newSignInToken,
  normalizeEmail,
  normalizeProfile,
  presentDesign,
  presentOrder,
  presentProfile,
  publicTracking,
  safeNext,
  sessionCookieHeader,
  sessionFromRequest,
  sessionSecret,
  signSession,
} from './accounts.js';
import { normalizeItem, resolveSiteUrl } from './design.js';
import { HttpError } from './http.js';
import { deliverSignIn, hasResendApiKey } from './mailer.js';
import { fetchPrintfulOrderStatus } from './printful.js';

const USER_PREFIX = 'accounts/users/';
const TOKEN_PREFIX = 'accounts/tokens/';
const REVOKED_PREFIX = 'accounts/revoked/';
const RATE_PREFIX = 'accounts/ratelimit/';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hexKey(value) {
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}

function rateKey(value) {
  return /^[a-f0-9]{32}$/.test(value) ? value : '';
}

export function createMemoryAccountStore({ limit = RATE_LIMIT_MAX, windowMs = RATE_WINDOW_MS } = {}) {
  const users = new Map();
  const tokens = new Map();
  const revoked = new Map();
  const hits = new Map();
  return {
    async getUser(hash) {
      return users.has(hash) ? clone(users.get(hash)) : null;
    },
    async putUser(hash, record) {
      users.set(hash, clone(record));
    },
    async deleteUser(hash) {
      users.delete(hash);
    },
    async getToken(hash) {
      return tokens.has(hash) ? clone(tokens.get(hash)) : null;
    },
    async putToken(hash, record) {
      tokens.set(hash, clone(record));
    },
    async deleteToken(hash) {
      tokens.delete(hash);
    },
    async deleteTokensFor(email) {
      for (const [hash, record] of tokens) {
        if (record.email === email) tokens.delete(hash);
      }
    },
    async getRevoked(hash) {
      return revoked.has(hash) ? { at: revoked.get(hash) } : null;
    },
    async putRevoked(hash, at) {
      revoked.set(hash, at);
    },
    async allow(bucket, now = Date.now()) {
      const recent = (hits.get(bucket) || []).filter((stamp) => now - stamp < windowMs);
      if (recent.length >= limit) {
        hits.set(bucket, recent);
        return false;
      }
      recent.push(now);
      hits.set(bucket, recent);
      return true;
    },
  };
}

async function readBody(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function createBlobAccountStore(token, blobApi = { put, get, del, list }) {
  if (!token) throw new Error('Missing BLOB_READ_WRITE_TOKEN');
  const options = { token, access: 'private' };
  async function readJson(pathname) {
    const result = await blobApi.get(pathname, { ...options, useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse((await readBody(result.stream)).toString('utf8'));
  }
  async function writeJson(pathname, value) {
    await blobApi.put(pathname, JSON.stringify(value), {
      ...options,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
  return {
    async getUser(hash) {
      const key = hexKey(hash);
      if (!key) return null;
      return readJson(`${USER_PREFIX}${key}.json`);
    },
    async putUser(hash, record) {
      const key = hexKey(hash);
      if (!key) throw new HttpError(500, 'Account storage is not configured');
      await writeJson(`${USER_PREFIX}${key}.json`, record);
    },
    async deleteUser(hash) {
      const key = hexKey(hash);
      if (!key) return;
      await blobApi.del(`${USER_PREFIX}${key}.json`, { token });
    },
    async getToken(hash) {
      const key = hexKey(hash);
      if (!key) return null;
      return readJson(`${TOKEN_PREFIX}${key}.json`);
    },
    async putToken(hash, record) {
      const key = hexKey(hash);
      if (!key) throw new HttpError(500, 'Account storage is not configured');
      await writeJson(`${TOKEN_PREFIX}${key}.json`, record);
    },
    async deleteToken(hash) {
      const key = hexKey(hash);
      if (!key) return;
      await blobApi.del(`${TOKEN_PREFIX}${key}.json`, { token });
    },
    async deleteTokensFor(email) {
      let cursor;
      do {
        const page = await blobApi.list({ token, prefix: TOKEN_PREFIX, cursor, limit: 1000 });
        for (const blob of page.blobs) {
          const record = await readJson(blob.pathname);
          if (record?.email === email) await blobApi.del(blob.pathname, { token });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    },
    async getRevoked(hash) {
      const key = hexKey(hash);
      if (!key) return null;
      return readJson(`${REVOKED_PREFIX}${key}.json`);
    },
    async putRevoked(hash, at) {
      const key = hexKey(hash);
      if (!key) return;
      await writeJson(`${REVOKED_PREFIX}${key}.json`, { at });
    },
    async allow(bucket, now = Date.now()) {
      const key = rateKey(hashBucket(bucket));
      if (!key) return false;
      const pathname = `${RATE_PREFIX}${key}.json`;
      const current = (await readJson(pathname)) || { hits: [] };
      const recent = (current.hits || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
      if (recent.length >= RATE_LIMIT_MAX) {
        await writeJson(pathname, { hits: recent });
        return false;
      }
      recent.push(now);
      await writeJson(pathname, { hits: recent });
      return true;
    },
  };
}

export function activeAccountStore(runtime, env = process.env) {
  if (runtime.accountStore) return runtime.accountStore;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new HttpError(503, 'Account storage is not configured');
  if (!runtime.blobAccountStore) runtime.blobAccountStore = createBlobAccountStore(token);
  return runtime.blobAccountStore;
}

async function sessionAllowed(store, session) {
  if (!session) return false;
  const revoked = await store.getRevoked(hashEmail(session.email));
  if (revoked && Number(revoked.at) >= session.iat) return false;
  return true;
}

export async function requestSignIn({
  email,
  next,
  store,
  ip = 'unknown',
  now = Date.now(),
  env = process.env,
  mailer = null,
  token = null,
}) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new HttpError(400, 'Enter a valid email.');
  if (!store) throw new HttpError(503, SEND_FAILURE);
  if (!sessionSecret(env)) throw new HttpError(503, SEND_FAILURE);
  const ipAllowed = await store.allow(`ip:${ip || 'unknown'}`, now);
  const emailAllowed = await store.allow(`email:${hashEmail(normalized)}`, now);
  if (!ipAllowed || !emailAllowed) throw new HttpError(429, RATE_MESSAGE);
  const canSend = mailer || envCanSendMail(env);
  if (!canSend) throw new HttpError(503, SEND_FAILURE);
  const raw = token || newSignInToken();
  const tokenHash = hashToken(raw);
  await store.putToken(tokenHash, {
    email: normalized,
    expiresAt: now + TOKEN_TTL_MS,
    next: safeNext(next),
  });
  try {
    const link = `${resolveSiteUrl(env.SITE_URL)}/api/auth/verify?token=${encodeURIComponent(raw)}`;
    await deliverSignIn({ to: normalized, link, env, mailer });
  } catch (err) {
    await store.deleteToken(tokenHash);
    if (err instanceof HttpError) throw new HttpError(err.status, SEND_FAILURE);
    throw new HttpError(503, SEND_FAILURE);
  }
  return { ok: true, message: SIGNIN_MESSAGE };
}

function envCanSendMail(env) {
  if (hasResendApiKey(env)) return true;
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

export async function verifySignIn({
  token,
  store,
  env = process.env,
  now = Date.now(),
  secure = false,
}) {
  const secret = sessionSecret(env);
  if (!secret || !store || typeof token !== 'string' || token.length < 40 || token.length > 128) return { ok: false };
  const tokenHash = hashToken(token);
  const record = await store.getToken(tokenHash);
  await store.deleteToken(tokenHash);
  if (!record || record.expiresAt <= now || !normalizeEmail(record.email)) return { ok: false };
  const email = normalizeEmail(record.email);
  const hash = hashEmail(email);
  const revoked = await store.getRevoked(hash);
  const issuedAt = record.expiresAt - TOKEN_TTL_MS;
  if (revoked && Number(revoked.at) >= issuedAt) return { ok: false };
  const existing = await store.getUser(hash);
  if (!existing) await store.putUser(hash, emptyAccount(email));
  return {
    ok: true,
    email,
    next: safeNext(record.next),
    cookie: sessionCookieHeader(signSession(email, secret, now), { secure }),
  };
}

export async function currentSession(request, store, env = process.env) {
  const session = sessionFromRequest(request, env);
  if (!session || !store) return null;
  if (!(await sessionAllowed(store, session))) return null;
  return session;
}

export async function readAccount(requestSession, store, { token, storeId, fetchImpl } = {}) {
  if (!requestSession || !(await sessionAllowed(store, requestSession))) return { signedIn: false };
  const record = (await store.getUser(hashEmail(requestSession.email))) || emptyAccount(requestSession.email);
  const orders = [];
  for (const order of record.orders || []) {
    let live = null;
    if (order.printfulOrderId != null && token && storeId && fetchImpl) {
      try {
        const raw = await fetchPrintfulOrderStatus(order.printfulOrderId, { token, storeId, fetchImpl });
        live = raw ? { status: raw.status, tracking: publicTracking(raw.shipments) } : null;
      } catch {
        live = null;
      }
    }
    orders.push(presentOrder(order, live));
  }
  orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    signedIn: true,
    profile: presentProfile(record),
    designs: (record.designs || []).map(presentDesign),
    orders,
  };
}

export async function updateProfile(session, store, input) {
  if (!session || !(await sessionAllowed(store, session))) throw new HttpError(401, 'Sign in required');
  const profile = normalizeProfile(input);
  const hash = hashEmail(session.email);
  const record = (await store.getUser(hash)) || emptyAccount(session.email);
  record.name = profile.name;
  record.address = profile.address;
  await store.putUser(hash, record);
  return { ok: true, profile: presentProfile(record) };
}

export async function saveDesign(session, store, input, now = Date.now()) {
  if (!session || !(await sessionAllowed(store, session))) throw new HttpError(401, 'Sign in required');
  const item = normalizeItem({ ...input, quantity: 1 });
  const hash = hashEmail(session.email);
  const record = (await store.getUser(hash)) || emptyAccount(session.email);
  record.designs = Array.isArray(record.designs) ? record.designs : [];
  if (record.designs.length >= DESIGN_LIMIT) throw new HttpError(400, 'You can save up to 24 designs.');
  const design = {
    id: randomUUID(),
    slots: item.emojis.map((emoji) => emoji || null),
    product: item.product,
    color: item.color,
    size: item.size,
    layout: item.layout,
    logoSize: item.logoSize,
    createdAt: new Date(now).toISOString(),
  };
  record.designs.unshift(design);
  await store.putUser(hash, record);
  return { ok: true, design: presentDesign(design) };
}

export async function deleteDesign(session, store, id) {
  if (!session || !(await sessionAllowed(store, session))) throw new HttpError(401, 'Sign in required');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) {
    throw new HttpError(400, 'Unknown design');
  }
  const hash = hashEmail(session.email);
  const record = await store.getUser(hash);
  if (!record) throw new HttpError(404, 'Unknown design');
  const next = (record.designs || []).filter((design) => design.id !== id);
  if (next.length === (record.designs || []).length) throw new HttpError(404, 'Unknown design');
  record.designs = next;
  await store.putUser(hash, record);
  return { ok: true };
}

export async function deleteAccount(session, store, now = Date.now()) {
  if (!session || !(await sessionAllowed(store, session))) throw new HttpError(401, 'Sign in required');
  const hash = hashEmail(session.email);
  await store.deleteTokensFor(session.email);
  await store.deleteUser(hash);
  await store.putRevoked(hash, now);
  return { ok: true };
}

export async function appendCheckoutOrder(store, session, printfulOrder, created, now = Date.now()) {
  const email = normalizeEmail(session?.customer_details?.email);
  if (!email || !store || !printfulOrder?.external_id) return;
  const hash = hashEmail(email);
  const record = (await store.getUser(hash)) || emptyAccount(email);
  record.orders = Array.isArray(record.orders) ? record.orders : [];
  const order = accountOrderRecord(session, printfulOrder, created, now);
  if (!order.reference || record.orders.some((item) => item.reference === order.reference)) return;
  record.orders.push(order);
  if (record.orders.length > 100) record.orders = record.orders.slice(-100);
  await store.putUser(hash, record);
}

export async function designForSession(session, store, id) {
  if (!session || !(await sessionAllowed(store, session))) return null;
  const record = await store.getUser(hashEmail(session.email));
  if (!record) return null;
  return (record.designs || []).find((design) => design.id === id) || null;
}

