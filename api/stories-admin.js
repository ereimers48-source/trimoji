import { HttpError, jsonError, safeLog } from '../lib/http.js';
import { adminAccess } from '../lib/stories.js';
import { activeStore, listPendingStories, moderateStory, readAdminPhoto } from '../lib/stories-store.js';
import { runtime } from '../lib/runtime.js';

function guard(request) {
  const access = adminAccess(request);
  if (access === 'unconfigured') throw new HttpError(503, 'Story admin is not configured');
  if (access !== 'ok') throw new HttpError(401, 'That admin token does not match.');
}

function noStore(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  try {
    guard(request);
    const stories = await listPendingStories(activeStore(runtime));
    return noStore({ stories });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}

export async function POST(request) {
  try {
    guard(request);
    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, 'Send a JSON action');
    }
    const result = await moderateStory(activeStore(runtime), body?.id, body?.action);
    return noStore(result);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}

export async function photoGET(request) {
  try {
    guard(request);
    const id = new URL(request.url).searchParams.get('id') || '';
    const photo = await readAdminPhoto(activeStore(runtime), id);
    if (!photo) {
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response(photo.bytes, {
      headers: {
        'content-type': photo.contentType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
