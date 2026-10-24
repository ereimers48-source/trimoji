import { decodeDesign } from '../lib/design.js';
import { jsonError, preflight, safeLog, withCors } from '../lib/http.js';
import { renderLogoPng } from '../lib/render.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function GET(request) {
  try {
    const design = new URL(request.url).searchParams.get('design');
    const png = await renderLogoPng(decodeDesign(design));
    return withCors(request, new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    }));
  } catch (err) {
    safeLog(err);
    return withCors(request, jsonError(err));
  }
}
