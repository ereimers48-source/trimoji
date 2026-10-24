import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GET as adminGet, POST as adminPost } from '../api/stories-admin.js';
import { GET as photoGet } from '../api/stories-photo.js';
import { GET as publicGet, POST as publicPost } from '../api/stories.js';
import { comingSoonEnabled, routeRequest } from '../lib/coming-soon.js';
import { HttpError } from '../lib/http.js';
import { runtime } from '../lib/runtime.js';
import {
  PHOTO_MAX_BYTES,
  escapeHtml,
  sanitizePlain,
  validateSubmission,
} from '../lib/stories.js';
import { comingSoonDocument, storiesDocument, storiesPublic } from '../lib/stories-page.js';
import {
  createBlobStore,
  createMemoryStore,
  listPublicStories,
  moderateStory,
  readAdminPhoto,
  readPublicPhoto,
  submitStory,
} from '../lib/stories-store.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const STORY = 'I picked these three because they remind me of home and the people I love.';

function fields(extra = {}) {
  return {
    emoji1: '😀',
    emoji2: '😀',
    emoji3: '🔥',
    firstName: 'Sam',
    city: 'Portland, OR',
    story: STORY,
    email: 'Sam@Example.com',
    consent: 'yes',
    company: '',
    ...extra,
  };
}

