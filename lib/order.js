import { itemsFromMetadata } from './design.js';
import { HttpError } from './http.js';
import { printfulExternalId } from './printful.js';
import { priceCart } from './prices.js';

const SESSION_ID = /^cs_[A-Za-z0-9_]{8,200}$/;

export function orderReference(sessionId) {
  const id = String(sessionId || '').trim();
  if (!SESSION_ID.test(id)) throw new HttpError(400, 'That order link is invalid');
  return printfulExternalId(id);
}

export function publicOrder(session) {
  if (!session || session.object !== 'checkout.session' || session.payment_status !== 'paid') {
    throw new HttpError(404, 'Order not found');
  }
  const priced = priceCart(itemsFromMetadata(session.metadata || {}));
  let { subtotal, shipping, total } = priced;
  const details = session.total_details && typeof session.total_details === 'object' ? session.total_details : null;
  const hasTax = Boolean(details && Number.isInteger(details.amount_tax) && details.amount_tax >= 0);
  const tax = hasTax ? details.amount_tax : null;
  const taxCents = tax || 0;
  if (details && Number.isInteger(details.amount_shipping) && details.amount_shipping >= 0) {
    shipping = details.amount_shipping;
  }
  const discount = details && Number.isInteger(details.amount_discount) && details.amount_discount >= 0
    ? details.amount_discount
    : 0;
  if (Number.isInteger(session.amount_total) && session.amount_total >= subtotal + taxCents - discount) {
    total = session.amount_total;
    if (!(details && Number.isInteger(details.amount_shipping))) {
      shipping = session.amount_total - subtotal - taxCents + discount;
    }
  }
  return {
    reference: orderReference(session.id),
    currency: 'usd',
    items: priced.lines.map((line) => ({
      name: line.variant.name,
      emojis: line.emojis.filter(Boolean),
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      amount: line.lineAmount,
    })),
    subtotal,
    shipping,
    tax,
    total,
  };
}
