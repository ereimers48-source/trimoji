import { assertCsrf, clearSessionCookie, requestIsHttps, sessionFromRequest } from '../../lib/accounts.js';
import { activeAccountStore, deleteAccount } from '../../lib/accounts-store.js';
import { jsonError, safeLog } from '../../lib/http.js';
import { runtime } from '../../lib/runtime.js';

export async function POST(request) {
  try {
    assertCsrf(request);
    const store = activeAccountStore(runtime);
    const session = sessionFromRequest(request);
    await deleteAccount(session, store);
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
