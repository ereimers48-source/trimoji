import { assertCsrf, requestIsHttps, sessionFromRequest } from '../lib/accounts.js';
import { activeAccountStore, readAccount, updateProfile } from '../lib/accounts-store.js';
import { jsonError, safeLog } from '../lib/http.js';
import { runtime } from '../lib/runtime.js';

function noStore(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
}

export async function GET(request) {
  try {
    const store = activeAccountStore(runtime);
    const session = sessionFromRequest(request);
    const view = await readAccount(session, store, {
      token: process.env.PRINTFUL_API_TOKEN,
      storeId: process.env.PRINTFUL_STORE_ID,
      fetchImpl: runtime.accountPrintfulFetch || runtime.fetch,
    });
    return noStore(view);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}

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
    const result = await updateProfile(session, store, body);
    return noStore(result);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
