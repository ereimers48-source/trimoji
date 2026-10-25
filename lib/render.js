import { crc32 } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { HttpError } from './http.js';
import { runtime } from './runtime.js';

export const PRINT_PX = 1800;
// Yupoong 6006 DTF front: 5.5 in × 2.5 in at 300 DPI.
export const HAT_PRINT_W = 1650;
export const HAT_PRINT_H = 750;
// Tough Case print file. The same 1392×2220 image is used for every iPhone model.
export const CASE_PRINT_W = 1392;
export const CASE_PRINT_H = 2220;
// Share of the print file kept clear for the camera. This inset is a guess.
export const CASE_CAMERA_TOP = 0.28;
// Keep the artwork off the rounded bottom edge of the case.
export const CASE_BOTTOM_INSET = 0.16;
// Preferred center for a short logo. Tall layouts are shifted to stay in the safe band.
export const CASE_LOGO_CENTER = 0.48;
// Kiss-cut sticker sheet printfile 256. 5.83×8.27 in at 300 DPI, fill mode fit.
export const STICKER_PRINT_W = 1750;
export const STICKER_PRINT_H = 2482;
export const STICKER_MARGIN = 150;
export const STICKER_GAP = 50;
export const STICKER_COLS = 3;
export const STICKER_ROWS = 5;
export const STICKER_RADIUS = 110;
export const STICKER_BORDER = 8;
export const STICKER_TINT = '#FFF4E1';
export const STICKER_OUTLINE = '#DEDEE4';
const PRINT_DPI = 300;
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
  if (design.product === 'case') return { width: CASE_PRINT_W, height: CASE_PRINT_H };
  if (design.product === 'sticker') return { width: STICKER_PRINT_W, height: STICKER_PRINT_H };
  return { width: PRINT_PX, height: PRINT_PX };
}

export function stickerLayout() {
  const width = STICKER_PRINT_W;
  const height = STICKER_PRINT_H;
  const { margin, gap, cols, rows } = {
    margin: STICKER_MARGIN,
    gap: STICKER_GAP,
    cols: STICKER_COLS,
    rows: STICKER_ROWS,
  };
  const bw = Math.floor((width - 2 * margin - (cols - 1) * gap) / cols);
  const bh = Math.floor((height - 2 * margin - (rows - 1) * gap) / rows);
  const gw = cols * bw + (cols - 1) * gap;
  const gh = rows * bh + (rows - 1) * gap;
  const x0 = Math.floor((width - gw) / 2);
  const y0 = Math.floor((height - gh) / 2);
  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push({
        x: x0 + col * (bw + gap),
        y: y0 + row * (bh + gap),
        w: bw,
        h: bh,
      });
    }
  }
  const glyph = Math.round(Math.min(bw, bh) * 0.385);
  return { width, height, margin, gap, cols, rows, bw, bh, x0, y0, tiles, glyph };
}

export function stickerGlyphCenters(bw, bh) {
  const cx = bw / 2;
  const cy = bh / 2;
  return [
    [cx, cy - bh * 0.215],
    [cx - bw * 0.215, cy + bh * 0.175],
    [cx + bw * 0.215, cy + bh * 0.175],
  ];
}

function stickerTile(design, svgTexts, bw, bh, tileIndex) {
  const glyph = Math.round(Math.min(bw, bh) * 0.385);
  const centers = stickerGlyphCenters(bw, bh);
  let drawn = 0;
  const glyphs = design.emojis.map((emoji, index) => {
    if (!emoji) return '';
    const text = svgTexts[drawn];
    drawn += 1;
    const [cx, cy] = centers[index];
    return inlineEmoji(text, `t${tileIndex}e${index}_`, cx - glyph / 2, cy - glyph / 2, glyph);
  }).join('');
  const inset = STICKER_BORDER;
  const radius = STICKER_RADIUS;
  // Outer rounded rect is the kiss-cut line. The inset rect is the tile fill.
  // Resvg anti-aliases these vectors at the print size, in place of a 2× raster downsample.
  return `<rect width="${bw}" height="${bh}" rx="${radius}" ry="${radius}" fill="${STICKER_OUTLINE}"/><rect x="${inset}" y="${inset}" width="${bw - inset * 2}" height="${bh - inset * 2}" rx="${radius - inset}" ry="${radius - inset}" fill="${STICKER_TINT}"/>${glyphs}`;
}

