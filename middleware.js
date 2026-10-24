import { next, rewrite } from '@vercel/functions';
import { routeRequest } from './lib/coming-soon.js';

export const config = {
  matcher: ['/', '/index.html', '/shop-preview', '/shop-preview/'],
};

export default function middleware(request) {
  const url = new URL(request.url);
  const route = routeRequest(url.pathname);
  if (route.type === 'missing') {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (route.type !== 'file') return next();
  const headers = { 'cache-control': 'no-store' };
  if (route.robots) headers['x-robots-tag'] = route.robots;
  return rewrite(new URL(`/${route.file}`, request.url), { headers });
}
