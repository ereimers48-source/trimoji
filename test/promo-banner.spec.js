import { expect, test } from '@playwright/test';

const BEFORE = '2026-11-27T07:59:59.999Z';
const START = '2026-11-27T08:00:00.000Z';
const DURING = '2026-11-28T20:00:00.000Z';
const END = '2026-12-01T07:59:59.999Z';
const AFTER = '2026-12-01T08:00:00.000Z';
const COPY = 'Black Friday: 15% off everything with code HOLIDAY15 · ends Mon 11/30 11:59 PM PT';

test('the sale banner follows Pacific time and stays clear of test mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one clock sweep covers the banner');
  // A full Date mock breaks Intl. Patch only the no-argument clock and leave
  // `new Date(ms)` / Date.UTC alone so the Pacific conversion still works.
  await page.addInitScript(() => {
    const RealDate = Date;
    const raw = new URLSearchParams(location.search).get('saleNow');
    if (!raw) return;
    const fixed = RealDate.parse(raw);
    function PatchedDate(...args) {
      if (args.length === 0) return new RealDate(fixed);
      return new RealDate(...args);
    }
    PatchedDate.now = () => fixed;
    PatchedDate.UTC = RealDate.UTC;
    PatchedDate.parse = RealDate.parse;
    PatchedDate.prototype = RealDate.prototype;
    window.Date = PatchedDate;
  });

  async function at(iso) {
    await page.goto(`/shop-preview?saleNow=${encodeURIComponent(iso)}`);
    await expect(page.locator('#testmode')).toBeVisible();
  }

  await at(BEFORE);
  await expect(page.locator('#sale')).toBeHidden();

  await at(START);
  await expect(page.locator('#sale')).toBeVisible();
  await expect(page.locator('#sale')).toHaveText(COPY);

  await at(DURING);
  await expect(page.locator('#sale')).toBeVisible();
  for (const viewport of [
    { width: 1280, height: 740 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    for (const font of [16, 24]) {
      const layout = await page.evaluate(async (px) => {
        document.documentElement.style.fontSize = `${px}px`;
        if (typeof fitBar === 'function') fitBar();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const testmode = document.getElementById('testmode').getBoundingClientRect();
        const sale = document.getElementById('sale').getBoundingClientRect();
        const iw = Math.min(testmode.right, sale.right) - Math.max(testmode.left, sale.left);
        const ih = Math.min(testmode.bottom, sale.bottom) - Math.max(testmode.top, sale.top);
        const vw = document.documentElement.clientWidth;
        return {
          overlap: iw > 1 && ih > 1,
          saleBelow: sale.top >= testmode.bottom - 1,
          saleHeight: sale.height,
          wide: document.documentElement.scrollWidth > vw + 2,
          saleRight: sale.right,
          saleLeft: sale.left,
          vw,
        };
      }, font);
      expect(layout.overlap, `${viewport.width} ${font}px ${JSON.stringify(layout)}`).toBe(false);
      expect(layout.saleBelow, `${viewport.width} ${font}px`).toBe(true);
      expect(layout.saleHeight, `${viewport.width} ${font}px`).toBeGreaterThan(0);
      expect(layout.wide, `${viewport.width} ${font}px`).toBe(false);
      expect(layout.saleLeft).toBeGreaterThanOrEqual(-1);
      expect(layout.saleRight).toBeLessThanOrEqual(layout.vw + 1);
    }
  }

  await at(END);
  await expect(page.locator('#sale')).toBeVisible();
  await at(AFTER);
  await expect(page.locator('#sale')).toBeHidden();
});
