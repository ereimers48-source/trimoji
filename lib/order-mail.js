import { escapeHtml, normalizeEmail } from './accounts.js';
import { itemsFromMetadata } from './design.js';
import { safeLog } from './http.js';
import { deliverCustomerMail } from './mailer.js';
import { loadPrintfulOrder, printfulExternalId } from './printful.js';

const RETURNS_URL = 'https://trimojiapparel.com/returns';
const HELLO = 'hello@trimojiapparel.com';
const FROM = 'Trimoji <hello@trimojiapparel.com>';
const SESSION_SLIP = /^Stripe session (cs_[A-Za-z0-9_]{8,200})$/;

export function sessionIdFromPackingSlip(message) {
  const match = SESSION_SLIP.exec(String(message || '').trim());
  return match ? match[1] : '';
}

export function orderIdempotencyKey(externalId) {
  const id = String(externalId || '');
  if (!/^[0-9a-f]{32}$/.test(id)) return '';
  return `order-confirmation/${id}`;
}

export function shipmentIdempotencyKey(orderId, trackingNumber) {
  const id = String(orderId ?? '');
  const tracking = String(trackingNumber ?? '').trim();
  if (!/^[0-9]{1,20}$/.test(id)) return '';
  if (!/^[A-Za-z0-9-]{1,80}$/.test(tracking)) return '';
  return `shipment/${id}/${tracking}`;
}

