import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  [320, 640],
  [375, 667],
  [375, 812],
  [390, 844],
  [430, 932],
  [568, 320],
  [667, 375],
  [844, 390],
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
    if (el.closest('.skip, .sr, #toast')) return true;
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
      if (node.el.closest('.grid')) continue;
      if (node.r.bottom < 0 || node.r.top > window.innerHeight) continue;
      if (node.r.left < -2 || node.r.right > vw + 2) issues.push(`"${node.text}" runs outside the window`);
    }
  }
  return [...new Set(issues)].slice(0, 20);
}

test('text stays apart across phone, tablet, and desktop widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one viewport sweep covers every width');
  await page.goto('/shop-preview');
  await expect(page.locator('#mock image').first()).toBeVisible();
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
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
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
      const dockFixed = await page.evaluate(() => getComputedStyle(document.getElementById('dock')).position === 'fixed');
      if (dockFixed) problems.push(`${width}x${height} ${font}px: buy dock is fixed over the top of the page`);
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

  const anchors = ['.hero h1', '#shop h2'];
  for (const [width, height] of [[320, 640], [375, 667], [390, 844], [844, 390], [768, 1024], [1280, 740], [1440, 900]]) {
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

  function dockReport() {
    const dockEl = document.getElementById('dock');
    syncDock();
    const cs = getComputedStyle(dockEl);
    const dock = dockEl.getBoundingClientRect();
    const fixed = cs.position === 'fixed';
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const overlap = (a, b) => {
      if (!a || !b || a.height < 2 || b.height < 2 || a.width < 2 || b.width < 2) return 0;
      const iw = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const ih = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return iw > 2 && ih > 2 ? Math.round(ih) : 0;
    };
    const dockBox = { top: dock.top, bottom: dock.bottom, left: dock.left, right: dock.right, width: dock.width, height: dock.height };
    const adds = [...document.querySelectorAll('button')].filter((el) => {
      if (el.textContent.trim() !== 'Add to Bag') return false;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    const footerLink = document.querySelector('footer nav a');
    const linkBox = footerLink.getBoundingClientRect();
    const linkHit = document.elementFromPoint(linkBox.left + 12, Math.min(window.innerHeight - 4, linkBox.top + linkBox.height / 2));
    return {
      fixed,
      on: document.documentElement.classList.contains('dock-on'),
      stage: overlap(dockBox, box('#stage')),
      slots: overlap(dockBox, box('#slots')),
      prods: overlap(dockBox, box('#prods')),
      footer: overlap(dockBox, box('footer')),
      bar: overlap(dockBox, box('.topbar')),
      pay: overlap(dockBox, box('#pay')),
      adds: adds.length,
      price: document.getElementById('dockprice').textContent,
      linkCovered: fixed && linkBox.top < window.innerHeight && linkBox.bottom > 0 && !(footerLink.contains(linkHit)),
      safePad: cs.paddingBottom,
    };
  }

  for (const [width, height] of [[390, 844], [375, 667], [430, 932], [768, 1024], [320, 640], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      document.documentElement.style.fontSize = '16px';
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      document.getElementById('testmode').hidden = false;
      const drawer = document.getElementById('drawer');
      if (drawer.classList.contains('open')) document.getElementById('closecart').click();
      fitBar();
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const stage = document.getElementById('stage');
      window.scrollTo(0, stage.getBoundingClientRect().top + window.scrollY - bar);
      syncPin();
      await new Promise((resolve) => {
        let last = -1;
        let stable = 0;
        let frames = 0;
        function tick() {
          const next = stage.getBoundingClientRect().height;
          if (Math.abs(next - last) < 0.5) stable += 1;
          else stable = 0;
          last = next;
          frames += 1;
          if (stable >= 4 || frames > 90) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      syncDock();
    });
    const stuck = await page.evaluate(dockReport);
    const label = `${width}x${height}`;
    if (stuck.fixed) {
      for (const part of ['stage', 'slots', 'prods', 'footer', 'bar']) {
        if (stuck[part]) problems.push(`${label}: buy dock overlaps ${part} by ${stuck[part]}px`);
      }
      if (stuck.adds !== 1) problems.push(`${label}: ${stuck.adds} Add to Bag buttons on screen`);
      if (!/\$\d+\.\d\d/.test(stuck.price)) problems.push(`${label}: dock price is "${stuck.price}"`);
    }
    if (width === 390 && height === 844 && !stuck.fixed) problems.push(`${label}: buy dock is not fixed while the preview is pinned`);
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      syncPin();
      syncDock();
    });
    const bottom = await page.evaluate(dockReport);
    if (bottom.footer) problems.push(`${label} bottom: buy dock overlaps the footer by ${bottom.footer}px`);
    if (bottom.fixed && bottom.linkCovered) problems.push(`${label} bottom: buy dock covers a footer link`);
    if (bottom.adds > 1) problems.push(`${label} bottom: ${bottom.adds} Add to Bag buttons on screen`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '16px';
    const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const stage = document.getElementById('stage');
    window.scrollTo(0, stage.getBoundingClientRect().top + window.scrollY - bar);
    syncPin();
    syncDock();
    document.getElementById('cartbtn').click();
  });
  const cartDock = await page.evaluate(dockReport);
  if (cartDock.fixed) problems.push('390x844 cart: buy dock stays fixed over the bag');
  if (cartDock.pay) problems.push(`390x844 cart: buy dock overlaps checkout by ${cartDock.pay}px`);
  await page.evaluate(() => document.getElementById('closecart').click());

  expect(problems, problems.join('\n')).toEqual([]);
});
