import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  [320, 640],
  [375, 812],
  [390, 844],
  [430, 932],
  [568, 320],
  [667, 375],
  [844, 390],
  [932, 430],
  [768, 1024],
  [1024, 768],
  [1280, 740],
  [1280, 800],
  [1440, 900],
];

function scan(mode) {
  const freeze = document.getElementById('overlap-freeze');
  if (!freeze) {
    const style = document.createElement('style');
    style.id = 'overlap-freeze';
    style.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
    document.head.appendChild(style);
  }
  const issues = [];
  function hidden(el) {
    if (el.closest('.skip, .sr, #fx, #toast')) return true;
    if (mode !== 'drawer' && el.closest('#drawer')) return true;
    if (el.closest('[hidden]')) return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }
  function clip(el, rect) {
    let r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const ox = cs.overflowX;
      const oy = cs.overflowY;
      const clips = ['auto', 'scroll', 'hidden', 'clip'].includes(ox) || ['auto', 'scroll', 'hidden', 'clip'].includes(oy);
      if (clips) {
        const b = p.getBoundingClientRect();
        const left = Math.max(r.left, b.left);
        const top = Math.max(r.top, b.top);
        const right = Math.min(r.right, b.right);
        const bottom = Math.min(r.bottom, b.bottom);
        if (right - left < 1 || bottom - top < 1) return null;
        r = { left, top, right, bottom };
      }
      p = p.parentElement;
    }
    return r;
  }
  function hit(a, b) {
    const iw = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const ih = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (iw <= 2 || ih <= 2) return false;
    const aMid = (a.top + a.bottom) / 2;
    const bMid = (b.top + b.bottom) / 2;
    const sameLine = Math.abs(a.top - b.top) < 3 && Math.abs(aMid - bMid) < Math.min(a.bottom - a.top, b.bottom - b.top) * 0.6;
    if (!sameLine) return true;
    const aHoldsB = a.left <= b.left + 1 && a.right >= b.right - 1;
    const bHoldsA = b.left <= a.left + 1 && a.right <= b.right + 1;
    return !(aHoldsB || bHoldsA);
  }
  const nodes = [];
  const root = mode === 'drawer' ? document.getElementById('drawer') : document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || hidden(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const r = clip(el, rect);
      if (!r || r.right - r.left < 2 || r.bottom - r.top < 2) continue;
      nodes.push({ text: text.slice(0, 48), el, r });
    }
  }
  const bar = document.querySelector('.topbar');
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i];
      const B = nodes[j];
      if (!hit(A.r, B.r)) continue;
      const aBar = bar && bar.contains(A.el);
      const bBar = bar && bar.contains(B.el);
      if ((aBar || bBar) && window.scrollY > 4) continue;
      issues.push(`"${A.text}" overlaps "${B.text}"`);
    }
  }
  if (mode !== 'drawer') {
    const h1 = document.querySelector('.hero h1');
    const lines = document.createRange();
    lines.selectNodeContents(h1);
    const boxes = [...lines.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (hit(boxes[i], boxes[j])) issues.push('headline lines overlap');
      }
    }
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 2) {
      issues.push(`page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`);
    }
    for (const node of nodes) {
      if (node.el.closest('#showtrack, .grid')) continue;
      if (node.r.bottom < 0 || node.r.top > window.innerHeight) continue;
      if (node.r.left < -2 || node.r.right > vw + 2) issues.push(`"${node.text}" runs outside the window`);
    }
    document.querySelectorAll('.floats img').forEach((img) => {
      if (getComputedStyle(img).display === 'none') return;
      const r = img.getBoundingClientRect();
      for (const node of nodes) {
        if (hit(r, node.r)) issues.push(`floating emoji overlaps "${node.text}"`);
      }
    });
    const art = document.getElementById('heroart').getBoundingClientRect();
    for (const node of nodes) {
      if (node.el.closest('#heroart, .topbar')) continue;
      if (node.r.bottom < 0 || node.r.top > window.innerHeight) continue;
      if (hit(art, node.r)) issues.push(`sticker overlaps "${node.text}"`);
    }
  }
  return [...new Set(issues)].slice(0, 20);
}

test('text stays apart across phone, tablet, and desktop widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one viewport sweep covers every width');
  await page.goto('/');
  await expect(page.locator('#heroart img').first()).toBeVisible();
  await page.evaluate(() => {
    document.getElementById('testmode').hidden = false;
    fitBar();
  });
  await page.locator('#addbtn').click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await page.locator('#closecart').click();
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await page.evaluate(() => {
    document.getElementById('toast').style.display = 'none';
    window.scrollTo(0, 0);
  });

  const problems = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const font of [16, 24]) {
      await page.evaluate(async (px) => {
        document.documentElement.style.fontSize = `${px}px`;
        document.getElementById('testmode').hidden = false;
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
        if (document.activeElement) document.activeElement.blur();
        window.scrollTo(0, 0);
        fitBar();
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, font);
      const found = await page.evaluate(scan, 'page');
      for (const item of found) problems.push(`${width}x${height} ${font}px: ${item}`);
      if (width <= 430 && height > width) {
        await page.evaluate(async () => {
          document.getElementById('cartbtn').click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const cart = await page.evaluate(scan, 'drawer');
        await page.evaluate(() => {
          document.getElementById('closecart').click();
          window.scrollTo(0, 0);
        });
        for (const item of cart) problems.push(`${width}x${height} ${font}px cart: ${item}`);
      }
    }
  }

  const anchors = ['#showcase h2', '#ideas-title', '#builder h2', '.close h2'];
  for (const [width, height] of [[320, 640], [390, 844], [844, 390], [768, 1024], [1280, 740], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const font of [16, 24]) {
      for (const sel of anchors) {
        const placed = await page.evaluate(async ({ px, sel }) => {
          document.documentElement.style.fontSize = `${px}px`;
          document.getElementById('testmode').hidden = false;
          document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
          fitBar();
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          document.querySelector(sel).scrollIntoView({ block: 'start' });
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          const heading = document.querySelector(sel).getBoundingClientRect();
          return { top: Math.round(heading.top), bar: Math.round(bar.bottom), text: document.querySelector(sel).textContent.trim() };
        }, { px: font, sel });
        if (placed.top < placed.bar - 2) {
          problems.push(`${width}x${height} ${font}px: "${placed.text}" starts at ${placed.top} under the bar ending at ${placed.bar}`);
        }
      }
    }
  }

  expect(problems, problems.join('\n')).toEqual([]);
});
