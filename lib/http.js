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
