// Unset COMING_SOON means the public site is the coming-soon page.
// Set COMING_SOON=false and redeploy to open the shop at /.
export const SHOP_PREVIEW_PATH = '/shop-preview';

export function comingSoonEnabled(env = process.env) {
  const raw = env?.COMING_SOON;
  if (raw == null || String(raw).trim() === '') return true;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

export function routeRequest(pathname, env = process.env) {
  let path = pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const soon = comingSoonEnabled(env);
  if (path === SHOP_PREVIEW_PATH) {
    if (!soon) return { type: 'missing' };
    return { type: 'file', file: 'index.html', robots: 'noindex, nofollow' };
  }
  if (soon && (path === '/' || path === '/index.html')) {
    return { type: 'file', file: 'coming-soon.html', robots: null };
  }
  return { type: 'static' };
}
