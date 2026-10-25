import { assertCsrf, clearSessionCookie, requestIsHttps } from '../../lib/accounts.js';
import { jsonError, safeLog } from '../../lib/http.js';

export async function POST(request) {
  try {
    assertCsrf(request);
    return Response.json({ ok: true }, {
      headers: {
        'cache-control': 'no-store',
        'set-cookie': clearSessionCookie({ secure: requestIsHttps(request) }),
      },
    });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