test('story text is sanitized and only approved notes are public', async () => {
  assert.equal(storiesPublic({}), false);
  assert.equal(storiesPublic({ STORIES_PUBLIC: '' }), false);
  assert.equal(storiesPublic({ STORIES_PUBLIC: 'false' }), false);
  assert.equal(storiesPublic({ STORIES_PUBLIC: 'true' }), true);
  assert.equal(storiesPublic({ STORIES_PUBLIC: 'on' }), true);
  assert.equal(comingSoonEnabled({}), true);
  assert.deepEqual(routeRequest('/', {}), { type: 'file', file: 'coming-soon.html', robots: null });
  assert.deepEqual(routeRequest('/shop-preview', {}), { type: 'file', file: 'index.html', robots: 'noindex, nofollow' });
  assert.deepEqual(routeRequest('/stories', {}), { type: 'static' });

  const soon = readFileSync(new URL('../coming-soon.html', import.meta.url), 'utf8');
  assert.doesNotMatch(soon, /href="\/stories"/);
  assert.match(comingSoonDocument(soon, { STORIES_PUBLIC: 'true' }), /href="\/stories">Stories</);
  assert.doesNotMatch(comingSoonDocument(soon, {}), /href="\/stories"/);
  const page = readFileSync(new URL('../stories.html', import.meta.url), 'utf8');
  assert.match(page, /data-stories-robots/);
  assert.match(page, /I agree Trimoji can share my story and photo on trimojiapparel.com and our social channels\./);
  assert.doesNotMatch(storiesDocument(page, { STORIES_PUBLIC: 'true' }), /data-stories-robots/);
  assert.match(storiesDocument(page, {}), /noindex/);
  assert.match(readFileSync(new URL('../stories-admin.html', import.meta.url), 'utf8'), /noindex/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /BLOB_READ_WRITE_TOKEN/);
  assert.match(readme, /STORIES_ADMIN_TOKEN/);
  assert.match(readme, /STORIES_PUBLIC/);

  assert.equal(escapeHtml('<b>"&\'</b>'), '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;');
  assert.equal(sanitizePlain('Hi <script>alert(1)</script> there'), 'Hi alert(1) there');
  assert.equal(validateSubmission(fields({ story: 'too short' })).ok, false);
  assert.equal(validateSubmission(fields({ consent: '' })).ok, false);
  assert.equal(validateSubmission(fields({ firstName: '<img src=x onerror=alert(1)>' })).ok, false);
  assert.equal(validateSubmission(fields({ email: 'not-an-email' })).ok, false);
  assert.equal(validateSubmission(fields({ emoji2: '😀😁' })).ok, false);
  assert.equal(validateSubmission(fields({ company: 'spam llc' })).dropped, true);
  const dirty = validateSubmission(fields({
    firstName: '<b>Sam</b>',
    story: '<b>Hello</b> <script>alert(1)</script> this is a long enough real story about my emojis.',
  }));
  assert.equal(dirty.ok, true);
  assert.equal(dirty.value.firstName, 'Sam');
  assert.equal(dirty.value.story.includes('<'), false);
  assert.equal(dirty.value.email, 'sam@example.com');
  assert.equal(validateSubmission(fields({
    photo: { bytes: Buffer.from('<html><script>alert(1)</script></html>'), type: 'image/png', size: 48 },
  })).ok, false);
  assert.equal(validateSubmission(fields({
    photo: { bytes: PNG, type: 'image/jpeg', size: PNG.length },
  })).ok, false);
  assert.equal(validateSubmission(fields({
    photo: { bytes: PNG, type: 'image/png', size: PHOTO_MAX_BYTES + 1 },
  })).ok, false);
  const webp = Buffer.alloc(16);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  assert.equal(validateSubmission(fields({ photo: { bytes: webp, type: 'image/webp', size: webp.length } })).photo.contentType, 'image/webp');

  const store = createMemoryStore({ limit: 5, windowMs: 1000 });
  const now = 1_700_000_000_000;
  const dropped = await submitStory(fields({ company: 'bot', firstName: 'SpamBot' }), { store, ip: '203.0.113.8', now });
  assert.equal(dropped.status, 'pending');
  assert.deepEqual(await listPublicStories(store), []);
  assert.equal((await store.list()).length, 0);

  const saved = await submitStory(fields({
    photo: { bytes: PNG, type: 'image/png', size: PNG.length },
    story: '<script>alert(1)</script> I wrote this myself so the note stays in my own words.',
  }), { store, ip: '203.0.113.9', now });
  assert.equal(saved.status, 'pending');
  const [pending] = await store.list();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.story.includes('<script>'), false);
  assert.equal(JSON.stringify(await listPublicStories(store)).includes('sam@example.com'), false);
  assert.equal(await readPublicPhoto(store, pending.id), null);
  const privatePhoto = await readAdminPhoto(store, pending.id);
  assert.equal(privatePhoto.contentType, 'image/png');
  assert.equal(privatePhoto.bytes.length, PNG.length);

  assert.deepEqual(await moderateStory(store, pending.id, 'approve'), { ok: true, status: 'approved' });
  const listed = await listPublicStories(store);
  assert.equal(listed.length, 1);
  assert.equal(Object.hasOwn(listed[0], 'email'), false);
  assert.equal(listed[0].photo, true);
  assert.equal(listed[0].emojis.join(''), '😀😀🔥');
  assert.equal((await readPublicPhoto(store, pending.id)).contentType, 'image/png');

  assert.deepEqual(await moderateStory(store, pending.id, 'reject'), { ok: true, status: 'rejected' });
  assert.equal((await listPublicStories(store)).length, 0);
  assert.equal(await readPublicPhoto(store, pending.id), null);
  await moderateStory(store, pending.id, 'approve');
  await moderateStory(store, pending.id, 'delete');
  assert.equal(await store.get(pending.id), null);
  assert.equal(await readAdminPhoto(store, pending.id), null);
  await assert.rejects(() => moderateStory(store, pending.id, 'approve'), (err) => err instanceof HttpError && err.status === 404);

  for (let i = 0; i < 4; i += 1) {
    await submitStory(fields({ firstName: 'Sam' }), { store, ip: '203.0.113.9', now: now + 1 });
  }
  await assert.rejects(
    () => submitStory(fields(), { store, ip: '203.0.113.9', now: now + 2 }),
    (err) => err instanceof HttpError && err.status === 429,
  );
  const other = await submitStory(fields({ firstName: 'Ada' }), { store, ip: '198.51.100.20', now: now + 2 });
  assert.equal(other.status, 'pending');
  const later = await submitStory(fields({ firstName: 'Jo' }), { store, ip: '203.0.113.9', now: now + 5000 });
  assert.equal(later.status, 'pending');
});

