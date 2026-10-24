import { HttpError, jsonError, safeLog } from '../lib/http.js';
import { PHOTO_MAX_BYTES, clientIp } from '../lib/stories.js';
import { activeStore, listPublicStories, submitStory } from '../lib/stories-store.js';
import { runtime } from '../lib/runtime.js';

function noStore(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const stories = await listPublicStories(activeStore(runtime));
    return noStore({ stories });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}

export async function POST(request) {
  try {
    let form;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'Send the story form');
    }
    const file = form.get('photo');
    let photo = null;
    if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function' && file.size > 0) {
      if (file.size > PHOTO_MAX_BYTES) throw new HttpError(400, 'Use a JPG, PNG, or WebP photo under 5 MB.');
      photo = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || '', size: file.size };
    }
    const result = await submitStory({
      emoji1: form.get('emoji1'),
      emoji2: form.get('emoji2'),
      emoji3: form.get('emoji3'),
      firstName: form.get('firstName'),
      city: form.get('city'),
      story: form.get('story'),
      email: form.get('email'),
      consent: form.get('consent'),
      company: form.get('company'),
      photo,
    }, { store: activeStore(runtime), ip: clientIp(request) });
    return noStore(result);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
