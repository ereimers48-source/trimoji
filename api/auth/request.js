import { assertCsrf, clientIp } from '../../lib/accounts.js';
import { activeAccountStore, requestSignIn } from '../../lib/accounts-store.js';
import { jsonError, safeLog } from '../../lib/http.js';
import { runtime } from '../../lib/runtime.js';

function noStore(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
}

export async function POST(request) {
  try {
    assertCsrf(request);
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = await requestSignIn({
      email: body?.email,
      next: body?.next,
      store: activeAccountStore(runtime),
      ip: clientIp(request),
      env: process.env,
      mailer: runtime.mailer || null,
    });
    return noStore(result);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
