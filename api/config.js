import { publicConfig } from '../lib/config.js';

export function GET() {
  return Response.json(publicConfig(process.env), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
