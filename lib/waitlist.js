import { HttpError } from './http.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const WAITLIST_ADDRESS = 'hello@trimojiapparel.com';

export function normalizeWaitlistEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) {
    throw new HttpError(400, 'Enter a valid email address');
  }
  return email;
}

export function waitlistMailto(email) {
  const subject = 'Notify me when Trimoji opens';
  const body = `Please tell me when Trimoji opens.\n\nEmail: ${email}\n`;
  return `mailto:${WAITLIST_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function handleWaitlist(value, { webhookUrl = '', fetchImpl = globalThis.fetch } = {}) {
  const email = normalizeWaitlistEmail(value);
  const hook = String(webhookUrl || '').trim();
  if (hook) {
    const response = await fetchImpl(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new HttpError(502, 'Could not save that email');
    return { delivery: 'stored' };
  }
  return { delivery: 'mailto', mailto: waitlistMailto(email) };
}
