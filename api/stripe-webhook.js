import { HttpError, jsonError, preflight, safeLog, withCors } from '../lib/http.js';
import { runtime } from '../lib/runtime.js';
import { handleStripeWebhook } from '../lib/webhook.js';

export function OPTIONS(request) {
  return preflight(request);
}

export async function POST(request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(500, 'Stripe is not configured');
    const result = await handleStripeWebhook({
      rawBody: await request.text(),
      signature: request.headers.get('stripe-signature'),
      env: process.env,
      stripe: runtime.createStripe(process.env.STRIPE_SECRET_KEY),
      fetchImpl: runtime.fetch,
    });
    return withCors(request, Response.json(result));
  } catch (err) {
    safeLog(err);
    return withCors(request, jsonError(err));
  }
}
