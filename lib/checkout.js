import { HttpError } from './http.js';
import { metadataForItems, normalizeCart, normalizeSiteUrl } from './design.js';
import { priceCart } from './prices.js';

export async function createCheckoutSession({ items, stripe, siteUrl, customerEmail }) {
  const normalized = normalizeCart(items);
  const priced = priceCart(normalized);
  const site = normalizeSiteUrl(siteUrl);
  const lineItems = priced.lines.map((line) => ({
    quantity: line.quantity,
    price_data: {
      currency: 'usd',
      unit_amount: line.unitAmount,
      product_data: {
        name: `Trimoji ${line.variant.name} ${line.emojis.join('')}`,
        description: `${line.color} / ${line.size} / ${line.layout}`,
      },
    },
  }));
  if (priced.shipping > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: priced.shipping,
        product_data: { name: 'US shipping' },
      },
    });
  }
  const params = {
    mode: 'payment',
    payment_method_types: ['card'],
    shipping_address_collection: { allowed_countries: ['US'] },
    line_items: lineItems,
    success_url: `${site}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/cancel.html`,
    metadata: metadataForItems(normalized),
  };
  if (customerEmail) params.customer_email = customerEmail;
  const session = await stripe.checkout.sessions.create(params);
  if (!session || !session.url) throw new HttpError(502, 'Stripe did not return a checkout URL');
  return { url: session.url, id: session.id };
}
