import { appendCheckoutOrder } from './accounts-store.js';
import { resolveSiteUrl } from './design.js';
import { HttpError, safeLog } from './http.js';
import { sendOrderConfirmation } from './order-mail.js';
import { buildPrintfulOrder, createPrintfulOrder } from './printful.js';

export async function handleStripeWebhook({ rawBody, signature, env, stripe, fetchImpl, accountStore = null }) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(500, 'Stripe webhook is not configured');
  if (!signature) throw new HttpError(400, 'Missing Stripe signature');
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new HttpError(400, 'Invalid Stripe signature');
  }
  if (event.type !== 'checkout.session.completed') return { received: true, ignored: true };
  const session = event.data.object;
  const order = buildPrintfulOrder({ session, siteUrl: resolveSiteUrl(env.SITE_URL) });
  const confirm = env.PRINTFUL_AUTO_CONFIRM === 'true';
  let created = null;
  let duplicate = false;
  try {
    created = await createPrintfulOrder(order, {
      confirm,
      token: env.PRINTFUL_API_TOKEN,
      storeId: env.PRINTFUL_STORE_ID,
      fetchImpl,
    });
  } catch (err) {
    // Printful's create-order response for a reused external_id is
    // "Order with External ID already exists". A confirmed order that cannot
    // be updated says "Order already exists and cannot be updated".
    if (err instanceof HttpError && err.status === 400 && /already exists/i.test(err.message)) {
      duplicate = true;
    } else {
      throw err;
    }
  }
  if (accountStore && created) {
    try {
      await appendCheckoutOrder(accountStore, session, order, created);
    } catch (err) {
      safeLog(err);
    }
  }
  try {
    await sendOrderConfirmation({ session, externalId: order.external_id, env, fetchImpl });
  } catch {
    safeLog('order mail failed via resend status=none name=Error');
  }
  if (duplicate) return { received: true, duplicate: true };
  return { received: true, confirm, printfulOrderId: created?.result?.id ?? null };
}
