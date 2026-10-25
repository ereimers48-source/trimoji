import { appendCheckoutOrder } from './accounts-store.js';
import { resolveSiteUrl } from './design.js';
import { HttpError, safeLog } from './http.js';
import { sendOrderConfirmation } from './order-mail.js';
import { CHECKOUT_DISCOUNT_EXPAND, discountFromSession, settledPaymentStatus } from './order.js';
import { buildPrintfulOrder, createPrintfulOrder } from './printful.js';

async function receiptSession(session, stripe) {
  const discount = discountFromSession(session);
  if (!discount || discount.label) return session;
  const retrieve = stripe?.checkout?.sessions?.retrieve;
  if (typeof retrieve !== 'function' || !session?.id) return session;
  try {
    const expanded = await retrieve(session.id, { expand: CHECKOUT_DISCOUNT_EXPAND });
    if (!expanded || typeof expanded !== 'object') return session;
    return {
      ...session,
      discounts: Array.isArray(expanded.discounts) ? expanded.discounts : session.discounts,
      total_details: expanded.total_details && typeof expanded.total_details === 'object'
        ? expanded.total_details
        : session.total_details,
      amount_total: Number.isInteger(expanded.amount_total) ? expanded.amount_total : session.amount_total,
      payment_status: typeof expanded.payment_status === 'string' ? expanded.payment_status : session.payment_status,
    };
  } catch {
    return session;
  }
}

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
  // `paid` is a card charge, including a $0 charge when Checkout collected a card.
  // `no_payment_required` is a $0 total with no PaymentIntent. Both are fulfilled.
  if (!session || !settledPaymentStatus(session.payment_status)) {
    return { received: true, ignored: true };
  }
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
    const receipt = await receiptSession(session, stripe);
    await sendOrderConfirmation({ session: receipt, externalId: order.external_id, env, fetchImpl });
  } catch {
    safeLog('order mail failed via resend status=none name=Error');
  }
  if (duplicate) return { received: true, duplicate: true };
  return { received: true, confirm, printfulOrderId: created?.result?.id ?? null };
}
