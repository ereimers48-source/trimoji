import { sessionFromRequest } from '../../lib/accounts.js';
import { activeAccountStore, designForSession } from '../../lib/accounts-store.js';
import { composeSvg, twemojiUrl } from '../../lib/render.js';
import { safeLog } from '../../lib/http.js';
import { runtime } from '../../lib/runtime.js';

async function emojiSvgs(emojis) {
  const texts = [];
  for (const emoji of emojis) {
    if (!emoji) continue;
    const response = await runtime.fetch(twemojiUrl(emoji));
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.includes('<svg')) return null;
    texts.push(text);
  }
  return texts;
}

export async function GET(request) {
  try {
    const store = activeAccountStore(runtime);
    const session = sessionFromRequest(request);
    const id = new URL(request.url).searchParams.get('id') || '';
    const design = await designForSession(session, store, id);
    if (!design) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    const texts = await emojiSvgs(design.slots);
    if (!texts) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    const svg = composeSvg({
      product: design.product,
      emojis: design.slots,
      layout: design.layout,
      logoSize: design.logoSize,
      background: { shape: 'none' },
    }, texts);
    return new Response(svg, {
      status: 200,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    safeLog(err);
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}
