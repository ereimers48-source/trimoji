import { createCheckoutSession } from '../lib/checkout.js';
import { HttpError, jsonError, safeLog } from '../lib/http.js';
import { runtime } from '../lib/runtime.js';

export async function POST(request) {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new HttpError(500, 'Stripe is not configured');
    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, 'Send a JSON cart');
    }
    const session = await createCheckoutSession({
      items: body?.items,
      stripe: runtime.createStripe(key),
      siteUrl: process.env.SITE_URL,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
