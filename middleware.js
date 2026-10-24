import { next, rewrite } from '@vercel/functions';
import { routeRequest } from './lib/coming-soon.js';
import { comingSoonDocument, storiesDocument, storiesPublic } from './lib/stories-page.js';

export const config = {
  matcher: ['/', '/index.html', '/shop-preview', '/shop-preview/', '/stories', '/stories/', '/stories.html', '/stories-admin', '/stories-admin/', '/stories-admin.html'],
};

function htmlHeaders() {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
}

function barePath(pathname) {
  let path = pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

async function readStatic(request, pathname) {
  const fileUrl = new URL(pathname, request.url);
  fileUrl.searchParams.set('_src', '1');
  const response = await fetch(fileUrl, { headers: { accept: 'text/html' } });
  if (!response.ok) throw new Error('Missing page');
  return response.text();
}

export default async function middleware(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('_src')) return next();
  const path = barePath(url.pathname);
  if (path === '/stories' || path === '/stories.html') {
    const headers = htmlHeaders();
    if (!storiesPublic()) headers['x-robots-tag'] = 'noindex, nofollow';
    return new Response(storiesDocument(await readStatic(request, '/stories.html')), { status: 200, headers });
  }
  if (path === '/stories-admin' || path === '/stories-admin.html') {
    const headers = htmlHeaders();
    headers['x-robots-tag'] = 'noindex, nofollow';
    return new Response(await readStatic(request, '/stories-admin.html'), { status: 200, headers });
  }
  const route = routeRequest(url.pathname);
  if (route.type === 'missing') {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (route.type !== 'file') return next();
  if (route.file === 'coming-soon.html' && storiesPublic()) {
    return new Response(comingSoonDocument(await readStatic(request, '/coming-soon.html')), { status: 200, headers: htmlHeaders() });
  }
  const headers = { 'cache-control': 'no-store' };
  if (route.robots) headers['x-robots-tag'] = route.robots;
  return rewrite(new URL(`/${route.file}`, request.url), { headers });
}
