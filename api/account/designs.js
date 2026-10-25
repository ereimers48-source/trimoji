import { assertCsrf, sessionFromRequest } from '../../lib/accounts.js';
import { activeAccountStore, saveDesign } from '../../lib/accounts-store.js';
import { jsonError, safeLog } from '../../lib/http.js';
import { runtime } from '../../lib/runtime.js';

export async function POST(request) {
  try {
    assertCsrf(request);
    const store = activeAccountStore(runtime);
    const session = sessionFromRequest(request);
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = await saveDesign(session, store, body);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
