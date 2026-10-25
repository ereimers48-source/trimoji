import { itemsFromMetadata } from './design.js';
import { HttpError } from './http.js';
import { printfulExternalId } from './printful.js';
import { priceCart } from './prices.js';

const SESSION_ID = /^cs_[A-Za-z0-9_]{8,200}$/;

export const CHECKOUT_DISCOUNT_EXPAND = ['discounts.promotion_code', 'discounts.coupon'];

export function settledPaymentStatus(status) {
  return status === 'paid' || status === 'no_payment_required';
}

function plainLabel(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function money(cents) {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function couponName(coupon) {
  if (!coupon || typeof coupon !== 'object') return '';
  return plainLabel(coupon.name, 40);
}

function nameFromDiscount(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const promo = entry.promotion_code;
  if (promo && typeof promo === 'object') {
    const code = plainLabel(promo.code, 40);
    if (code) return code;
    const nested = couponName(promo.coupon) || couponName(promo.promotion && promo.promotion.coupon);
    if (nested) return nested;
  }
  return couponName(entry.coupon);
}

export function formatDiscountLine(discount) {
  if (!discount || !Number.isInteger(discount.amount) || discount.amount <= 0) return '';
  const label = plainLabel(discount.label, 80);
  const title = label ? `Discount ${label}` : 'Discount';
  return `${title} -${money(discount.amount)}`;
}

export function discountFromSession(session) {
  const details = session?.total_details && typeof session.total_details === 'object' ? session.total_details : null;
  const amount = details && Number.isInteger(details.amount_discount) ? details.amount_discount : 0;
  if (amount <= 0) return null;
  const names = [];
  const discounts = Array.isArray(session?.discounts) ? session.discounts : [];
  for (const entry of discounts) {
    const name = nameFromDiscount(entry);
    if (name && !names.includes(name)) names.push(name);
  }
  const label = names.join(', ');
  return { amount, label, line: formatDiscountLine({ amount, label }) };
}

export function orderReference(sessionId) {
  const id = String(sessionId || '').trim();
  if (!SESSION_ID.test(id)) throw new HttpError(400, 'That order link is invalid');
  return printfulExternalId(id);
}

export function publicOrder(session) {
  if (!session || session.object !== 'checkout.session' || !settledPaymentStatus(session.payment_status)) {
    throw new HttpError(404, 'Order not found');
  }
  const priced = priceCart(itemsFromMetadata(session.metadata || {}));
  let { subtotal, shipping, total } = priced;
  const details = session.total_details && typeof session.total_details === 'object' ? session.total_details : null;
  const hasTax = Boolean(details && Number.isInteger(details.amount_tax) && details.amount_tax >= 0);
  const tax = hasTax ? details.amount_tax : null;
  const taxCents = tax || 0;
  const discount = discountFromSession(session);
  const discountCents = discount ? discount.amount : 0;
  if (details && Number.isInteger(details.amount_shipping) && details.amount_shipping >= 0) {
    shipping = details.amount_shipping;
  }
  if (Number.isInteger(session.amount_total) && session.amount_total >= 0) {
    const explicitShipping = Boolean(details && Number.isInteger(details.amount_shipping));
    if (!explicitShipping && discountCents === 0 && session.amount_total >= subtotal + taxCents) {
      shipping = session.amount_total - subtotal - taxCents;
    }
    total = session.amount_total;
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
    discount,
    total,
  };
}
