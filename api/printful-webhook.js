import { jsonError, safeLog } from '../lib/http.js';
import { handlePrintfulWebhook } from '../lib/printful-webhook.js';
import { runtime } from '../lib/runtime.js';

export async function POST(request) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const result = await handlePrintfulWebhook({
      url: request.url,
      readBody: () => request.text(),
      env: process.env,
      fetchImpl: runtime.fetch,
      stripe: stripeKey ? runtime.createStripe(stripeKey) : null,
    });
    return Response.json(result);
  } catch (err) {
    safeLog(err);
    return jsonError(err);
  }
}
