import { jsonError, safeLog } from '../lib/http.js';
import { activeStore, readPublicPhoto } from '../lib/stories-store.js';
import { runtime } from '../lib/runtime.js';

export async function GET(request) {
  try {
    let store = null;
    try {
      store = activeStore(runtime);
    } catch {
      store = null;
    }
    const id = new URL(request.url).searchParams.get('id') || '';
    const photo = store ? await readPublicPhoto(store, id) : null;
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