export function composeStickerSvg(design, svgTexts) {
  const layout = stickerLayout();
  const tiles = layout.tiles.map((tile, index) => (
    `<g transform="translate(${tile.x} ${tile.y})">${stickerTile(design, svgTexts, layout.bw, layout.bh, index)}</g>`
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">${tiles}</svg>`;
}

function layoutSpan(layout, count, glyph) {
  if (layout === 'row') return { w: glyph * (1 + (count - 1) * 1.05), h: glyph };
  if (layout === 'stacked') return { w: glyph, h: glyph * (1 + (count - 1) * 1.05) };
  return { w: glyph * 2.1, h: glyph * 1.93 };
}

function placements(design, canvas) {
  // Three fixed positions. An empty slot stays blank instead of closing the gap.
  const fitted = 3;
  let boxW = canvas.width;
  let boxH = canvas.height;
  let cx = canvas.width / 2;
  let cy = canvas.height / 2;
  let glyph = 560 * (design.logoSize / 100);
  let fit = 0.97;
  if (design.product === 'case') {
    // Keep the trio below the camera island and above the rounded bottom.
    const top = canvas.height * CASE_CAMERA_TOP;
    const limit = canvas.height * (1 - CASE_BOTTOM_INSET);
    boxH = limit - top;
    cy = canvas.height * CASE_LOGO_CENTER;
    const unit = layoutSpan(design.layout, fitted, 1);
    const full = Math.min(boxW / unit.w, boxH / unit.h);
    glyph = full * 0.88 * (design.logoSize / 100);
    fit = 0.93;
  } else if (canvas.width !== PRINT_PX || canvas.height !== PRINT_PX) {
    // Yupoong 6006 front DTF is 5.5×2.5 in. 100% fills most of that area.
    // Larger slider values stop at 93% so a glyph never meets the cut line.
    const unit = layoutSpan(design.layout, fitted, 1);
    const full = Math.min(canvas.width / unit.w, canvas.height / unit.h);
    glyph = full * 0.88 * (design.logoSize / 100);
    fit = 0.93;
  }
  const span = layoutSpan(design.layout, fitted, glyph);
  glyph *= Math.min((boxW * fit) / span.w, (boxH * fit) / span.h, 1);
  let pos;
  if (design.layout === 'row') {
    pos = [0, 1, 2].map((index) => [cx + (index - 1) * glyph * 1.05, cy]);
  } else if (design.layout === 'stacked') {
    pos = [0, 1, 2].map((index) => [cx, cy + (index - 1) * glyph * 1.05]);
  } else {
    pos = [
      [cx, cy - glyph * 0.48],
      [cx - glyph * 0.55, cy + glyph * 0.45],
      [cx + glyph * 0.55, cy + glyph * 0.45],
    ];
  }
  if (design.product === 'case') {
    const top = canvas.height * CASE_CAMERA_TOP;
    const limit = canvas.height * (1 - CASE_BOTTOM_INSET);
    const minY = Math.min(...pos.map((point) => point[1])) - glyph / 2;
    const maxY = Math.max(...pos.map((point) => point[1])) + glyph / 2;
    let shift = 0;
    if (minY < top) shift = top - minY;
    if (maxY + shift > limit) shift -= maxY + shift - limit;
    if (shift) pos = pos.map(([x, y]) => [x, y + shift]);
  }
  return { pos, glyph };
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
  if (design.product === 'sticker') return composeStickerSvg(design, svgTexts);
  const canvas = printCanvas(design);
  const { pos, glyph } = placements(design, canvas);
  let drawn = 0;
  const glyphs = design.emojis.map((emoji, index) => {
    if (!emoji) return '';
    const text = svgTexts[drawn];
    drawn += 1;
    return inlineEmoji(
      text,
      `e${index}_`,
      pos[index][0] - glyph / 2,
      pos[index][1] - glyph / 2,
      glyph,
    );
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">${glyphs}</svg>`;
}

async function fetchSvg(url) {
  const response = await runtime.fetch(url);
  if (!response.ok) throw new HttpError(400, 'Could not load an emoji graphic');
  const text = await response.text();
  if (!text.includes('<svg')) throw new HttpError(400, 'Emoji graphic was not SVG');
  return text;
}

export async function renderLogoPng(design, fetchSvgImpl = fetchSvg) {
  const svgTexts = await Promise.all(design.emojis.filter(Boolean).map((emoji) => fetchSvgImpl(twemojiUrl(emoji))));
  const canvas = printCanvas(design);
  const svg = composeSvg(design, svgTexts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: canvas.width },
    background: 'rgba(0,0,0,0)',
  });
  const png = Buffer.from(resvg.render().asPng());
  return design.product === 'hat' || design.product === 'case' || design.product === 'sticker'
    ? pngWithDpi(png, PRINT_DPI)
    : png;
}
