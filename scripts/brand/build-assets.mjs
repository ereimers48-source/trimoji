// Builds the committed brand images. Emoji art is Twemoji (CC-BY 4.0),
// the same set the builder prints. Requires Inter (OFL) on the machine
// that runs this script; the PNGs in the repo are the files the site serves.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { inlineEmoji } from '../../lib/render.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = '/usr/share/fonts/truetype/macos';
const fonts = {
  fontFiles: [
    join(FONT_DIR, 'Inter-Regular.ttf'),
    join(FONT_DIR, 'Inter-SemiBold.ttf'),
    join(FONT_DIR, 'Inter-Bold.ttf'),
  ],
  loadSystemFonts: false,
  defaultFontFamily: 'Inter',
};

const EMOJI = [
  ['1f525', 'Fire'],
  ['1f60e', 'Smiling face with sunglasses'],
  ['1f355', 'Pizza'],
];

function render(svg, width) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: fonts,
    background: '#ffffff',
    shapeRendering: 2,
    textRendering: 1,
  });
  const image = resvg.render();
  return image.asPng();
}

function shareImage() {
  const width = 1200;
  const height = 630;
  const slot = 196;
  const gap = 18;
  const emoji = slot * 0.68;
  const row = slot * 3 + gap * 2;
  const originX = (width - row) / 2;
  const originY = 132;
  const inset = (slot - emoji) / 2;
  const glyphs = EMOJI.map(([file], index) => {
    const svg = readFileSync(join(here, 'twemoji', `${file}.svg`), 'utf8');
    const left = originX + index * (slot + gap) + inset;
    const top = originY + inset;
    return inlineEmoji(svg, `s${index}`, left, top, emoji);
  }).join('');
  const frames = EMOJI.map((_, index) => {
    const x = originX + index * (slot + gap);
    return `<rect x="${x}" y="${originY}" width="${slot}" height="${slot}" rx="28" fill="#ffffff" stroke="#d2d2d7" stroke-width="2"/>`;
  }).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${frames}
  ${glyphs}
  <text x="600" y="430" text-anchor="middle" font-family="Inter" font-weight="600" font-size="64" fill="#1d1d1f" letter-spacing="-1.92">Trimoji</text>
  <text x="600" y="486" text-anchor="middle" font-family="Inter" font-weight="400" font-size="30" fill="#6e6e73" letter-spacing="-0.3">Three emojis. One you.</text>
</svg>`;
  return render(svg, width);
}

function mark(size, fontSize) {
  // Baseline sits below center by about the glyph's cap-height, so the T
  // lands on the optical middle instead of riding high.
  const y = (size / 2 + fontSize * 0.364).toFixed(2);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#ffffff"/>
  <text x="${size / 2}" y="${y}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${fontSize}" fill="#1d1d1f">T</text>
</svg>`;
  return render(svg, size);
}

function pngIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const icons = join(root, 'assets/icons');
mkdirSync(icons, { recursive: true });
writeFileSync(join(root, 'assets/og.png'), shareImage());
writeFileSync(join(icons, 'icon-32.png'), mark(32, 24));
writeFileSync(join(icons, 'icon-192.png'), mark(192, 132));
writeFileSync(join(icons, 'icon-512.png'), mark(512, 352));
writeFileSync(join(root, 'apple-touch-icon.png'), mark(180, 124));
writeFileSync(join(root, 'favicon.ico'), pngIco([
  { size: 16, png: mark(16, 12) },
  { size: 32, png: mark(32, 24) },
  { size: 48, png: mark(48, 34) },
]));
