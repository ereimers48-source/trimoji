import { expect, test } from '@playwright/test';

async function press(locator, testInfo) {
  await locator.scrollIntoViewIfNeeded();
  await settle(locator.page());
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

test('an emoji tap glides into the slot and a new tap does not leak nodes', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/shop-preview');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.waitForFunction(() => window.TrimojiEmojiGlide && document.querySelectorAll('#slots img.em').length === 3);
  await expect(page.locator('#emoji-glide')).toHaveCount(0);
  expect(await page.evaluate(() => window.TrimojiEmojiGlide.lastPlan)).toBeNull();

  await press(page.locator('#prods button[data-value="mug"]'), testInfo);
  await expect(page.locator('#mock')).toHaveAttribute('data-product', 'mug');
  expect(await page.evaluate(() => window.TrimojiEmojiGlide.lastPlan)).toBeNull();
  await expect(page.locator('#emoji-glide')).toHaveCount(0);
  await press(page.locator('#prods button[data-value="tee"]'), testInfo);

  const emoji = page.locator('#grid button[data-emoji="🌈"]');
  await emoji.scrollIntoViewIfNeeded();
  await settle(page);
  const stable = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('#slots .slot')].map((el) => el.getBoundingClientRect());
    const mock = document.querySelector('#mock').getBoundingClientRect();
    const scrollHeight = document.documentElement.scrollHeight;
    const button = document.querySelector('#grid button[data-emoji="🌈"]');
    window.TrimojiEmojiGlide.play(0, { from: button, previous: '' });
    const slotsAfter = [...document.querySelectorAll('#slots .slot')].map((el) => el.getBoundingClientRect());
    const mockAfter = document.querySelector('#mock').getBoundingClientRect();
    return {
      mockShift: Math.max(Math.abs(mock.width - mockAfter.width), Math.abs(mock.height - mockAfter.height)),
      slotShift: Math.max(...slots.map((box, index) => Math.max(
        Math.abs(box.width - slotsAfter[index].width),
        Math.abs(box.height - slotsAfter[index].height),
      ))),
      scrollHeight,
      scrollAfter: document.documentElement.scrollHeight,
      fit: getComputedStyle(document.querySelector('#mock img.blank')).objectFit,
    };
  });
  expect(stable.mockShift).toBeLessThan(0.5);
  expect(stable.slotShift).toBeLessThan(0.5);
  expect(stable.scrollAfter).toBe(stable.scrollHeight);
  expect(stable.fit).toBe('contain');
  await page.evaluate(() => window.TrimojiEmojiGlide.cancel());

  if (testInfo.project.use.hasTouch) await emoji.tap();
  else await emoji.click();
  await expect(page.locator('#slots .slot').first().locator('img.em')).toHaveAttribute('alt', '🌈');
  const layer = page.locator('#emoji-glide');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  await expect(layer.locator('.glyph')).toHaveCount(1);
  const layerStyle = await layer.evaluate((el) => {
    const style = getComputedStyle(el);
    const glyph = el.querySelector('.glyph');
    const glyphStyle = getComputedStyle(glyph);
    const sample = document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight - 8, 80));
    const add = document.getElementById('addbtn').getBoundingClientRect();
    const addHit = add.width > 2 && add.top < window.innerHeight && add.bottom > 0
      ? document.elementFromPoint(add.left + add.width / 2, add.top + add.height / 2)
      : null;
    const transform = glyphStyle.transform || '';
    return {
      pointerEvents: style.pointerEvents,
      zIndex: style.zIndex,
      position: style.position,
      glyphPointer: glyphStyle.pointerEvents,
      sampleBlocked: !!(sample && sample.closest('#emoji-glide')),
      addBlocked: !!(addHit && addHit.closest('#emoji-glide')),
      transform,
    };
  });
  expect(layerStyle.pointerEvents).toBe('none');
  expect(layerStyle.glyphPointer).toBe('none');
  expect(layerStyle.position).toBe('fixed');
  expect(Number(layerStyle.zIndex)).toBeLessThan(40);
  expect(layerStyle.sampleBlocked).toBeFalsy();
  expect(layerStyle.addBlocked).toBeFalsy();
  expect(layerStyle.transform.includes('matrix')).toBeTruthy();
  const plan = await page.evaluate(() => window.TrimojiEmojiGlide.lastPlan);
  expect(plan.mode).toBe('glide');
  expect(plan.slot).toBe(0);
  expect(plan.duration).toBeGreaterThanOrEqual(400);
  expect(plan.duration).toBeLessThanOrEqual(600);
  expect(plan.travel).toBeTruthy();
  const landing = await page.evaluate(() => {
    const flight = window.TrimojiEmojiGlide.lastPlan.travel;
    const img = document.querySelector('#slots .slot[data-slot="0"] img.em').getBoundingClientRect();
    return Math.hypot(flight.to.x - (img.left + img.width / 2), flight.to.y - (img.top + img.height / 2));
  });
  expect(landing).toBeLessThan(20);

  await expect(layer).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('#emoji-glide .glyph')).toHaveCount(0);

  const burst = await page.evaluate(() => {
    let maxLayers = 0;
    let maxGlyphs = 0;
    const observer = new MutationObserver(() => {
      maxLayers = Math.max(maxLayers, document.querySelectorAll('#emoji-glide').length);
      maxGlyphs = Math.max(maxGlyphs, document.querySelectorAll('#emoji-glide .glyph').length);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const button = document.querySelector('#grid button[data-emoji="🌈"]');
    for (let n = 0; n < 12; n += 1) window.TrimojiEmojiGlide.play(n % 3, { from: button, previous: '' });
    const during = {
      layers: document.querySelectorAll('#emoji-glide').length,
      glyphs: document.querySelectorAll('#emoji-glide .glyph').length,
    };
    window.TrimojiEmojiGlide.cancel();
    observer.disconnect();
    return {
      maxLayers,
      maxGlyphs,
      during,
      afterLayers: document.querySelectorAll('#emoji-glide').length,
      afterGlyphs: document.querySelectorAll('.glyph').length,
    };
  });
  expect(burst.during.layers).toBe(1);
  expect(burst.during.glyphs).toBeLessThanOrEqual(1);
  expect(burst.maxLayers).toBeLessThanOrEqual(1);
  expect(burst.maxGlyphs).toBeLessThanOrEqual(1);
  expect(burst.afterLayers).toBe(0);
  expect(burst.afterGlyphs).toBe(0);

  await press(page.locator('#slots .slot[data-slot="2"] button.slot-clear'), testInfo);
  await press(page.locator('#slots .slot[data-slot="2"] button.slot-pick'), testInfo);
  await expect(page.locator('#slots button[data-slot="2"]')).toHaveAttribute('aria-pressed', 'true');
  const heart = page.locator('#grid button[data-emoji="❤️"]');
  await heart.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await heart.tap();
  else await heart.click();
  await expect(page.locator('#slots .slot[data-slot="2"] img.em')).toHaveAttribute('alt', '❤️');
  const replaced = await page.evaluate(() => window.TrimojiEmojiGlide.lastPlan.slot);
  expect(replaced).toBe(2);
  await page.evaluate(() => window.TrimojiEmojiGlide.cancel());
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reduced motion and an off-screen slot cross-fade without travel', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/shop-preview');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.waitForFunction(() => window.TrimojiEmojiGlide && document.querySelectorAll('#slots img.em').length === 3);
  const emoji = page.locator('#grid button[data-emoji="✨"]');
  await emoji.scrollIntoViewIfNeeded();
  await settle(page);
  if (testInfo.project.use.hasTouch) await emoji.tap();
  else await emoji.click();
  await expect(page.locator('#slots .slot').first().locator('img.em')).toHaveAttribute('alt', '✨');
  await expect(page.locator('#emoji-glide .glyph')).toHaveCount(0);
  const reduced = await page.evaluate(() => window.TrimojiEmojiGlide.lastPlan);
  expect(reduced.mode).toBe('fade');
  expect(reduced.travel).toBeNull();
  expect(reduced.pop).toBeNull();
  expect(reduced.duration).toBeLessThanOrEqual(300);
  await page.evaluate(() => window.TrimojiEmojiGlide.cancel());

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.waitForFunction(() => window.TrimojiEmojiGlide && document.querySelectorAll('#slots img.em').length === 3);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  const hidden = await page.evaluate(() => {
    const sizes = document.getElementById('size-choice');
    sizes.scrollIntoView({ block: 'start' });
    syncPin();
    const button = document.querySelector('#grid button[data-emoji="⚡"]');
    button.click();
    const plan = window.TrimojiEmojiGlide.lastPlan;
    const slot = document.querySelector('#slotbar').getBoundingClientRect();
    return {
      mode: plan.mode,
      travel: plan.travel,
      glyphs: document.querySelectorAll('#emoji-glide .glyph').length,
      slotBottom: slot.bottom,
      alt: document.querySelector('#slots .slot[data-slot="0"] img.em').alt,
    };
  });
  expect(hidden.alt).toBe('⚡');
  expect(hidden.slotBottom).toBeLessThanOrEqual(4);
  expect(hidden.mode).toBe('fade');
  expect(hidden.travel).toBeNull();
  expect(hidden.glyphs).toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
