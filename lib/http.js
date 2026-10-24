import { ALLOWED_ORIGINS } from './site.js';

export function corsHeaders(request) {
  const origin = request?.headers?.get?.('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, accept, stripe-signature',
    Vary: 'Origin',
  };
}

export function withCors(request, response) {
  const headers = corsHeaders(request);
  if (!headers) return response;
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export function preflight(request) {
  const headers = corsHeaders(request);
  if (!headers) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function jsonError(err) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : 'Something went wrong';
  return Response.json({ error: message }, { status });
}

export function safeLog(err) {
  const message = String(err && err.message ? err.message : err)
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_$1_[redacted]')
    .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_[redacted]');
  console.error(message);
}
