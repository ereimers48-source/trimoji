import { expect, test } from '@playwright/test';

async function press(locator, testInfo) {
  await locator.scrollIntoViewIfNeeded();
  await settle(locator.page());
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const stage = document.getElementById('stage');
    let last = -1;
    let stable = 0;
    let frames = 0;
    function tick() {
      const height = stage ? stage.getBoundingClientRect().height : 0;
      if (Math.abs(height - last) < 0.5) stable += 1;
      else stable = 0;
      last = height;
      frames += 1;
      if (stable >= 4 || frames > 40) resolve();
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }));
}

async function mockBox(page) {
  return page.locator('#mock').evaluate((el) => {
    const box = el.getBoundingClientRect();
    const blank = el.querySelector('img.blank');
    return {
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
      fit: blank ? getComputedStyle(blank).objectFit : '',
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
}

test('emoji picks play a flight from the slots into the preview', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/shop-preview');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.waitForFunction(() => window.TrimojiEmojiFlight && document.querySelectorAll('#slots img.em').length === 3);
  await expect(page.locator('#emoji-flight')).toHaveCount(0);
  expect(await page.evaluate(() => window.TrimojiEmojiFlight.lastPlan)).toBeNull();

  await press(page.locator('#prods button[data-value="mug"]'), testInfo);
  await expect(page.locator('#mock')).toHaveAttribute('data-product', 'mug');
  expect(await page.evaluate(() => window.TrimojiEmojiFlight.lastPlan)).toBeNull();
  await expect(page.locator('#emoji-flight')).toHaveCount(0);
  await press(page.locator('#prods button[data-value="tee"]'), testInfo);

  const emoji = page.locator('#grid button[data-emoji="🌈"]');
  await emoji.scrollIntoViewIfNeeded();
  await settle(page);
  const stable = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('#slots .slot')].map((el) => el.getBoundingClientRect());
    const mock = document.querySelector('#mock').getBoundingClientRect();
    const scrollHeight = document.documentElement.scrollHeight;
    window.TrimojiEmojiFlight.play(0);
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
  await page.evaluate(() => window.TrimojiEmojiFlight.cancel());
  if (testInfo.project.use.hasTouch) await emoji.tap();
  else await emoji.click();
  await expect(page.locator('#slots .slot').first().locator('img.em')).toHaveAttribute('alt', '🌈');
  const layer = page.locator('#emoji-flight');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  await expect(layer.locator('.glyph')).toHaveCount(3);
  await expect(layer.locator('.glyph[data-changed="true"]')).toHaveCount(1);
  const layerStyle = await layer.evaluate((el) => {
    const style = getComputedStyle(el);
    const glyph = el.querySelector('.glyph');
    const glyphStyle = getComputedStyle(glyph);
    const sample = document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight - 8, 80));
    const add = document.getElementById('addbtn').getBoundingClientRect();
    const addHit = add.width > 2 && add.top < window.innerHeight && add.bottom > 0
      ? document.elementFromPoint(add.left + add.width / 2, add.top + add.height / 2)
      : null;
    return {
      pointerEvents: style.pointerEvents,
      zIndex: style.zIndex,
      position: style.position,
      glyphPointer: glyphStyle.pointerEvents,
      sampleBlocked: !!(sample && sample.closest('#emoji-flight')),
      addBlocked: !!(addHit && addHit.closest('#emoji-flight')),
    };
  });
  expect(layerStyle.pointerEvents).toBe('none');
  expect(layerStyle.glyphPointer).toBe('none');
  expect(layerStyle.position).toBe('fixed');
  expect(Number(layerStyle.zIndex)).toBeLessThan(40);
  expect(layerStyle.sampleBlocked).toBeFalsy();
  expect(layerStyle.addBlocked).toBeFalsy();
  const plan = await page.evaluate(() => window.TrimojiEmojiFlight.lastPlan);
  expect(plan.mode).toBe('full');
  expect(plan.changed).toBe(0);
  expect(plan.duration).toBeGreaterThanOrEqual(600);
  expect(plan.duration).toBeLessThanOrEqual(900);
  expect(plan.pops.find((pop) => pop.index === 0).peak).toBeGreaterThan(plan.pops.find((pop) => pop.index === 1).peak);

  await expect(layer).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('.glyph')).toHaveCount(0);

  const burst = await page.evaluate(() => {
    let maxLayers = 0;
    let maxGlyphs = 0;
    const observer = new MutationObserver(() => {
      maxLayers = Math.max(maxLayers, document.querySelectorAll('#emoji-flight').length);
      maxGlyphs = Math.max(maxGlyphs, document.querySelectorAll('#emoji-flight .glyph').length);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    for (let n = 0; n < 12; n += 1) window.TrimojiEmojiFlight.play(n % 3);
    const duringLayers = document.querySelectorAll('#emoji-flight').length;
    const duringGlyphs = document.querySelectorAll('.glyph').length;
    window.TrimojiEmojiFlight.cancel();
    observer.disconnect();
    return {
      maxLayers,
      maxGlyphs,
      duringLayers,
      duringGlyphs,
      afterLayers: document.querySelectorAll('#emoji-flight').length,
      afterGlyphs: document.querySelectorAll('.glyph').length,
    };
  });
  expect(burst.duringLayers).toBe(1);
  expect(burst.duringGlyphs).toBeLessThanOrEqual(3);
  expect(burst.maxLayers).toBeLessThanOrEqual(1);
  expect(burst.maxGlyphs).toBeLessThanOrEqual(3);
  expect(burst.afterLayers).toBe(0);
  expect(burst.afterGlyphs).toBe(0);

  for (const product of ['tee', 'mug', 'hat', 'sticker']) {
    await press(page.locator(`#prods button[data-value="${product}"]`), testInfo);
    await page.locator('#mock').scrollIntoViewIfNeeded();
    await settle(page);
    await expect.poll(async () => {
      const box = await page.locator('#mock .print').boundingBox();
      return box ? box.width : 0;
    }).toBeGreaterThan(20);
    const landing = await page.evaluate(() => {
      const plan = window.TrimojiEmojiFlight.play(1);
      const print = document.querySelector('#mock .print').getBoundingClientRect();
      const glyphs = [...document.querySelectorAll('#mock .print image')].slice(0, plan.flights.length);
      return {
        mode: plan.mode,
        imageCount: document.querySelectorAll('#mock .print image').length,
        flights: plan.flights.map((flight, index) => {
          const glyph = glyphs[index] ? glyphs[index].getBoundingClientRect() : null;
          const gx = glyph ? glyph.left + glyph.width / 2 : null;
          const gy = glyph ? glyph.top + glyph.height / 2 : null;
          const nearGlyph = gx != null && Math.hypot(flight.to.x - gx, flight.to.y - gy) <= Math.max(24, glyph.width);
          return {
            clipped: flight.clipped,
            nearGlyph,
            inPrint: flight.to.x >= print.left - 12 && flight.to.x <= print.right + 12
              && flight.to.y >= print.top - 12 && flight.to.y <= print.bottom + 12,
          };
        }),
      };
    });
    expect(landing.mode, product).toBe('full');
    expect(landing.flights.length, product).toBeGreaterThan(0);
    expect(landing.flights.every((flight) => flight.inPrint), product).toBeTruthy();
    if (product === 'sticker') {
      expect(landing.imageCount, product).toBeGreaterThan(3);
      expect(landing.flights.every((flight) => flight.nearGlyph), product).toBeTruthy();
    }
    await page.evaluate(() => window.TrimojiEmojiFlight.cancel());
    await expect(page.locator('#emoji-flight')).toHaveCount(0);
  }

  const after = await mockBox(page);
  expect(after.fit).toBe('contain');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reduced motion skips the flying copies', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/shop-preview');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.waitForFunction(() => window.TrimojiEmojiFlight && document.querySelectorAll('#slots img.em').length === 3);
  const emoji = page.locator('#grid button[data-emoji="✨"]');
  await emoji.scrollIntoViewIfNeeded();
  await settle(page);
  const stable = await page.evaluate(() => {
    const mock = document.querySelector('#mock').getBoundingClientRect();
    const plan = window.TrimojiEmojiFlight.play(0);
    const mockAfter = document.querySelector('#mock').getBoundingClientRect();
    window.TrimojiEmojiFlight.cancel();
    return {
      mode: plan.mode,
      flights: plan.flights.length,
      pops: plan.pops.length,
      duration: plan.duration,
      shift: Math.max(Math.abs(mock.width - mockAfter.width), Math.abs(mock.height - mockAfter.height)),
      fit: getComputedStyle(document.querySelector('#mock img.blank')).objectFit,
      layer: document.querySelectorAll('#emoji-flight').length,
    };
  });
  expect(stable.mode).toBe('reduced');
  expect(stable.flights).toBe(0);
  expect(stable.pops).toBeGreaterThan(0);
  expect(stable.duration).toBeLessThanOrEqual(300);
  expect(stable.shift).toBeLessThan(0.5);
  expect(stable.fit).toBe('contain');
  expect(stable.layer).toBe(0);
  if (testInfo.project.use.hasTouch) await emoji.tap();
  else await emoji.click();
  await expect(page.locator('#slots .slot').first().locator('img.em')).toHaveAttribute('alt', '✨');
  await expect(page.locator('#emoji-flight')).toHaveCount(0);
  const plan = await page.evaluate(() => window.TrimojiEmojiFlight.lastPlan);
  expect(plan.mode).toBe('reduced');
  expect(plan.flights).toEqual([]);
  expect(plan.pops.length).toBeGreaterThan(0);
  expect(plan.duration).toBeLessThanOrEqual(300);
  expect(errors, errors.join('\n')).toEqual([]);
});
