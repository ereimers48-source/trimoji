import { HttpError } from './http.js';
import { metadataForItems, normalizeCart, normalizeSiteUrl } from './design.js';
import { priceCart } from './prices.js';

export const SHIPPING_TAX_CODE = 'txcd_92010001';

export function stripeTaxEnabled(env = process.env) {
  const raw = env && typeof env.STRIPE_TAX_ENABLED === 'string' ? env.STRIPE_TAX_ENABLED.trim().toLowerCase() : '';
  return raw !== 'false' && raw !== '0' && raw !== 'no' && raw !== 'off';
}

export async function createCheckoutSession({ items, stripe, siteUrl, customerEmail, env = process.env }) {
  const normalized = normalizeCart(items);
  const priced = priceCart(normalized);
  const site = normalizeSiteUrl(siteUrl);
  const tax = stripeTaxEnabled(env);
  const lineItems = priced.lines.map((line) => {
    const price = {
      currency: 'usd',
      unit_amount: line.unitAmount,
      product_data: {
        name: `Trimoji ${line.variant.name} ${line.emojis.join('')}`,
        description: `${line.color} / ${line.size} / ${line.layout}`,
      },
    };
    if (tax) price.tax_behavior = 'exclusive';
    return { quantity: line.quantity, price_data: price };
  });
  const params = {
    mode: 'payment',
    payment_method_types: ['card'],
    shipping_address_collection: { allowed_countries: ['US'] },
    line_items: lineItems,
    success_url: `${site}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/cancel.html`,
    metadata: metadataForItems(normalized),
  };
  if (tax) {
    params.automatic_tax = { enabled: true };
    params.shipping_options = [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: priced.shipping, currency: 'usd' },
        display_name: 'US shipping',
        tax_behavior: 'exclusive',
        tax_code: SHIPPING_TAX_CODE,
      },
    }];
  } else if (priced.shipping > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: priced.shipping,
        product_data: { name: 'US shipping' },
      },
    });
  }
  if (customerEmail) params.customer_email = customerEmail;
  const session = await stripe.checkout.sessions.create(params);
  if (!session || !session.url) throw new HttpError(502, 'Stripe did not return a checkout URL');
  return { url: session.url, id: session.id };
}
