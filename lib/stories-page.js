const ROBOTS_META = '<meta name="robots" content="noindex, nofollow" data-stories-robots>';
const STORIES_LINK = '<a href="/stories">Stories</a>';

export function storiesPublic(env = process.env) {
  const raw = env?.STORIES_PUBLIC;
  if (raw == null || String(raw).trim() === '') return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

export function storiesNavDocument(html, env = process.env) {
  return html.replace(/<nav aria-label="Policies">[\s\S]*?<\/nav>/g, (nav) => {
    const without = nav.replace(STORIES_LINK, '');
    if (!storiesPublic(env) || without.includes('href="/stories"')) return without;
    if (without.includes('<a href="/account">Account</a>')) {
      return without.replace('<a href="/account">Account</a>', `${STORIES_LINK}<a href="/account">Account</a>`);
    }
    return without.replace('</nav>', `${STORIES_LINK}</nav>`);
  });
}

export function storiesDocument(html, env = process.env) {
  let out = html;
  if (!storiesPublic(env)) {
    if (!out.includes('data-stories-robots')) out = out.replace('</head>', `${ROBOTS_META}\n</head>`);
    if (!out.includes('data-stories-gated')) out = out.replace('id="empty"', 'id="empty" hidden data-stories-gated');
  } else {
    out = out.replace(`\n${ROBOTS_META}`, '').replace(ROBOTS_META, '');
    out = out.replace(' hidden data-stories-gated', '');
  }
  return storiesNavDocument(out, env);
}

export function comingSoonDocument(html, env = process.env) {
  return storiesNavDocument(html, env);
}
