import { crc32 } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { HttpError } from './http.js';
import { runtime } from './runtime.js';

export const PRINT_PX = 1800;
// Yupoong 6006 DTF front: 5.5 in × 2.5 in at 300 DPI.
export const HAT_PRINT_W = 1650;
export const HAT_PRINT_H = 750;
const HAT_DPI = 300;
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

export function printCanvas(design) {
  if (design.product === 'hat') return { width: HAT_PRINT_W, height: HAT_PRINT_H };
  return { width: PRINT_PX, height: PRINT_PX };
}

function layoutSpan(layout, count, glyph) {
  if (layout === 'row') return { w: glyph * (1 + (count - 1) * 1.05), h: glyph };
  if (layout === 'stacked') return { w: glyph, h: glyph * (1 + (count - 1) * 1.05) };
  return { w: glyph * 2.1, h: glyph * 1.93 };
}

function placements(design, canvas) {
  const count = design.emojis.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const fitted = Math.max(count, 1);
  let glyph = 560 * (design.logoSize / 100);
  if (canvas.width !== PRINT_PX || canvas.height !== PRINT_PX) {
    // Yupoong 6006 front DTF is 5.5×2.5 in. At 100% the artwork fills most of
    // that area (about 92%) and stays centered. The size slider shrinks from
    // there and can grow a little more before it stops short of the edge.
    const unit = layoutSpan(design.layout, fitted, 1);
    const full = Math.min(canvas.width / unit.w, canvas.height / unit.h);
    glyph = full * 0.92 * (design.logoSize / 100);
  }
  const span = layoutSpan(design.layout, fitted, glyph);
  glyph *= Math.min((canvas.width * 0.97) / span.w, (canvas.height * 0.97) / span.h, 1);
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
  let radius = design.layout === 'triangle' ? glyph * 1.25 : glyph * (count * 0.55 + 0.15);
  radius = Math.min(radius, cx - 24, cy - 24);
  return { pos, glyph, cx, cy, radius };
}

function pngWithDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data[8] = 1;
  const type = Buffer.from('pHYs');
  const crc = crc32(Buffer.concat([type, data])) >>> 0;
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc, 17);
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

export function composeSvg(design, svgTexts) {
  const canvas = printCanvas(design);
  const { pos, glyph, cx, cy, radius } = placements(design, canvas);
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">${background}${glyphs}</svg>`;
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
  const canvas = printCanvas(design);
  const svg = composeSvg(design, svgTexts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: canvas.width },
    background: 'rgba(0,0,0,0)',
  });
  const png = Buffer.from(resvg.render().asPng());
  return design.product === 'hat' ? pngWithDpi(png, HAT_DPI) : png;
}
