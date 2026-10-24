import { randomUUID } from 'node:crypto';
import { del, get, list, put } from '@vercel/blob';
import { HttpError } from './http.js';
import {
  RATE_LIMIT_MAX,
  RATE_WINDOW_MS,
  approvedStories,
  hashIp,
  toAdminStory,
  validateSubmission,
  isStoryId,
} from './stories.js';

const RECORD_PREFIX = 'stories/records/';
const PHOTO_PREFIX = 'stories/photos/';
const RATE_PREFIX = 'stories/ratelimit/';

export function createMemoryStore({ limit = RATE_LIMIT_MAX, windowMs = RATE_WINDOW_MS } = {}) {
  const records = new Map();
  const photos = new Map();
  const hits = new Map();
  return {
    async list() {
      return [...records.values()].map((record) => ({ ...record, emojis: [...record.emojis] }));
    },
    async get(id) {
      const record = records.get(id);
      return record ? { ...record, emojis: [...record.emojis] } : null;
    },
    async save(record) {
      records.set(record.id, { ...record, emojis: [...record.emojis] });
    },
    async remove(id) {
      records.delete(id);
      photos.delete(id);
    },
    async savePhoto(id, bytes, contentType) {
      photos.set(id, { bytes: Buffer.from(bytes), contentType });
    },
    async readPhoto(id) {
      const photo = photos.get(id);
      return photo ? { bytes: Buffer.from(photo.bytes), contentType: photo.contentType } : null;
    },
    async allow(ip, now = Date.now()) {
      const key = hashIp(ip);
      const recent = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
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

export function createBlobStore(token, blobApi = { put, get, del, list }) {
  if (!token) throw new Error('Missing BLOB_READ_WRITE_TOKEN');
  const options = { token, access: 'private' };
  async function readJson(pathname) {
    const result = await blobApi.get(pathname, { ...options, useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse((await readBody(result.stream)).toString('utf8'));
  }
  return {
    async list() {
      const records = [];
      let cursor;
      do {
        const page = await blobApi.list({ token, prefix: RECORD_PREFIX, cursor, limit: 1000 });
        for (const blob of page.blobs) {
          const record = await readJson(blob.pathname);
          if (record) records.push(record);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return records;
    },
    async get(id) {
      return readJson(`${RECORD_PREFIX}${id}.json`);
    },
    async save(record) {
      await blobApi.put(`${RECORD_PREFIX}${record.id}.json`, JSON.stringify(record), {
        ...options,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async remove(id) {
      const record = await readJson(`${RECORD_PREFIX}${id}.json`);
      const paths = [`${RECORD_PREFIX}${id}.json`];
      if (record?.photo) paths.push(`${PHOTO_PREFIX}${id}`);
      await blobApi.del(paths, { token });
    },
    async savePhoto(id, bytes, contentType) {
      await blobApi.put(`${PHOTO_PREFIX}${id}`, Buffer.from(bytes), {
        ...options,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async readPhoto(id) {
      const result = await blobApi.get(`${PHOTO_PREFIX}${id}`, { ...options, useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const record = await readJson(`${RECORD_PREFIX}${id}.json`);
      return { bytes: await readBody(result.stream), contentType: record?.photo || result.blob?.contentType || 'application/octet-stream' };
    },
    async allow(ip, now = Date.now()) {
      const pathname = `${RATE_PREFIX}${hashIp(ip)}.json`;
      const current = (await readJson(pathname)) || { hits: [] };
      const recent = (current.hits || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
      if (recent.length >= RATE_LIMIT_MAX) {
        await blobApi.put(pathname, JSON.stringify({ hits: recent }), {
          ...options,
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        return false;
      }
      recent.push(now);
      await blobApi.put(pathname, JSON.stringify({ hits: recent }), {
        ...options,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return true;
    },
  };
}

export async function submitStory(input, { store, ip = 'unknown', now = Date.now() } = {}) {
  const parsed = validateSubmission(input);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  if (!store) throw new HttpError(503, 'Story storage is not configured');
  const allowed = await store.allow(ip || 'unknown', now);
  if (!allowed) throw new HttpError(429, 'Please wait and try again later.');
  if (parsed.dropped) return { ok: true, status: 'pending' };
  const id = randomUUID();
  if (parsed.photo) await store.savePhoto(id, parsed.photo.bytes, parsed.photo.contentType);
  await store.save({
    id,
    ...parsed.value,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
  });
  return { ok: true, status: 'pending' };
}

export async function listPublicStories(store) {
  if (!store) throw new HttpError(503, 'Story storage is not configured');
  return approvedStories(await store.list());
}

export async function listPendingStories(store) {
  if (!store) throw new HttpError(503, 'Story storage is not configured');
  return (await store.list())
    .filter((record) => record.status === 'pending')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(toAdminStory);
}

export async function moderateStory(store, id, action) {
  if (!store) throw new HttpError(503, 'Story storage is not configured');
  if (!isStoryId(id)) throw new HttpError(400, 'Unknown story');
  if (!['approve', 'reject', 'delete'].includes(action)) throw new HttpError(400, 'Unknown action');
  const record = await store.get(id);
  if (!record) throw new HttpError(404, 'Story not found');
  if (action === 'delete') {
    await store.remove(id);
    return { ok: true, status: 'deleted' };
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  await store.save({ ...record, status });
  return { ok: true, status };
}

export async function readPublicPhoto(store, id) {
  if (!isStoryId(id) || !store) return null;
  const record = await store.get(id);
  if (!record || record.status !== 'approved' || !record.photo) return null;
  return store.readPhoto(id);
}

export function activeStore(runtime, env = process.env) {
  if (runtime.storiesStore) return runtime.storiesStore;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new HttpError(503, 'Story storage is not configured');
  if (!runtime.blobStoryStore) runtime.blobStoryStore = createBlobStore(token);
  return runtime.blobStoryStore;
}

export async function readAdminPhoto(store, id) {
  if (!isStoryId(id) || !store) return null;
  const record = await store.get(id);
  if (!record || !record.photo) return null;
  return store.readPhoto(id);
}
