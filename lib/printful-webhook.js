import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, safeLog } from './http.js';
import { sendShipmentNotice } from './order-mail.js';

export function secretFromUrl(url) {
  try {
    return new URL(url).searchParams.get('secret');
  } catch {
    return null;
  }
}

export function webhookSecretMatches(given, expected) {
  const presented = typeof given === 'string' ? given : '';
  const configured = typeof expected === 'string' ? expected.trim() : '';
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(configured).digest();
  const equal = timingSafeEqual(left, right);
  return configured.length > 0 && equal;
}

function safeOrderId(order) {
  const id = order && order.id != null ? String(order.id) : '';
  return /^[0-9]{1,20}$/.test(id) ? id : 'unknown';
}

export async function handlePrintfulWebhook({ url, rawBody, readBody, env = process.env, fetchImpl = null, stripe = null }) {
  if (!webhookSecretMatches(secretFromUrl(url), env && env.PRINTFUL_WEBHOOK_SECRET)) {
    throw new HttpError(401, 'Unauthorized');
  }
  const body = typeof rawBody === 'string' ? rawBody : await readBody();
  let event;
  try {
    event = JSON.parse(body || '');
  } catch {
    return { received: true, ignored: true };
  }
  const type = event && typeof event.type === 'string' ? event.type : '';
  if (type === 'order_failed' || type === 'order_canceled') {
    const id = safeOrderId(event.data && event.data.order);
    safeLog(`printful webhook ${type} id=${id}`);
    return { received: true, emailed: false };
  }
  if (type !== 'package_shipped') return { received: true, ignored: true };
  const emailed = await sendShipmentNotice({ event, env, fetchImpl, stripe });
  return { received: true, emailed: Boolean(emailed) };
}
