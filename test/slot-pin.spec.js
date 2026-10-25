import { expect, test } from '@playwright/test';

async function press(locator, testInfo) {
  await locator.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

function readPin() {
  const barEl = document.querySelector('.topbar');
  const slotEl = document.querySelector('#slotbar');
  const stageEl = document.querySelector('#stage');
  const dockEl = document.querySelector('#dock');
  const prodEl = document.querySelector('#prod-choice');
  const bar = barEl.getBoundingClientRect();
  const slotbar = slotEl.getBoundingClientRect();
  const stage = stageEl.getBoundingClientRect();
  const dock = dockEl.getBoundingClientRect();
  const prod = prodEl.getBoundingClientRect();
  const chips = [...document.querySelectorAll('#slots .slot')].map((el) => el.getBoundingClientRect().width);
  const before = getComputedStyle(slotEl, '::before');
  const overlap = (a, b) => {
    const iw = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const ih = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return iw > 1 && ih > 1 ? ih : 0;
  };
  return {
    stuck: document.documentElement.classList.contains('slots-stuck'),
    position: getComputedStyle(slotEl).position,
    barBottom: bar.bottom,
    slotTop: slotbar.top,
    slotBottom: slotbar.bottom,
    slotLeft: slotbar.left,
    slotRight: slotbar.right,
    stageTop: stage.top,
    stageBottom: stage.bottom,
    prodTop: prod.top,
    chips,
    z: Number(getComputedStyle(slotEl).zIndex),
    headerZ: Number(getComputedStyle(barEl).zIndex),
    frost: before.backgroundColor,
    blur: before.backdropFilter || before.webkitBackdropFilter || '',
    headerOverlap: overlap(slotbar, bar),
    stageOverlap: overlap(slotbar, stage),
    dockOverlap: overlap(slotbar, dock),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
}

test('slot row sticks under the header, then lets go at the product choices', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/shop-preview');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.waitForFunction(() => document.querySelectorAll('#slots img.em').length === 3);
  await page.evaluate(() => { document.getElementById('shop').scrollIntoView({ block: 'start' }); syncPin(); });
  const resting = await page.evaluate(readPin);
  expect(resting.position).toBe('sticky');
  expect(resting.stuck).toBeFalsy();
  expect(resting.chips).toHaveLength(3);
  const restingWidth = Math.min(...resting.chips);
  expect(restingWidth).toBeGreaterThan(72);

  await press(page.locator('#tabs button[data-cat="fl"]'), testInfo);
  await page.evaluate(() => new Promise((resolve) => {
    const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const scope = document.getElementById('emoji-pin');
    const top = scope.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - bar + 240);
    requestAnimationFrame(() => {
      syncPin();
      requestAnimationFrame(() => {
        syncPin();
        resolve();
      });
    });
  }));
  const stuck = await page.evaluate(readPin);
  expect(stuck.stuck).toBeTruthy();
  expect(stuck.position).toBe('sticky');
  expect(stuck.slotTop).toBeGreaterThanOrEqual(stuck.barBottom - 2);
  expect(stuck.slotTop).toBeLessThanOrEqual(stuck.barBottom + 3);
  expect(stuck.slotBottom).toBeGreaterThan(stuck.barBottom + 24);
  expect(Math.max(...stuck.chips)).toBeLessThan(restingWidth - 8);
  expect(Math.min(...stuck.chips)).toBeGreaterThan(44);
  expect(stuck.z).toBeLessThan(stuck.headerZ);
  expect(stuck.z).toBeLessThan(40);
  expect(stuck.headerOverlap).toBe(0);
  expect(stuck.stageOverlap).toBe(0);
  expect(stuck.dockOverlap).toBe(0);
  expect(stuck.frost).not.toBe('rgba(0, 0, 0, 0)');
  expect(stuck.scrollWidth).toBeLessThanOrEqual(stuck.innerWidth + 1);
  const order = await page.evaluate(() => {
    const nodes = ['#emoji-choice', '#slotbar', '#grid', '#stage', '#prod-choice'].map((sel) => document.querySelector(sel));
    return nodes.every((node, index) => node && (index === 0 || (nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)));
  });
  expect(order).toBeTruthy();

  const glide = await page.evaluate(() => {
    const bar = document.querySelector('#slotbar').getBoundingClientRect().bottom;
    const button = [...document.querySelectorAll('#grid button[data-emoji]')].find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 8 && rect.top > bar + 4 && rect.bottom < window.innerHeight - 8;
    });
    const emoji = button.dataset.emoji;
    button.click();
    const plan = window.TrimojiEmojiGlide.lastPlan;
    const img = document.querySelector('#slots .slot[data-slot="0"] img.em');
    const rect = img.getBoundingClientRect();
    return {
      emoji,
      alt: img.alt,
      mode: plan.mode,
      slot: plan.slot,
      distance: plan.travel ? Math.hypot(plan.travel.to.x - (rect.left + rect.width / 2), plan.travel.to.y - (rect.top + rect.height / 2)) : null,
    };
  });
  expect(glide.alt).toBe(glide.emoji);
  expect(glide.mode).toBe('glide');
  expect(glide.slot).toBe(0);
  expect(glide.distance).toBeLessThan(24);
  await page.evaluate(() => window.TrimojiEmojiGlide.cancel());

  await page.evaluate(() => new Promise((resolve) => {
    const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const stage = document.getElementById('stage');
    window.scrollTo(0, stage.getBoundingClientRect().top + window.scrollY - bar);
    requestAnimationFrame(() => {
      syncPin();
      requestAnimationFrame(() => {
        syncPin();
        resolve();
      });
    });
  }));
  const released = await page.evaluate(readPin);
  expect(released.stuck).toBeFalsy();
  expect(released.slotBottom).toBeLessThanOrEqual(released.stageTop + 2);
  expect(released.stageOverlap).toBe(0);
  expect(released.dockOverlap).toBe(0);
  expect(released.z).toBeLessThan(released.headerZ);
  const headerCover = await page.evaluate(() => {
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const slot = document.querySelector('#slotbar').getBoundingClientRect();
    const y = Math.min(bar.bottom, Math.max(slot.top, bar.top)) + 8;
    if (y >= bar.bottom - 2 || slot.bottom <= bar.top + 1) return 'clear';
    const hit = document.elementFromPoint(window.innerWidth / 2, y);
    return hit && hit.closest('.topbar') ? 'header' : 'slots';
  });
  expect(headerCover).not.toBe('slots');
  expect(released.prodTop).toBeGreaterThanOrEqual(released.stageTop - 2);
  if (testInfo.project.use.isMobile) {
    expect(released.stageTop).toBeGreaterThanOrEqual(released.barBottom - 2);
    const ceiling = released.slotBottom > released.barBottom ? released.slotBottom : released.barBottom;
    expect(released.stageTop).toBeLessThanOrEqual(ceiling + 8);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
