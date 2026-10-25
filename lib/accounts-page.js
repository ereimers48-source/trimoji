import { comingSoonEnabled } from './coming-soon.js';

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow" data-account-robots>';

export function accountsPublic(env = process.env) {
  const raw = env?.ACCOUNTS_PUBLIC;
  if (raw == null || String(raw).trim() === '') return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

export function accountShopPath(env = process.env) {
  return comingSoonEnabled(env) ? '/shop-preview' : '/';
}

export function accountDocument(html, env = process.env) {
  let out = html;
  if (accountsPublic(env)) out = out.replace(`\n${ROBOTS_META}`, '').replace(ROBOTS_META, '');
  else if (!out.includes('data-account-robots')) out = out.replace('</head>', `${ROBOTS_META}\n</head>`);
  const shop = accountShopPath(env);
  out = out.replace('data-shop="/shop-preview"', `data-shop="${shop}"`);
  out = out.replaceAll('href="/shop-preview"', `href="${shop === '/' ? '/' : shop}"`);
  return out;
}

export function comingSoonAccountDocument(html, env = process.env) {
  if (!accountsPublic(env) || html.includes('href="/account"')) return html;
  return html.replace(
    /(<nav aria-label="Policies">[\s\S]*?)<\/nav>/,
    '$1<a href="/account">Account</a></nav>',
  );
}
