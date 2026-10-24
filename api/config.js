import { publicConfig } from '../lib/config.js';
import { preflight, withCors } from '../lib/http.js';

export function OPTIONS(request) {
  return preflight(request);
}

export function GET(request) {
  return withCors(request, Response.json(publicConfig(process.env), {
    headers: { 'Cache-Control': 'no-store' },
  }));
}
