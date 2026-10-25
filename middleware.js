import { next } from '@vercel/functions';
import { accountDocument, accountsPublic, comingSoonAccountDocument } from './lib/accounts-page.js';
import { routeRequest } from './lib/coming-soon.js';
import { comingSoonDocument, storiesDocument, storiesNavDocument, storiesPublic } from './lib/stories-page.js';

export const config = {
  matcher: [
    '/',
    '/index.html',
    '/shop-preview',
    '/shop-preview/',
    '/coming-soon.html',
    '/stories',
    '/stories/',
    '/stories.html',
    '/stories-admin',
    '/stories-admin/',
    '/stories-admin.html',
    '/account',
    '/account/',
    '/account.html',
    '/privacy',
    '/privacy.html',
    '/terms',
    '/terms.html',
    '/shipping',
    '/shipping.html',
    '/returns',
    '/returns.html',
    '/contact',
    '/contact.html',
    '/about',
    '/about.html',
    '/success.html',
    '/cancel.html',
  ],
};

const STATIC_HTML = {
  '/coming-soon.html': '/coming-soon.html',
  '/privacy': '/privacy.html',
  '/privacy.html': '/privacy.html',
  '/terms': '/terms.html',
  '/terms.html': '/terms.html',
  '/shipping': '/shipping.html',
  '/shipping.html': '/shipping.html',
  '/returns': '/returns.html',
  '/returns.html': '/returns.html',
  '/contact': '/contact.html',
  '/contact.html': '/contact.html',
  '/about': '/about.html',
  '/about.html': '/about.html',
  '/success.html': '/success.html',
  '/cancel.html': '/cancel.html',
};

function htmlHeaders(extra = {}) {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra };
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

function decorate(file, html) {
  if (file === '/stories.html') return storiesDocument(html);
  let out = storiesNavDocument(html);
  if (file === '/account.html') out = accountDocument(out);
  if (file === '/coming-soon.html') out = comingSoonAccountDocument(comingSoonDocument(out));
  return out;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('_src')) return next();
  const path = barePath(url.pathname);

  if (path === '/stories' || path === '/stories.html') {
    const headers = htmlHeaders();
    if (!storiesPublic()) headers['x-robots-tag'] = 'noindex, nofollow';
    const html = decorate('/stories.html', await readStatic(request, '/stories.html'));
    return new Response(html, { status: 200, headers });
  }
  if (path === '/stories-admin' || path === '/stories-admin.html') {
    const headers = htmlHeaders({ 'x-robots-tag': 'noindex, nofollow' });
    const html = decorate('/stories-admin.html', await readStatic(request, '/stories-admin.html'));
    return new Response(html, { status: 200, headers });
  }
  if (path === '/account' || path === '/account.html') {
    const headers = htmlHeaders();
    if (!accountsPublic()) headers['x-robots-tag'] = 'noindex, nofollow';
    const html = decorate('/account.html', await readStatic(request, '/account.html'));
    return new Response(html, { status: 200, headers });
  }
  const staticFile = STATIC_HTML[path];
  if (staticFile) {
    const html = decorate(staticFile, await readStatic(request, staticFile));
    return new Response(html, { status: 200, headers: htmlHeaders() });
  }

  const route = routeRequest(url.pathname);
  if (route.type === 'missing') {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (route.type === 'static' && (path === '/' || path === '/index.html')) {
    const html = decorate('/index.html', await readStatic(request, '/index.html'));
    return new Response(html, { status: 200, headers: htmlHeaders() });
  }
  if (route.type !== 'file') return next();

  const headers = htmlHeaders();
  let html = decorate(`/${route.file}`, await readStatic(request, `/${route.file}`));
  if (route.robots) {
    headers['x-robots-tag'] = route.robots;
    html = html.replace('</head>', `<meta name="robots" content="${route.robots}">\n</head>`);
  }
  return new Response(html, { status: 200, headers });
}