test('private blob records hide pending photos and emails', async () => {
  const files = new Map();
  const prefixes = [];
  const blobApi = {
    async put(pathname, body, options) {
      assert.equal(options.access, 'private');
      files.set(pathname, { body: Buffer.from(body), options });
      return { pathname };
    },
    async get(pathname) {
      const file = files.get(pathname);
      if (!file) return null;
      const bytes = Buffer.from(file.body);
      return {
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        blob: { contentType: file.options.contentType },
      };
    },
    async del(pathname) {
      for (const item of [].concat(pathname)) files.delete(item);
    },
    async list({ prefix }) {
      prefixes.push(prefix);
      return {
        blobs: [...files.keys()].filter((key) => key.startsWith(prefix)).map((pathname) => ({ pathname })),
        hasMore: false,
      };
    },
  };
  const store = createBlobStore('blob-test-token', blobApi);
  await submitStory(fields({ photo: { bytes: PNG, type: 'image/png', size: PNG.length } }), { store, ip: '203.0.113.50', now: 10 });
  const [record] = await store.list();
  assert.equal(record.status, 'pending');
  assert.equal(prefixes.every((prefix) => prefix === 'stories/records/'), true);
  assert.equal(JSON.stringify(await listPublicStories(store)).includes('example.com'), false);
  assert.equal(await readPublicPhoto(store, record.id), null);
  assert.equal((await readAdminPhoto(store, record.id)).bytes.length, PNG.length);
  assert.equal([...files.keys()].some((key) => key.startsWith('stories/photos/')), true);
  await moderateStory(store, record.id, 'delete');
  assert.equal(files.has(`stories/records/${record.id}.json`), false);
  assert.equal(files.has(`stories/photos/${record.id}`), false);
});

test('http handlers publish approved stories only', async () => {
  const previousStore = runtime.storiesStore;
  const previousAdmin = process.env.STORIES_ADMIN_TOKEN;
  const previousBlob = process.env.BLOB_READ_WRITE_TOKEN;
  runtime.storiesStore = createMemoryStore({ limit: 20 });
  process.env.STORIES_ADMIN_TOKEN = 'unit-token';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const form = new FormData();
    form.set('emoji1', '🔥');
    form.set('emoji2', '🔥');
    form.set('emoji3', '🔥');
    form.set('firstName', '<b>Ada</b>');
    form.set('city', 'Austin, TX');
    form.set('story', 'I wrote <i>this</i> myself. These three fires are the whole story and it is long enough.');
    form.set('email', 'ada@example.com');
    form.set('consent', 'yes');
    form.set('photo', new File([PNG], 'tiny.png', { type: 'image/png' }));
    const posted = await publicPost(new Request('http://127.0.0.1/api/stories', {
      method: 'POST',
      body: form,
      headers: { 'x-forwarded-for': '203.0.113.77' },
    }));
    assert.equal(posted.status, 200);
    assert.deepEqual(await posted.json(), { ok: true, status: 'pending' });
    const hidden = await publicGet();
    assert.deepEqual((await hidden.json()).stories, []);
    const denied = await adminGet(new Request('http://127.0.0.1/api/stories-admin'));
    assert.equal(denied.status, 401);
    const queued = await adminGet(new Request('http://127.0.0.1/api/stories-admin', {
      headers: { authorization: 'Bearer unit-token' },
    }));
    const body = await queued.json();
    assert.equal(body.stories.length, 1);
    assert.equal(body.stories[0].email, 'ada@example.com');
    assert.equal(body.stories[0].firstName, 'Ada');
    assert.equal(body.stories[0].story.includes('<i>'), false);
    const blocked = await photoGet(new Request(`http://127.0.0.1/api/stories-photo?id=${body.stories[0].id}`));
    assert.equal(blocked.status, 404);
    const approved = await adminPost(new Request('http://127.0.0.1/api/stories-admin?token=unit-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: body.stories[0].id, action: 'approve' }),
    }));
    assert.equal((await approved.json()).status, 'approved');
    const visible = await (await publicGet()).json();
    assert.equal(visible.stories.length, 1);
    assert.equal(JSON.stringify(visible).includes('ada@example.com'), false);
    assert.equal(Object.hasOwn(visible.stories[0], 'email'), false);
    const photo = await photoGet(new Request(`http://127.0.0.1/api/stories-photo?id=${body.stories[0].id}`));
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    runtime.storiesStore = previousStore;
    if (previousAdmin === undefined) delete process.env.STORIES_ADMIN_TOKEN;
    else process.env.STORIES_ADMIN_TOKEN = previousAdmin;
    if (previousBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousBlob;
  }
});
