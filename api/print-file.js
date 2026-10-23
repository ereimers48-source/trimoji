import { decodeDesign } from '../lib/design.js';
import { jsonError, safeLog } from '../lib/http.js';
import { renderLogoPng } from '../lib/render.js';

export async function GET(request) {
  try {
    const design = new URL(request.url).searchParams.get('design');
    const png = await renderLogoPng(decodeDesign(design));
    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