function plain(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function formatUsd(cents) {
  if (!Number.isInteger(cents)) return '';
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function httpsUrl(value) {
  const raw = plain(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function shippingDetails(session) {
  return session?.collected_information?.shipping_details || session?.shipping_details || null;
}

function addressLines(ship) {
  const source = ship || {};
  const lines = [];
  const name = plain(source.name, 80);
  const line1 = plain(source.line1, 80);
  const line2 = plain(source.line2, 80);
  const city = plain(source.city, 60);
  const state = plain(source.state, 8);
  const postalCode = plain(source.postalCode, 20);
  if (name) lines.push(name);
  if (line1) lines.push(line1);
  if (line2) lines.push(line2);
  const cityLine = [city, state].filter(Boolean).join(', ');
  const last = [cityLine, postalCode].filter(Boolean).join(' ');
  if (last) lines.push(last);
  return lines;
}

function card(title, inner) {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table role="presentation" lang="en" dir="ltr" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border-radius:18px">
        <tr><td style="padding:32px 28px">
          <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.03em">Trimoji</p>
          ${inner}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href, label) {
  const safeHref = escapeHtml(href);
  return `<p style="margin:22px 0 0"><a href="${safeHref}" style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;border-radius:980px;padding:12px 22px;font-size:17px;font-weight:500">${escapeHtml(label)}</a></p>
          <p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45;word-break:break-all">${safeHref}</p>`;
}

export function orderConfirmationMessage({ to, reference, items, total, tax, shipTo }) {
  const lines = Array.isArray(items) ? items : [];
  const textItems = lines.map((item) => {
    const qty = Number.isInteger(item.quantity) && item.quantity > 1 ? `${item.quantity} × ` : '';
    const marks = (item.emojis || []).filter(Boolean).join(' ');
    const options = [item.color, item.size].filter(Boolean).join(' · ');
    return [qty + (item.name || 'Item'), marks, options].filter(Boolean).join('\n');
  }).join('\n\n');
  const shipLines = addressLines(shipTo || {});
  const paid = formatUsd(total);
  const taxText = Number.isInteger(tax) ? formatUsd(tax) : '';
  const text = [
    'Thank you for your Trimoji order',
    '',
    reference ? `Order reference ${reference}` : '',
    '',
    textItems,
    '',
    paid ? `Amount paid ${paid}` : '',
    taxText ? `Tax ${taxText}` : '',
    '',
    shipLines.length ? `Shipping to\n${shipLines.join('\n')}` : '',
    '',
    "We'll email tracking when it ships. It's made to order: printing usually takes 2–5 business days, then about 3–4 business days to arrive in the US. That's an estimate.",
    '',
    `Returns: ${RETURNS_URL}`,
    `Questions: ${HELLO}`,
  ].filter((line, index, all) => line !== '' || (all[index - 1] !== '' && all[index - 1] != null)).join('\n');

  const itemHtml = lines.map((item) => {
    const name = plain(item.name, 80) || 'Item';
    const qty = Number.isInteger(item.quantity) && item.quantity > 1 ? `${item.quantity} × ` : '';
    const marks = (item.emojis || []).filter(Boolean).map((emoji) => escapeHtml(plain(emoji, 32))).join(' ');
    const color = plain(item.color, 40);
    const size = plain(item.size, 40);
    const options = [color, size].filter(Boolean).map((part) => escapeHtml(part)).join(' · ');
    return `<p style="margin:14px 0 0;font-size:17px;line-height:1.45">${escapeHtml(qty)}${escapeHtml(name)}</p>
          ${marks ? `<p style="margin:4px 0 0;font-size:17px;line-height:1.45">${marks}</p>` : ''}
          ${options ? `<p style="margin:4px 0 0;color:#6e6e73;font-size:15px;line-height:1.45">${options}</p>` : ''}`;
  }).join('');
  const shipHtml = shipLines.map((line) => `<p style="margin:4px 0 0;font-size:17px;line-height:1.45">${escapeHtml(line)}</p>`).join('');
  const inner = `
          <h1 style="margin:18px 0 0;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-.03em">Thank you</h1>
          <p style="margin:14px 0 0;color:#6e6e73;font-size:17px;line-height:1.45">Thanks for your order. We're printing it now.</p>
          ${reference ? `<p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45">Order reference</p><p style="margin:4px 0 0;font-size:15px;line-height:1.45;word-break:break-all">${escapeHtml(reference)}</p>` : ''}
          <h2 style="margin:22px 0 0;font-size:17px;line-height:1.3;font-weight:600">Your items</h2>
          ${itemHtml}
          <h2 style="margin:22px 0 0;font-size:17px;line-height:1.3;font-weight:600">Payment</h2>
          ${paid ? `<p style="margin:14px 0 0;font-size:17px;line-height:1.45">Amount paid ${escapeHtml(paid)}</p>` : ''}
          ${taxText ? `<p style="margin:4px 0 0;font-size:17px;line-height:1.45">Tax ${escapeHtml(taxText)}</p>` : ''}
          ${shipHtml ? `<h2 style="margin:22px 0 0;font-size:17px;line-height:1.3;font-weight:600">Shipping to</h2>${shipHtml}` : ''}
          <p style="margin:18px 0 0;color:#6e6e73;font-size:15px;line-height:1.45">We'll email tracking when it ships. It's made to order: printing usually takes 2–5 business days, then about 3–4 business days to arrive in the US. That's an estimate.</p>
          ${button(RETURNS_URL, 'Returns')}
          <p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45">Questions go to <a href="mailto:${HELLO}" style="color:#0071e3;text-decoration:none">${HELLO}</a>.</p>`;
  return {
    from: FROM,
    to,
    subject: 'Your Trimoji order',
    text,
    html: card('Your Trimoji order', inner),
  };
}

export function shipmentMessage({ to, reference, items, carrier, trackingNumber, trackingUrl, city, state }) {
  const lines = Array.isArray(items) ? items : [];
  const url = httpsUrl(trackingUrl);
  const place = [plain(city, 60), plain(state, 8)].filter(Boolean).join(', ');
  const textItems = lines.map((item) => {
    const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? `${item.quantity} × ` : '';
    return qty + (plain(item.name, 120) || 'Item');
  }).join('\n');
  const text = [
    'Your Trimoji order has shipped',
    '',
    reference ? `Order reference ${reference}` : '',
    '',
    carrier ? `Carrier ${carrier}` : '',
    trackingNumber ? `Tracking number ${trackingNumber}` : '',
    url || '',
    '',
    textItems,
    '',
    place ? `Ships to ${place}` : '',
    '',
    `Questions: ${HELLO}`,
  ].filter((line) => line !== '').join('\n');
  const itemHtml = lines.map((item) => {
    const qty = Number.isInteger(item.quantity) && item.quantity > 1 ? `${item.quantity} × ` : '';
    const name = plain(item.name, 120) || 'Item';
    return `<p style="margin:14px 0 0;font-size:17px;line-height:1.45">${escapeHtml(qty)}${escapeHtml(name)}</p>`;
  }).join('');
  const inner = `
          <h1 style="margin:18px 0 0;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-.03em">On the way</h1>
          <p style="margin:14px 0 0;color:#6e6e73;font-size:17px;line-height:1.45">Your order has shipped.</p>
          ${reference ? `<p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45">Order reference</p><p style="margin:4px 0 0;font-size:15px;line-height:1.45;word-break:break-all">${escapeHtml(reference)}</p>` : ''}
          ${carrier ? `<p style="margin:14px 0 0;font-size:17px;line-height:1.45">${escapeHtml(plain(carrier, 40))}</p>` : ''}
          ${trackingNumber ? `<p style="margin:4px 0 0;font-size:17px;line-height:1.45">Tracking number ${escapeHtml(plain(trackingNumber, 80))}</p>` : ''}
          ${url ? button(url, 'Track your order') : ''}
          <h2 style="margin:22px 0 0;font-size:17px;line-height:1.3;font-weight:600">Items</h2>
          ${itemHtml}
          ${place ? `<p style="margin:18px 0 0;color:#6e6e73;font-size:15px;line-height:1.45">Ships to ${escapeHtml(place)}</p>` : ''}
          <p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45">Questions go to <a href="mailto:${HELLO}" style="color:#0071e3;text-decoration:none">${HELLO}</a>.</p>`;
  return {
    from: FROM,
    to,
    subject: 'Your Trimoji order has shipped',
    text,
    html: card('Your Trimoji order has shipped', inner),
  };
}

function confirmationView(session, externalId) {
  const items = itemsFromMetadata(session.metadata || {}).map((item) => ({
    name: item.variant.name,
    emojis: (item.emojis || []).filter(Boolean),
    color: item.color,
    size: item.size,
    quantity: item.quantity,
  }));
  const shipping = shippingDetails(session) || {};
  const address = shipping.address || {};
  const details = session.total_details && typeof session.total_details === 'object' ? session.total_details : null;
  const tax = details && Number.isInteger(details.amount_tax) && details.amount_tax >= 0 ? details.amount_tax : null;
  const total = Number.isInteger(session.amount_total) && session.amount_total >= 0 ? session.amount_total : null;
  return {
    items,
    tax,
    total,
    shipTo: {
      name: plain(shipping.name || session.customer_details?.name, 80),
      line1: plain(address.line1, 80),
      line2: plain(address.line2, 80),
      city: plain(address.city, 60),
      state: plain(address.state, 8),
      postalCode: plain(address.postal_code, 20),
    },
    reference: plain(externalId, 32),
  };
}

export async function sendOrderConfirmation({ session, externalId, env = process.env, fetchImpl = null }) {
  try {
    const to = normalizeEmail(session?.customer_details?.email);
    if (!to) {
      safeLog('order mail failed via resend status=none name=no_recipient');
      return false;
    }
    const view = confirmationView(session, externalId);
    const message = orderConfirmationMessage({ to, ...view });
    return await deliverCustomerMail({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      idempotencyKey: orderIdempotencyKey(externalId),
      env,
      fetchImpl,
      label: 'order',
    });
  } catch {
    safeLog('order mail failed via resend status=none name=Error');
    return false;
  }
}

function trackingNumberOf(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string') {
    const text = plain(value, 80);
    if (text && text !== '0' && /^[A-Za-z0-9-]{1,80}$/.test(text)) return text;
  }
  return '';
}

function normalizeOrder(order) {
  const source = order && typeof order === 'object' ? order : {};
  const items = Array.isArray(source.items) ? source.items.map((item) => ({
    id: item?.id,
    name: typeof item?.name === 'string' ? item.name : '',
    quantity: item?.quantity,
  })) : [];
  return {
    id: source.id,
    externalId: typeof source.external_id === 'string' ? source.external_id : '',
    packingSlipMessage: typeof source.packing_slip?.message === 'string' ? source.packing_slip.message : '',
    city: typeof source.recipient?.city === 'string' ? source.recipient.city : '',
    state: typeof source.recipient?.state_code === 'string' ? source.recipient.state_code : '',
    items,
  };
}

function shipmentLines(order, shipment) {
  const items = Array.isArray(order.items) ? order.items : [];
  const pieces = Array.isArray(shipment?.items) ? shipment.items : [];
  const byId = new Map(items.filter((item) => item && item.id != null).map((item) => [String(item.id), item]));
  const picked = [];
  for (const piece of pieces) {
    const item = byId.get(String(piece?.item_id));
    if (!item) continue;
    const quantity = Number.isInteger(piece.quantity) && piece.quantity > 0 ? piece.quantity : item.quantity;
    picked.push({ name: item.name, quantity });
  }
  const source = picked.length ? picked : items;
  return source.map((item) => ({
    name: plain(item.name, 120) || 'Item',
    quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
  }));
}

async function customerEmailForOrder(order, { env, fetchImpl, stripe }) {
  const sessionId = sessionIdFromPackingSlip(order.packingSlipMessage);
  if (!sessionId) {
    safeLog('shipment mail failed via resend status=none name=no_session');
    return '';
  }
  let expected = '';
  try {
    expected = printfulExternalId(sessionId);
  } catch {
    expected = '';
  }
  if (!order.externalId || order.externalId !== expected) {
    safeLog('shipment mail failed via resend status=none name=order_mismatch');
    return '';
  }
  if (!stripe || typeof stripe.checkout?.sessions?.retrieve !== 'function') {
    safeLog('shipment mail failed via resend status=none name=no_session');
    return '';
  }
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    safeLog('shipment mail failed via resend status=none name=no_session');
    return '';
  }
  if (!session || session.payment_status !== 'paid') {
    safeLog('shipment mail failed via resend status=none name=unpaid');
    return '';
  }
  const email = normalizeEmail(session.customer_details?.email);
  if (!email) {
    safeLog('shipment mail failed via resend status=none name=no_recipient');
    return '';
  }
  return email;
}

export async function sendShipmentNotice({ event, env = process.env, fetchImpl = null, stripe = null }) {
  try {
    const data = event?.data && typeof event.data === 'object' ? event.data : {};
    const shipment = data.shipment && typeof data.shipment === 'object' ? data.shipment : {};
    const trackingNumber = trackingNumberOf(shipment.tracking_number ?? shipment.trackingNumber);
    if (!trackingNumber) {
      safeLog('shipment mail failed via resend status=none name=no_tracking');
      return false;
    }
    let order = normalizeOrder(data.order);
    if (!sessionIdFromPackingSlip(order.packingSlipMessage)) {
      const loaded = await loadPrintfulOrder(order.id, {
        token: env.PRINTFUL_API_TOKEN,
        storeId: env.PRINTFUL_STORE_ID,
        fetchImpl,
      });
      if (loaded) {
        order = {
          id: order.id || loaded.id,
          externalId: order.externalId || loaded.externalId,
          packingSlipMessage: order.packingSlipMessage || loaded.packingSlipMessage,
          city: order.city || loaded.city,
          state: order.state || loaded.state,
          items: order.items.length ? order.items : loaded.items,
        };
      }
    }
    const to = await customerEmailForOrder(order, { env, fetchImpl, stripe });
    if (!to) return false;
    const message = shipmentMessage({
      to,
      reference: plain(order.externalId, 32),
      items: shipmentLines(order, shipment),
      carrier: plain(shipment.carrier, 40),
      trackingNumber,
      trackingUrl: shipment.tracking_url || shipment.trackingUrl,
      city: order.city,
      state: order.state,
    });
    return await deliverCustomerMail({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      idempotencyKey: shipmentIdempotencyKey(order.id, trackingNumber),
      env,
      fetchImpl,
      label: 'shipment',
    });
  } catch {
    safeLog('shipment mail failed via resend status=none name=Error');
    return false;
  }
}
