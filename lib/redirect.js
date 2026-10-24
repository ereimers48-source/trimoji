// Page requests on the previous hosts move to the apex. /api stays put so the
// Stripe webhook on trimoji.vercel.app keeps reaching this deployment.
export const REDIRECT_HOSTS = ['www.trimojiapparel.com', 'trimoji.vercel.app'];

export function pageRedirect(host, pathname) {
  const bare = String(host || '').split(':')[0].toLowerCase();
  if (!REDIRECT_HOSTS.includes(bare)) return null;
  if (pathname === '/api' || pathname.startsWith('/api/')) return null;
  if (!pathname.startsWith('/')) return null;
  return `https://trimojiapparel.com${pathname}`;
}
