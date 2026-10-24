export const CANONICAL_ORIGIN = 'https://trimojiapparel.com';

// Browsers on the custom domain, the previous Vercel host, and GitHub Pages
// may call the API. Anything else is refused.
export const ALLOWED_ORIGINS = new Set([
  CANONICAL_ORIGIN,
  'https://www.trimojiapparel.com',
  'https://trimoji.vercel.app',
  'https://ereimers48-source.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
