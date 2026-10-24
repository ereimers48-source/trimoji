import { createHash, timingSafeEqual } from 'node:crypto';

export const STORY_MIN = 20;
export const STORY_MAX = 600;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const RATE_LIMIT_MAX = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

const NAME_MAX = 40;
const CITY_MAX = 60;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizePlain(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\u0000/g, '')
    .trim();
}

export function isOneEmoji(value) {
  const text = String(value ?? '').trim();
  if (!text || [...text].length > 16) return false;
  if (/[<>&]/.test(text)) return false;
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
  if (parts.length !== 1) return false;
  return /\p{Extended_Pictographic}/u.test(text);
}

function validName(value, max, pattern) {
  const text = sanitizePlain(value);
  if (!text) return '';
  if (text.length > max) return null;
  if (!pattern.test(text)) return null;
  return text;
}

export function normalizeEmail(value) {
  const text = sanitizePlain(value).toLowerCase();
  if (!text) return '';
  if (text.length > 254 || /[<>]/.test(text)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text;
}

export function detectImage(bytes, declaredType) {
  const buf = Buffer.from(bytes || []);
  if (buf.length < 12 || buf.length > PHOTO_MAX_BYTES) return null;
  const declared = String(declaredType || '').toLowerCase().split(';')[0].trim().replace('image/jpg', 'image/jpeg');
  let sniffed = '';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) sniffed = 'image/png';
  else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) sniffed = 'image/jpeg';
  else if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') sniffed = 'image/webp';
  if (!sniffed) return null;
  if (declared && declared !== 'application/octet-stream' && declared !== sniffed) return null;
  return sniffed;
}

export function validateSubmission(input = {}) {
  if (String(input.company ?? '').trim()) return { ok: true, dropped: true };
  const emojis = [input.emoji1, input.emoji2, input.emoji3].map((item) => String(item ?? '').trim());
  if (emojis.some((item) => !isOneEmoji(item))) return { ok: false, error: 'Pick three emojis. The same emoji can be used more than once.' };
  const firstName = validName(input.firstName, NAME_MAX, /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u);
  if (firstName == null || !firstName) return { ok: false, error: 'Add your first name.' };
  const city = validName(input.city, CITY_MAX, /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .'’,()-]*$/u);
  if (city == null) return { ok: false, error: 'Use letters for the city, or leave it blank.' };
  const story = sanitizePlain(input.story).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (story.length < STORY_MIN || story.length > STORY_MAX) {
    return { ok: false, error: 'Tell your story in 20 to 600 characters.' };
  }
  const email = normalizeEmail(input.email);
  if (email == null) return { ok: false, error: 'Add a valid email, or leave it blank.' };
  const consent = input.consent === true || /^(yes|on|true)$/i.test(String(input.consent ?? ''));
  if (!consent) return { ok: false, error: 'Check the box to let Trimoji share your story.' };
  let photo = null;
  if (input.photo && Number(input.photo.size || input.photo.bytes?.length || 0) > 0) {
    if ((input.photo.size || input.photo.bytes.length) > PHOTO_MAX_BYTES) {
      return { ok: false, error: 'Use a JPG, PNG, or WebP photo under 5 MB.' };
    }
    const contentType = detectImage(input.photo.bytes, input.photo.type);
    if (!contentType) return { ok: false, error: 'Use a JPG, PNG, or WebP photo under 5 MB.' };
    photo = { bytes: Buffer.from(input.photo.bytes), contentType };
  }
  return {
    ok: true,
    value: { emojis, firstName, city, story, email, photo: photo ? photo.contentType : null, consent: true },
    photo,
  };
}

export function toPublicStory(record) {
  return {
    id: record.id,
    emojis: [...record.emojis],
    firstName: record.firstName,
    city: record.city || '',
    story: record.story,
    photo: Boolean(record.photo),
    createdAt: record.createdAt,
  };
}

export function toAdminStory(record) {
  return { ...toPublicStory(record), email: record.email || '', status: record.status };
}

export function approvedStories(records) {
  return records
    .filter((record) => record && record.status === 'approved')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(toPublicStory);
}

export function hashIp(ip) {
  return createHash('sha256').update(`trimoji-stories:${ip || 'unknown'}`).digest('hex').slice(0, 32);
}

export function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const left = Buffer.from(String(given));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function tokenFromRequest(request) {
  const header = request.headers.get('x-stories-token') || '';
  const auth = request.headers.get('authorization') || '';
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const query = new URL(request.url).searchParams.get('token') || '';
  return { header, bearer, query };
}

export function adminAccess(request, env = process.env) {
  const expected = typeof env.STORIES_ADMIN_TOKEN === 'string' ? env.STORIES_ADMIN_TOKEN : '';
  if (!expected) return 'unconfigured';
  const presented = tokenFromRequest(request);
  if (tokenMatches(presented.header, expected) || tokenMatches(presented.bearer, expected) || tokenMatches(presented.query, expected)) {
    return 'ok';
  }
  return 'denied';
}

export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0].trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

export function isStoryId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}
