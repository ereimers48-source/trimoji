import { resolveSiteUrl } from './design.js';
import { HttpError } from './http.js';
import { buildPrintfulOrder, createPrintfulOrder } from './printful.js';

export async function handleStripeWebhook({ rawBody, signature, env, stripe, fetchImpl }) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(500, 'Stripe webhook is not configured');
  if (!signature) throw new HttpError(400, 'Missing Stripe signature');
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new HttpError(400, 'Invalid Stripe signature');
  }
  if (event.type !== 'checkout.session.completed') return { received: true, ignored: true };
  const order = buildPrintfulOrder({ session: event.data.object, siteUrl: resolveSiteUrl(env.SITE_URL) });
  const confirm = env.PRINTFUL_AUTO_CONFIRM === 'true';
  try {
    const created = await createPrintfulOrder(order, {
      confirm,
      token: env.PRINTFUL_API_TOKEN,
      storeId: env.PRINTFUL_STORE_ID,
      fetchImpl,
    });
    return { received: true, confirm, printfulOrderId: created?.result?.id ?? null };
  } catch (err) {
    // Printful's create-order response for a reused external_id is
    // "Order with External ID already exists". A confirmed order that cannot
    // be updated says "Order already exists and cannot be updated".
    if (err instanceof HttpError && err.status === 400 && /already exists/i.test(err.message)) {
      return { received: true, duplicate: true };
    }
    throw err;
  }
}
