import { resolveVariant } from './variants.js';

export const SHIPPING_CENTS = 599;
export const FREE_SHIPPING_OVER_CENTS = 6000;

export function priceCart(items) {
  const lines = items.map((item) => {
    const variant = resolveVariant(item.product, item.color, item.size);
    return {
      ...item,
      variant,
      unitAmount: variant.unitAmount,
      lineAmount: variant.unitAmount * item.quantity,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineAmount, 0);
  // Free shipping is the pre-discount merchandise subtotal. Stripe applies a
  // promotion code later and does not move this threshold.
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_OVER_CENTS ? 0 : SHIPPING_CENTS;
  return { lines, subtotal, shipping, total: subtotal + shipping };
}
