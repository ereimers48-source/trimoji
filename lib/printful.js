import { HttpError } from './http.js';
import { itemsFromMetadata, printFileUrl } from './design.js';

export function recipientFromSession(session) {
  const shipping = session?.collected_information?.shipping_details || session?.shipping_details || null;
  const address = shipping?.address;
  if (!address) throw new HttpError(400, 'Checkout session is missing a shipping address');
  if (address.country !== 'US') throw new HttpError(400, 'Only US shipping is available');
  const name = shipping.name || session.customer_details?.name;
  if (!name || !address.line1 || !address.city || !address.state || !address.postal_code) {
    throw new HttpError(400, 'Shipping address is incomplete');
  }
  const recipient = {
    name,
    address1: address.line1,
    city: address.city,
    state_code: address.state,
    country_code: 'US',
    zip: address.postal_code,
  };
  if (address.line2) recipient.address2 = address.line2;
  if (session.customer_details?.email) recipient.email = session.customer_details.email;
  return recipient;
}

export function buildPrintfulOrder({ session, siteUrl }) {
  const items = itemsFromMetadata(session.metadata);
  return {
    external_id: session.id,
    shipping: 'STANDARD',
    recipient: recipientFromSession(session),
    items: items.map((item) => {
      const line = {
        variant_id: item.variant.variantId,
        quantity: item.quantity,
        name: `Trimoji ${item.variant.name}`,
        retail_price: (item.variant.unitAmount / 100).toFixed(2),
        files: [{ type: item.variant.printType, url: printFileUrl(siteUrl, item) }],
      };
      if (item.variant.technique) {
        line.options = [{ id: 'technique', value: item.variant.technique }];
      }
      return line;
    }),
  };
}

export async function createPrintfulOrder(order, { confirm, token, storeId, fetchImpl }) {
  if (!token) throw new HttpError(500, 'Printful is not configured');
  if (!storeId) throw new HttpError(500, 'Printful store is not configured');
  const url = new URL('https://api.printful.com/orders');
  url.searchParams.set('confirm', confirm ? 'true' : 'false');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-PF-Store-Id': String(storeId),
    },
    body: JSON.stringify(order),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data && (data.error?.message || (typeof data.result === 'string' ? data.result : null)))
      || 'Printful order failed';
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new HttpError(status, message);
  }
  return data;
}
