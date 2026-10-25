import { requestIsHttps } from '../../lib/accounts.js';
import { activeAccountStore, verifySignIn } from '../../lib/accounts-store.js';
import { safeLog } from '../../lib/http.js';
import { runtime } from '../../lib/runtime.js';

export async function GET(request) {
  const url = new URL(request.url);
  const secure = requestIsHttps(request);
  let location = '/account?signin=invalid';
  const headers = { 'cache-control': 'no-store' };
  try {
    const result = await verifySignIn({
      token: url.searchParams.get('token') || '',
      store: activeAccountStore(runtime),
      env: process.env,
      secure,
    });
    if (result.ok) {
      const dest = new URL('/account', url.origin);
      if (result.next) dest.searchParams.set('next', result.next);
      location = `${dest.pathname}${dest.search}`;
      headers['set-cookie'] = result.cookie;
    }
  } catch (err) {
    safeLog(err);
  }
  headers.location = location;
  return new Response(null, { status: 303, headers });
}
