import { HttpError, jsonError, safeLog, withCors } from '../lib/http.js';
import { CHECKOUT_DISCOUNT_EXPAND, orderReference, publicOrder } from '../lib/order.js';
import { runtime } from '../lib/runtime.js';

export async function GET(request) {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new HttpError(500, 'Stripe is not configured');
    const sessionId = new URL(request.url).searchParams.get('session_id');
    orderReference(sessionId);
    let session;
    try {
      session = await runtime.createStripe(key).checkout.sessions.retrieve(sessionId, {
        expand: CHECKOUT_DISCOUNT_EXPAND,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const missing = err?.statusCode === 404 || err?.code === 'resource_missing';
      throw new HttpError(missing ? 404 : 502, missing ? 'Order not found' : 'Could not load that order');
    }
    return withCors(request, Response.json(publicOrder(session), {
      headers: { 'cache-control': 'no-store' },
    }));
  } catch (err) {
    safeLog(err);
    return withCors(request, jsonError(err));
  }
}
