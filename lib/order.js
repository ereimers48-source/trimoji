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
  if (Number.isInteger(session.amount_total) && session.amount_total >= subtotal) {
    total = session.amount_total;
    shipping = total - subtotal;
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
    total,
  };
}
