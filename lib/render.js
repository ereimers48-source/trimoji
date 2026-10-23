import { Resvg } from '@resvg/resvg-js';
import { HttpError } from './http.js';
import { runtime } from './runtime.js';

export const PRINT_PX = 1800;
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/';

export function twemojiUrl(emoji) {
  let value = emoji;
  if (!value.includes('\u200d')) value = value.replace(/\uFE0F/g, '');
  const file = `${Array.from(value).map((char) => char.codePointAt(0).toString(16)).join('-')}.svg`;
  if (!/^[0-9a-f-]+\.svg$/.test(file)) throw new HttpError(400, 'Invalid emoji');
  return TWEMOJI + file;
}

function namespaceIds(fragment, prefix) {
  return fragment
    .replace(/\bid=(['"])(.*?)\1/g, (_, quote, id) => `id=${quote}${prefix}${id}${quote}`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replace(/(href|xlink:href)=(['"])#([^'"]+)\2/g, (_, attr, quote, id) => `${attr}=${quote}#${prefix}${id}${quote}`);
}

export function inlineEmoji(svgText, prefix, x, y, size) {
  const svg = svgText.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/g, '').trim();
  const viewBox = svg.match(/viewBox=(['"])([^'"]+)\1/);
  const parts = (viewBox ? viewBox[2] : '0 0 36 36').trim().split(/[\s,]+/).map(Number);
  const width = parts[2] || 36;
  const height = parts[3] || 36;
  const scale = size / width;
  const inner = namespaceIds(svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''), prefix);
  const yAdjust = y + (size - size * (height / width)) / 2;
  return `<g transform="translate(${x} ${yAdjust}) scale(${scale})">${inner}</g>`;
}

function placements(design) {
  const count = design.emojis.length;
  const glyph = 560 * (design.logoSize / 100);
  const cx = PRINT_PX / 2;
  const cy = PRINT_PX / 2;
  let pos;
  if (design.layout === 'row') {
    pos = design.emojis.map((_, index) => [cx + (index - (count - 1) / 2) * glyph * 1.05, cy]);
  } else if (design.layout === 'stacked') {
    pos = design.emojis.map((_, index) => [cx, cy + (index - (count - 1) / 2) * glyph * 1.05]);
  } else {
    pos = [
      [cx, cy - glyph * 0.48],
      [cx - glyph * 0.55, cy + glyph * 0.45],
      [cx + glyph * 0.55, cy + glyph * 0.45],
    ].slice(0, count);
  }
  const radius = design.layout === 'triangle' ? glyph * 1.25 : glyph * (count * 0.55 + 0.15);
  return { pos, glyph, cx, cy, radius };
}

export function composeSvg(design, svgTexts) {
  const { pos, glyph, cx, cy, radius } = placements(design);
  const background = design.background.shape === 'circle'
    ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${design.background.color}"/>`
    : '';
  const glyphs = svgTexts.map((text, index) => inlineEmoji(
    text,
    `e${index}_`,
    pos[index][0] - glyph / 2,
    pos[index][1] - glyph / 2,
    glyph,
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PRINT_PX}" height="${PRINT_PX}" viewBox="0 0 ${PRINT_PX} ${PRINT_PX}">${background}${glyphs}</svg>`;
}

async function fetchSvg(url) {
  const response = await runtime.fetch(url);
  if (!response.ok) throw new HttpError(400, 'Could not load an emoji graphic');
  const text = await response.text();
  if (!text.includes('<svg')) throw new HttpError(400, 'Emoji graphic was not SVG');
  return text;
}

export async function renderLogoPng(design, fetchSvgImpl = fetchSvg) {
  const svgTexts = await Promise.all(design.emojis.map((emoji) => fetchSvgImpl(twemojiUrl(emoji))));
  const svg = composeSvg(design, svgTexts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: PRINT_PX },
    background: 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
}
