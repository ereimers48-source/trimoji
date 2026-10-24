const ROBOTS_META = '<meta name="robots" content="noindex, nofollow" data-stories-robots>';

export function storiesPublic(env = process.env) {
  const raw = env?.STORIES_PUBLIC;
  if (raw == null || String(raw).trim() === '') return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

export function storiesDocument(html, env = process.env) {
  if (!storiesPublic(env)) {
    if (html.includes('data-stories-robots')) return html;
    return html.replace('</head>', `${ROBOTS_META}\n</head>`);
  }
  return html.replace(`\n${ROBOTS_META}`, '').replace(ROBOTS_META, '');
}

export function comingSoonDocument(html, env = process.env) {
  if (!storiesPublic(env) || html.includes('href="/stories"')) return html;
  return html.replace(
    '<a href="/contact">Contact</a></nav>',
    '<a href="/contact">Contact</a><a href="/stories">Stories</a></nav>',
  );
}
