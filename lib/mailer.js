import { createHash } from 'node:crypto';
import { createTransport } from 'nodemailer';
import { escapeHtml, SEND_FAILURE } from './accounts.js';
import { HttpError, safeLog } from './http.js';
import { runtime } from './runtime.js';

const DEFAULT_FROM = 'Trimoji <hello@trimojiapparel.com>';
const REPLY_TO = 'hello@trimojiapparel.com';
const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

export function smtpConfig(env = process.env) {
  const host = typeof env.SMTP_HOST === 'string' ? env.SMTP_HOST.trim() : '';
  const user = typeof env.SMTP_USER === 'string' ? env.SMTP_USER.trim() : '';
  const pass = typeof env.SMTP_PASS === 'string' ? env.SMTP_PASS : '';
  const from = fromHeader(env.SMTP_FROM);
  const port = Number(env.SMTP_PORT);
  if (!host || !user || !pass || !from) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, user, pass, from };
}

export function fromHeader(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 200 || /[\r\n]/.test(raw)) return '';
  if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(raw)) return `Trimoji <${raw}>`;
  if (/^[^<>\r\n]{1,80}<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(raw)) return raw;
  return '';
}

export function signInMessage({ to, link, from }) {
  const safeLink = escapeHtml(link);
  const text = [
    'Sign in to Trimoji',
    '',
    'Use this link to open your account. It works once and expires in 15 minutes.',
    '',
    link,
    '',
    'If you did not ask for this, you can ignore the email.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Trimoji</title></head>
<body style="margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px">
        <tr><td style="padding:32px 28px">
          <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.03em">Trimoji</p>
          <h1 style="margin:18px 0 0;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-.03em">Sign in</h1>
          <p style="margin:14px 0 0;color:#6e6e73;font-size:17px;line-height:1.45">Use this link to open your account. It works once and expires in 15 minutes.</p>
          <p style="margin:22px 0 0"><a href="${safeLink}" style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;border-radius:980px;padding:12px 22px;font-size:17px;font-weight:500">Sign in to Trimoji</a></p>
          <p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45;word-break:break-all">${safeLink}</p>
          <p style="margin:18px 0 0;color:#6e6e73;font-size:13px;line-height:1.45">If you did not ask for this, you can ignore the email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return {
    from,
    to,
    subject: 'Sign in to Trimoji',
    text,
    html,
  };
}

function resendApiKey(env) {
  const key = env && typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  if (!key || key.length > 200 || /[\r\n\0]/.test(key)) return '';
  return key;
}

export function hasResendApiKey(env = process.env) {
  return Boolean(resendApiKey(env));
}

function logToken(value) {
  const text = String(value ?? '');
  if (text.includes('re_') || !/^[A-Za-z0-9_.:-]{1,64}$/.test(text)) return 'unknown';
  return text;
}

function logMailFailure(via, fields) {
  const detail = Object.entries(fields)
    .map(([key, value]) => `${key}=${logToken(value)}`)
    .join(' ');
  safeLog(`sign-in mail failed via ${via} ${detail}`);
}

async function resendErrorName(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.name === 'string') return payload.name;
  } catch {
    // The response body is not logged.
  }
  return 'Error';
}

async function deliverWithResend(message, key, link) {
  const fetchImpl = typeof runtime.fetch === 'function' ? runtime.fetch : globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `sign-in/${createHash('sha256').update(String(link)).digest('hex')}`,
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: REPLY_TO,
      }),
    });
  } catch (err) {
    logMailFailure('resend', {
      status: 'none',
      name: err && err.name,
      code: err && err.code,
    });
    throw new HttpError(503, SEND_FAILURE);
  }
  if (!response.ok) {
    logMailFailure('resend', { status: response.status, name: await resendErrorName(response) });
    throw new HttpError(503, SEND_FAILURE);
  }
}

export async function deliverSignIn({ to, link, env = process.env, mailer = null }) {
  const key = mailer ? '' : resendApiKey(env);
  if (key) {
    const from = fromHeader(env.SMTP_FROM) || DEFAULT_FROM;
    const message = signInMessage({ to, link, from });
    await deliverWithResend(message, key, link);
    return;
  }
  const config = smtpConfig(env);
  const from = mailer ? (fromHeader(env.SMTP_FROM) || DEFAULT_FROM) : config?.from;
  if (!from) throw new HttpError(503, SEND_FAILURE);
  const message = signInMessage({ to, link, from });
  if (mailer) {
    try {
      await mailer.send(message);
    } catch {
      throw new HttpError(503, SEND_FAILURE);
    }
    return;
  }
  if (!config) throw new HttpError(503, SEND_FAILURE);
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  try {
    await transport.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (err) {
    logMailFailure('smtp', { name: err && err.name, code: err && (err.code || err.responseCode) });
    throw new HttpError(503, SEND_FAILURE);
  }
}
