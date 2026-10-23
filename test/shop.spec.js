import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const live = process.env.QA_LIVE === '1';

function track(page) {
  const errors = [];
  page.on('pageerror', (err) => {
    const message = err.message || '';
    if (message.includes('stripe.com')) return;
    errors.push(`pageerror ${message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url || '';
    if (where.includes('stripe.com')) return;
    const text = msg.text();
    if (text.includes('stripe.com') || text.includes('ERR_ABORTED')) return;
    errors.push(text);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    const reason = req.failure()?.errorText || '';
    if (reason.includes('ERR_ABORTED')) return;
    if (url.includes('jsdelivr.net') || url.includes('twemoji') || url.includes('favicon')) {
      errors.push(`asset ${reason} ${url}`);
    }
  });
  return errors;
}

async function reveal(locator) {
  await locator.evaluate((el) => {
    let node = el;
    while (node && node !== document.body) {
      if (node.dataset && node.dataset.panel && node.hidden) {
        const tab = document.querySelector(`#flow button[data-step="${node.dataset.panel}"]`);
        if (tab) tab.click();
      }
      node = node.parentElement;
    }
  });
}

async function press(locator, testInfo) {
  await reveal(locator);
  await locator.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

async function clickReady(page, selector) {
  const locator = page.locator(selector);
  await reveal(locator);
  await locator.click();
}

async function logoImages(page) {
  return page.locator('#mock image').evaluateAll((els) => els.map((el) => ({
    href: el.getAttribute('href') || '',
    xlink: el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '',
    x: Number(el.getAttribute('x')),
    y: Number(el.getAttribute('y')),
    w: Number(el.getAttribute('width')),
  })));
}

async function shot(page, testInfo, name) {
  if (testInfo.project.name !== 'mobile') return;
  const dir = process.env.SHOT_DIR || 'test-results/mobile';
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

test('design controls, cart, and Stripe checkout', async ({ page }, testInfo) => {
  const errors = track(page);
  if (!live) {
    await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stripe test checkout</title><h1>Stripe test checkout</h1>',
    }));
  }

  await page.goto('/');
  await expect(page.locator('#mock image')).toHaveCount(3);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/tee\/white-/);
  await expect.poll(() => page.locator('#mock img.blank').evaluate((el) => el.naturalWidth)).toBeGreaterThan(100);
  await expect(page.locator('#testmode')).toBeVisible();
  await expect(page.locator('#testmode')).toContainText('Test mode');
  await expect(page.locator('body')).not.toContainText('sk_');
  await expect(page.locator('body')).not.toContainText('Made when you order');
  await expect(page.locator('body')).not.toContainText('Card details stay on Stripe');
  await expect(page.locator('body')).not.toContainText('Printed by Printful');
  await expect(page.locator('body')).not.toContainText('Before you pay');
  await expect(page.locator('footer .footgrid > div')).toHaveCount(2);
  const footerFit = await page.locator('footer .footgrid').evaluate((el) => {
    const grid = el.getBoundingClientRect();
    const kids = [...el.children].map((child) => child.getBoundingClientRect());
    const stacked = kids[1].top >= kids[0].bottom - 2;
    return {
      stacked,
      slackLeft: kids[0].left - grid.left,
      slackRight: grid.right - kids[kids.length - 1].right,
      gap: stacked ? kids[1].top - kids[0].bottom : kids[1].left - kids[0].right,
    };
  });
  expect(footerFit.slackLeft).toBeLessThan(4);
  expect(footerFit.gap).toBeGreaterThan(8);
  if (footerFit.stacked) expect(footerFit.gap).toBeLessThan(40);
  else expect(footerFit.slackRight).toBeLessThan(4);
  await expect(page.locator('.trust li')).toHaveCount(1);
  await expect(page.locator('.trust')).toHaveCount(1);
  await expect(page.locator('.trust[aria-label="Shipping and checkout"] li')).toHaveCount(1);
  await expect(page.locator('.trust[aria-label="Shipping and checkout"]')).toContainText('$5.99 flat, free over $60');
  const buyCopy = await page.locator('#step-buy').evaluate((el) => el.textContent || '');
  expect(buyCopy).not.toContain('$5.99');
  await expect(page.locator('#price')).not.toContainText('free shipping');
  await expect(page.locator('#sizecap')).toContainText('Scales the trio');
  const shippingCopies = await page.locator('body').evaluate((el) => (el.innerText.match(/\$5\.99 flat, free over \$60/g) || []).length);
  expect(shippingCopies).toBe(1);
  const trustLayout = await page.locator('.trust').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const tile = el.querySelector('li').getBoundingClientRect();
    const row = el.getBoundingClientRect();
    return { display: cs.display, columns: cs.gridTemplateColumns, tile: tile.width, row: row.width };
  });
  expect(trustLayout.display).toBe('flex');
  expect(trustLayout.columns).toBe('none');
  expect(trustLayout.row - trustLayout.tile).toBeLessThan(2);
  await expect(page.locator('a.btn[href="#builder"]')).toHaveCount(1);
  await expect(page.locator('a[href="#builder"] button')).toHaveCount(0);
  await expect(page.locator('#try button')).toHaveCount(10);
  const tryBox = await page.locator('#try button').first().boundingBox();
  expect(tryBox.height).toBeGreaterThanOrEqual(44);

  const touchAction = await page.locator('#lay button').first().evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toBe('manipulation');
  const blur = await page.locator('header').evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(blur === 'none' || blur === '').toBeTruthy();

  await press(page.locator('a.btn[href="#builder"]'), testInfo);
  await expect(page).toHaveURL(/#builder/);
  await press(page.locator('#suggest'), testInfo);
  await expect(page.locator('#bn')).toHaveText('Emoji Trio');

  const initial = await logoImages(page);
  expect(initial).toHaveLength(3);
  for (const image of initial) {
    expect(image.href).toContain('/72x72/');
    expect(image.href.endsWith('.png')).toBeTruthy();
    expect(image.xlink).toBe(image.href);
  }
  const ys = new Set(initial.map((image) => image.y));
  expect(ys.size).toBe(1);
  expect(initial.map((image) => image.x)).toEqual([...initial.map((image) => image.x)].sort((a, b) => a - b));
  expect(new Set(initial.map((image) => image.x)).size).toBe(3);
  const loaded = await page.evaluate(async (urls) => {
    const checks = urls.map((src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = src;
    }));
    return Promise.all(checks);
  }, initial.map((image) => image.href));
  expect(loaded).toEqual([true, true, true]);

  await page.locator('#grid button[data-emoji="🔥"]').first().evaluate((el) => { el.dataset.keep = '1'; });
  await press(page.locator('#slots button').first(), testInfo);
  await expect(page.locator('#heroart img')).toHaveCount(2);
  await expect(page.locator('#grid button[data-keep="1"]')).toHaveCount(1);
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#toast')).toContainText('Pick exactly 3');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);

  await press(page.locator('#slots button').first(), testInfo);
  await press(page.locator('#slots button').first(), testInfo);
  await expect(page.locator('#slots button.f')).toHaveCount(0);
  await expect(page.locator('#heroart img')).toHaveAttribute('alt', '✨');

  await page.locator('#q').fill('pizza');
  await expect(page.locator('#grid button[title="pizza"]')).toBeVisible();
  await press(page.locator('#grid button[title="pizza"]'), testInfo);
  await page.locator('#q').fill('fire');
  await press(page.locator('#grid button[title="fire"]'), testInfo);
  await page.locator('#q').fill('');
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await expect(page.locator('#c_fu')).toBeAttached();
  await press(page.locator('#tabs button[data-cat="fl"]'), testInfo);
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await expect(page.locator('#tabs button.on')).toHaveCount(1);
  const flagsVisible = await page.locator('#c_fl').evaluate((el) => {
    const grid = document.getElementById('grid');
    const top = el.getBoundingClientRect().top - grid.getBoundingClientRect().top;
    return top >= -2 && top < grid.clientHeight && grid.scrollTop === 0;
  });
  expect(flagsVisible).toBeTruthy();
  await press(page.locator('#tabs button[data-cat="sp"]'), testInfo);
  await expect(page.locator('#c_sp')).toBeVisible();
  await press(page.locator('#grid button[title="smiling face with sunglasses"]').first(), testInfo);
  await expect(page.locator('#heroart img')).toHaveCount(3);
  const slotHit = await page.locator('#slots small').first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(slotHit.width).toBeGreaterThanOrEqual(40);
  expect(slotHit.height).toBeGreaterThanOrEqual(40);
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('#slots img.em, #heroart img.em')) {
      if (node.alt === '🔥' || node.alt === '😎') node.dataset.stay = node.alt;
    }
    for (const node of document.querySelectorAll('#mock image')) {
      const href = node.getAttribute('href') || '';
      if (href.includes('1f525') || href.includes('1f60e')) node.dataset.stay = '1';
    }
  });
  await press(page.locator('#grid button[title="face with tears of joy"]').first(), testInfo);
  await expect(page.locator('#slots img[data-stay="🔥"]')).toHaveCount(1);
  await expect(page.locator('#slots img[data-stay="😎"]')).toHaveCount(1);
  await expect(page.locator('#heroart img[data-stay="🔥"]')).toHaveCount(1);
  await expect(page.locator('#heroart img[data-stay="😎"]')).toHaveCount(1);
  await expect(page.locator('#mock image[data-stay="1"]')).toHaveCount(2);
  await expect(page.locator('#heroart img')).toHaveCount(3);
  const picked = await page.locator('#heroart img').evaluateAll((els) => els.map((el) => el.alt));
  expect(picked).toEqual(['🔥', '😎', '😂']);
  await expect(page.locator('#toast')).toContainText('oldest');
  await press(page.locator('#try button[data-emoji="🌈"]'), testInfo);
  await expect(page.locator('#heroart img')).toHaveCount(3);
  const tried = await page.locator('#heroart img').evaluateAll((els) => els.map((el) => el.alt));
  expect(tried).toContain('🌈');
  await expect(page.locator('#try button[data-emoji="🌈"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#showcase')).toContainText('Not customer photos');
  await expect(page.locator('#showtrack article')).toHaveCount(5);
  const looks = await page.locator('#showtrack').evaluate((el) => {
    const cards = [...el.querySelectorAll('.ex')];
    const boxes = cards.map((card) => card.getBoundingClientRect());
    const buttons = cards.map((card) => card.querySelector('button').getBoundingClientRect());
    const heights = boxes.map((box) => box.height);
    const bottoms = buttons.map((box) => box.bottom);
    const tops = boxes.map((box) => box.top);
    return {
      height: Math.max(...heights) - Math.min(...heights),
      buttons: Math.max(...bottoms) - Math.min(...bottoms),
      tops: Math.max(...tops) - Math.min(...tops),
      left: boxes[0].left - el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right - boxes.at(-1).right,
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
  const chest = await page.locator('#showtrack .garment').evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();
    const trio = el.querySelector('.trio').getBoundingClientRect();
    return {
      kind: [...el.classList].find((name) => ['tee', 'hoodie', 'hat', 'mug'].includes(name)),
      width: trio.width / box.width,
      cx: ((trio.left + trio.right) / 2 - box.left) / box.width,
      cy: ((trio.top + trio.bottom) / 2 - box.top) / box.height,
    };
  }));
  for (const logo of chest.filter((logo) => logo.kind === 'tee' || logo.kind === 'hoodie')) {
    expect(logo.width, logo.kind).toBeGreaterThan(0.25);
    expect(logo.width, logo.kind).toBeLessThan(0.3);
    expect(logo.cy, logo.kind).toBeGreaterThan(0.34);
    expect(logo.cy, logo.kind).toBeLessThan(0.48);
  }
  expect(chest.find((logo) => logo.kind === 'tee').cx).toBeGreaterThan(0.46);
  expect(chest.find((logo) => logo.kind === 'tee').cx).toBeLessThan(0.54);
  expect(chest.find((logo) => logo.kind === 'hoodie').cx).toBeGreaterThan(0.5);
  expect(chest.find((logo) => logo.kind === 'hoodie').cx).toBeLessThan(0.58);
  for (const logo of chest.filter((logo) => logo.kind === 'hat')) {
    expect(logo.width, logo.kind).toBeGreaterThan(0.4);
  }
  const mug = chest.find((logo) => logo.kind === 'mug');
  const mugFrame = await page.locator('#showtrack .garment.mug').evaluate((el) => {
    const photo = getComputedStyle(el.querySelector(':scope > img'));
    const trio = getComputedStyle(el.querySelector('.trio'));
    return { fit: photo.objectFit, dir: trio.flexDirection };
  });
  expect(mugFrame.fit).toBe('contain');
  expect(mugFrame.dir).toBe('row');
  expect(mug.width).toBeGreaterThan(0.28);
  expect(mug.width).toBeLessThan(0.34);
  expect(mug.cy).toBeGreaterThan(0.45);
  expect(mug.cy).toBeLessThan(0.53);
  expect(mug.cx).toBeGreaterThan(0.45);
  expect(mug.cx).toBeLessThan(0.52);
  expect(looks.height).toBeLessThan(2);
  expect(looks.buttons).toBeLessThan(2);
  expect(looks.tops).toBeLessThan(2);
  if (!testInfo.project.use.isMobile) {
    expect(looks.overflow).toBeLessThan(4);
    expect(looks.left).toBeGreaterThan(-2);
    expect(looks.left).toBeLessThan(8);
    expect(looks.right).toBeGreaterThan(-2);
    expect(looks.right).toBeLessThan(8);
  }
  await expect(page.locator('#showpause')).toBeVisible();
  await expect(page.locator('.disclaimer')).toContainText('Not reviews, not quotes, and not statistics');
  await page.locator('#grid').scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'mobile-picker');

  await page.locator('#lay button[data-value="row"]').evaluate((el) => { el.dataset.keep = '1'; });
  await press(page.locator('#lay button[data-value="triangle"]'), testInfo);
  await expect(page.locator('#lay button[data-value="triangle"]')).toHaveClass(/on/);
  await expect(page.locator('#lay button[data-keep="1"]')).toHaveCount(1);
  const triangle = await logoImages(page);
  expect(new Set(triangle.map((image) => image.y)).size).toBeGreaterThan(1);

  await press(page.locator('#lay button[data-value="stacked"]'), testInfo);
  const stacked = await logoImages(page);
  expect(new Set(stacked.map((image) => Math.round(image.x))).size).toBe(1);
  expect(new Set(stacked.map((image) => Math.round(image.y))).size).toBe(3);
  await press(page.locator('#lay button[data-value="triangle"]'), testInfo);

  const beforeWidth = triangle[0].w;
  const slider = page.locator('#sz');
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  const x = box.x + box.width * 0.95;
  const y = box.y + box.height / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(page.locator('#szv')).not.toHaveText('100%');
  const grown = await logoImages(page);
  expect(grown[0].w).toBeGreaterThan(beforeWidth);
  const sizeLabel = await page.locator('#szv').textContent();
  expect(Number.parseInt(sizeLabel, 10)).toBeGreaterThan(100);

  await press(page.locator('#bgs button').nth(1), testInfo);
  await expect(page.locator('#mock circle')).toHaveAttribute('fill', '#fde68a');
  await page.locator('#mock').scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'mobile-mockup');

  const rowsOf = async (selector) => page.locator(selector).evaluate((el) => {
    const rows = new Map();
    for (const child of el.children) {
      const top = Math.round(child.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) || 0) + 1);
    }
    return [...rows.values()];
  });
  const productRows = await rowsOf('#prods');
  const backgroundRows = await rowsOf('#bgs');
  expect(productRows.every((count) => count > 1)).toBeTruthy();
  expect(backgroundRows.every((count) => count > 1)).toBeTruthy();
  const photoSwap = await page.evaluate(() => new Promise((resolve) => {
    const blank = document.querySelector('#mock img.blank');
    const srcs = [];
    const obs = new MutationObserver(() => srcs.push(blank.getAttribute('src') || ''));
    obs.observe(blank, { attributes: true, attributeFilter: ['src'] });
    document.querySelector('#prods button[data-value="hoodie"]').click();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      obs.disconnect();
      resolve({
        srcs,
        flat: document.getElementById('mock').classList.contains('flat'),
        current: blank.getAttribute('src') || '',
        empty: srcs.some((src) => !src),
      });
    }));
  }));
  expect(photoSwap.empty).toBeFalsy();
  expect(photoSwap.flat).toBeFalsy();
  expect(photoSwap.srcs.every((src) => /\/(tee|hoodie)\//.test(src))).toBeTruthy();
  await press(page.locator('#prods button[data-value="hoodie"]'), testInfo);
  await expect(page.locator('#price')).toContainText('$54.00');
  await expect(page.locator('#cols button')).toHaveCount(5);
  await expect(page.locator('#cols button[title="Lilac"]')).toHaveCount(0);
  await expect(page.locator('#cols button[title="Sage"]')).toHaveCount(0);
  const hoodieColors = await page.locator('#cols button').evaluateAll((els) => els.map((el) => el.title));
  expect(hoodieColors).toEqual(['White', 'Black', 'Heather', 'Navy', 'Pink']);

  await press(page.locator('#prods button[data-value="mug"]'), testInfo);
  await expect(page.locator('#price')).toContainText('$19.00');
  await expect(page.locator('#cols button')).toHaveCount(1);
  await expect(page.locator('#cols button')).toHaveAttribute('title', 'White');
  await page.locator('#flow button[data-step="make"]').click();
  await expect(page.locator('#sizes button')).toHaveText('11 oz');

  await press(page.locator('#prods button[data-value="hat"]'), testInfo);
  await expect(page.locator('#prods button[data-value="hat"]')).toHaveText('Trucker hat');
  await expect(page.locator('#addbtn')).toBeEnabled();
  await expect(page.locator('#unavail')).toBeHidden();
  await expect(page.locator('#price')).toContainText('$33.00');
  await page.locator('#flow button[data-step="make"]').click();
  await expect(page.locator('#sizes button')).toHaveText('One size');
  const hatColors = await page.locator('#cols button').evaluateAll((els) => els.map((el) => el.title));
  expect(hatColors).toEqual(['White', 'Black', 'Navy', 'Charcoal']);
  await press(page.locator('#cols button[title="Charcoal"]'), testInfo);
  await expect(page.locator('#mock [data-hat="trucker"]')).toHaveCount(1);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/hat\/charcoal-/);
  await expect.poll(() => page.locator('#mock img.blank').evaluate((el) => el.naturalWidth)).toBeGreaterThan(100);
  await expect(page.locator('#mock image')).toHaveCount(3);
  await page.locator('#mock').scrollIntoViewIfNeeded();
  if (testInfo.project.name === 'mobile') {
    const dir = process.env.SHOT_DIR || 'test-results/mobile';
    await mkdir(dir, { recursive: true });
    await page.locator('#mock').screenshot({ path: `${dir}/mobile_trucker_hat_mockup.png` });
  }
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#items')).toContainText('Trucker hat');
  await expect(page.locator('#items')).toContainText('Charcoal');
  await expect(page.locator('#items')).toContainText('One size');
  await expect(page.locator('#sub')).toHaveText('$33.00');
  await expect(page.locator('#cc')).toHaveText('1');
  await press(page.locator('#items button[data-remove="0"]'), testInfo);
  await expect(page.locator('#cc')).toHaveText('0');
  await press(page.locator('#closecart'), testInfo);

  await press(page.locator('#prods button[data-value="tee"]'), testInfo);
  await press(page.locator('#cols button[title="Black"]'), testInfo);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/tee\/black-/);
  await expect(page.locator('#mock')).toHaveAttribute('data-ink', 'dark');
  await press(page.locator('#sizes button[data-value="L"]'), testInfo);
  await expect(page.locator('#sizes button[data-value="L"]')).toHaveClass(/on/);
  await expect(page.locator('#price')).toContainText('$29.00');
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#cc')).toHaveText('1');
  await expect(page.locator('#sub')).toHaveText('$29.00');
  await expect(page.locator('#ship')).toHaveText('$5.99');
  await expect(page.locator('#tot')).toHaveText('$34.99');
  await expect(page.locator('#items')).toContainText('Black');
  await expect(page.locator('#items')).toContainText('L');
  await expect(page.locator('#items')).toContainText('triangle');
  await expect(page.locator('#items .item')).toHaveCount(1);
  await expect.poll(() => page.locator('#toast').evaluate((el) => Number.parseFloat(el.style.bottom))).toBeGreaterThan(20);
  const toastFit = await page.evaluate(() => {
    const toastBox = document.getElementById('toast').getBoundingClientRect();
    const pay = document.getElementById('pay').getBoundingClientRect();
    const sum = document.querySelector('#drawer .sum').getBoundingClientRect();
    const overlap = (a, b) => {
      const iw = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const ih = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return iw > 0 && ih > 0 ? ih : 0;
    };
    const item = document.querySelector('#items .item').getBoundingClientRect();
    const drawer = document.getElementById('drawer').getBoundingClientRect();
    return {
      shown: getComputedStyle(document.getElementById('toast')).display !== 'none',
      pay: overlap(toastBox, pay),
      sum: overlap(toastBox, sum),
      gap: sum.top - item.bottom,
      drawerTop: drawer.top,
      drawerHeight: drawer.height,
      vh: window.innerHeight,
      sumBottom: sum.bottom,
    };
  });
  expect(toastFit.shown).toBeTruthy();
  expect(toastFit.pay).toBeLessThan(8);
  expect(toastFit.sum).toBeLessThan(8);
  expect(toastFit.gap).toBeGreaterThan(-2);
  expect(toastFit.drawerTop).toBeLessThan(2);
  expect(Math.abs(toastFit.drawerHeight - toastFit.vh)).toBeLessThan(4);
  expect(toastFit.sumBottom).toBeGreaterThan(toastFit.vh - 40);
  await press(page.locator('#items button[data-qty="1"]'), testInfo);
  await expect(page.locator('#items .qty b')).toHaveText('2');
  await expect(page.locator('#cc')).toHaveText('2');
  await expect(page.locator('#items .item')).toHaveCount(1);
  await expect(page.locator('#sub')).toHaveText('$58.00');
  await expect(page.locator('#ship')).toHaveText('$5.99');
  await expect(page.locator('#tot')).toHaveText('$63.99');
  await press(page.locator('#items button[data-qty="1"]'), testInfo);
  await expect(page.locator('#sub')).toHaveText('$87.00');
  await expect(page.locator('#ship')).toHaveText('Free');
  await expect(page.locator('#tot')).toHaveText('$87.00');
  await press(page.locator('#items button[data-qty="-1"]'), testInfo);
  await press(page.locator('#items button[data-qty="-1"]'), testInfo);
  await expect(page.locator('#cc')).toHaveText('1');
  await expect(page.locator('#sub')).toHaveText('$29.00');
  await expect(page.locator('#ship')).toHaveText('$5.99');
  await expect(page.locator('#tot')).toHaveText('$34.99');
  await shot(page, testInfo, 'mobile-cart');

  await press(page.locator('#closecart'), testInfo);
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await press(page.locator('#cartbtn'), testInfo);
  await expect(page.locator('#drawer')).toHaveClass(/open/);

  await press(page.locator('#pay'), testInfo);
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  if (!live) await expect(page.locator('h1')).toHaveText('Stripe test checkout');
  else expect(page.url()).toContain('cs_test');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('emoji categories stay on the tapped tab', async ({ page }, testInfo) => {
  const errors = track(page);
  await page.goto('/');
  await expect(page.locator('#tabs button')).toHaveCount(9);
  await expect(page.locator('#tabs button.on')).toHaveCount(1);
  await expect(page.locator('#tabs button[data-cat="fu"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await expect(page.locator('#c_fu')).toBeAttached();
  const bar = await page.locator('#tabs').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { wrap: cs.flexWrap, overflowX: cs.overflowX, overscroll: cs.overscrollBehaviorX };
  });
  expect(bar.wrap).toBe('wrap');
  expect(bar.overflowX).toBe('auto');
  expect(bar.overscroll).toBe('contain');
  const tabsFit = await page.locator('#tabs').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.children].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.width > 8 && rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    });
  });
  expect(tabsFit).toBeTruthy();
  const pickerHeight = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().height);
  await press(page.locator('#tabs button[data-cat="fl"]'), testInfo);
  const flagsHeight = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().height);
  await press(page.locator('#tabs button[data-cat="fu"]'), testInfo);
  expect(Math.abs(pickerHeight - flagsHeight)).toBeLessThan(2);
  expect(pickerHeight).toBeGreaterThan(280);

  const rapid = await page.evaluate(() => {
    const ids = ['an', 'fd', 'ac', 'tp', 'ob', 'sy', 'fl', 'sp', 'fu'];
    for (const id of ids) {
      document.querySelector(`#tabs button[data-cat="${id}"]`).dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerType: 'touch', pointerId: 1, isPrimary: true,
      }));
    }
    const on = document.querySelector('#tabs button.on');
    return {
      on: on.dataset.cat,
      pressed: on.getAttribute('aria-pressed'),
      ons: document.querySelectorAll('#tabs button.on').length,
      cats: document.querySelectorAll('#grid .cat').length,
      id: document.querySelector('#grid .cat').id,
      top: document.getElementById('grid').scrollTop,
    };
  });
  expect(rapid).toEqual({ on: 'fu', pressed: 'true', ons: 1, cats: 1, id: 'c_fu', top: 0 });

  const stayed = await page.evaluate(() => {
    const bar = document.getElementById('tabs');
    const btn = bar.querySelector('[data-cat="an"]');
    const r = btn.getBoundingClientRect();
    const base = { bubbles: true, pointerType: 'touch', pointerId: 7, isPrimary: true, clientY: r.top + 12 };
    btn.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: r.left + 8 }));
    bar.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: r.left + 40 }));
    btn.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: r.left + 40 }));
    return document.querySelector('#tabs button.on').dataset.cat;
  });
  expect(stayed).toBe('fu');

  await page.locator('#grid button').first().evaluate((el) => { el.dataset.keep = '1'; });
  await press(page.locator('#tabs button[data-cat="fu"]'), testInfo);
  await expect(page.locator('#grid button[data-keep="1"]')).toHaveCount(1);

  await press(page.locator('#tabs button[data-cat="fl"]'), testInfo);
  await expect(page.locator('#c_fl')).toBeVisible();
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await expect(page.locator('#tabs button[data-cat="fl"]')).toHaveAttribute('aria-pressed', 'true');
  const chip = await page.locator('#tabs button[data-cat="fl"]').evaluate((el) => {
    const box = el.parentElement.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return rect.left >= box.left - 2 && rect.right <= box.right + 2;
  });
  expect(chip).toBeTruthy();
  await page.locator('#grid').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#tabs button.on')).toHaveAttribute('data-cat', 'fl');
  await expect(page.locator('#grid .cat')).toHaveCount(1);

  await page.locator('#q').fill('face');
  await expect.poll(() => page.locator('#grid .cat').count()).toBeGreaterThan(1);
  await press(page.locator('#tabs button[data-cat="an"]'), testInfo);
  await expect(page.locator('#q')).toHaveValue('');
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await expect(page.locator('#c_an')).toBeVisible();
  await expect(page.locator('#grid')).toHaveJSProperty('scrollTop', 0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('trucker logo fills the front panel', async ({ page }) => {
  const errors = track(page);
  await page.goto('/');
  async function logoBox() {
    return page.locator('#mock').evaluate((mock) => {
      const print = mock.querySelector('.print');
      const mockBox = mock.getBoundingClientRect();
      const images = [...print.querySelectorAll('image')].map((image) => image.getBoundingClientRect());
      const left = Math.min(...images.map((box) => box.left));
      const right = Math.max(...images.map((box) => box.right));
      const top = Math.min(...images.map((box) => box.top));
      const bottom = Math.max(...images.map((box) => box.bottom));
      const printBox = print.getBoundingClientRect();
      return {
        width: (right - left) / mockBox.width,
        height: (bottom - top) / mockBox.height,
        cx: ((left + right) / 2 - mockBox.left) / mockBox.width,
        cy: ((top + bottom) / 2 - mockBox.top) / mockBox.height,
        top: (top - mockBox.top) / mockBox.height,
        bottom: (bottom - mockBox.top) / mockBox.height,
        printAspect: printBox.width / printBox.height,
      };
    });
  }
  async function setSize(value) {
    await page.locator('#sz').evaluate((el, next) => {
      el.value = String(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }

  for (const product of ['tee', 'hoodie', 'mug']) {
    await clickReady(page, `#prods button[data-value="${product}"]`);
    await clickReady(page, '#lay button[data-value="row"]');
    await setSize(100);
    const placed = await logoBox();
    expect(placed.cx, product).toBeGreaterThan(0.42);
    expect(placed.cx, product).toBeLessThan(0.58);
    expect(placed.cy, product).toBeGreaterThan(0.28);
    expect(placed.cy, product).toBeLessThan(0.62);
    expect(placed.top, product).toBeGreaterThan(0.12);
    expect(placed.bottom, product).toBeLessThan(0.78);
  }

  await clickReady(page, '#prods button[data-value="hat"]');
  await clickReady(page, '#cols button[title="Navy"]');
  await clickReady(page, '#lay button[data-value="row"]');
  await setSize(100);
  const row = await logoBox();
  expect(row.printAspect).toBeGreaterThan(2.05);
  expect(row.printAspect).toBeLessThan(2.35);
  expect(row.width).toBeGreaterThan(0.58);
  expect(row.height).toBeGreaterThan(0.18);
  expect(row.cx).toBeGreaterThan(0.45);
  expect(row.cx).toBeLessThan(0.55);
  expect(row.cy).toBeGreaterThan(0.4);
  expect(row.cy).toBeLessThan(0.52);
  expect(row.top).toBeGreaterThan(0.24);
  expect(row.bottom).toBeLessThan(0.68);

  await setSize(60);
  const small = await logoBox();
  expect(small.width).toBeLessThan(row.width * 0.75);
  expect(small.cy).toBeGreaterThan(0.4);
  expect(small.cy).toBeLessThan(0.52);

  await setSize(100);
  await clickReady(page, '#lay button[data-value="stacked"]');
  const stacked = await logoBox();
  expect(stacked.height).toBeGreaterThan(0.28);
  expect(stacked.cy).toBeGreaterThan(0.4);
  expect(stacked.cy).toBeLessThan(0.52);
  expect(stacked.bottom).toBeLessThan(0.72);

  await clickReady(page, '#lay button[data-value="triangle"]');
  const triangle = await logoBox();
  expect(triangle.height).toBeGreaterThan(0.26);
  expect(triangle.width).toBeGreaterThan(0.28);
  expect(triangle.cy).toBeGreaterThan(0.4);
  expect(triangle.cy).toBeLessThan(0.52);

  async function insidePrint() {
    return page.locator('#mock').evaluate((mock) => {
      const print = mock.querySelector('.print').getBoundingClientRect();
      const images = [...mock.querySelectorAll('.print image')].map((image) => image.getBoundingClientRect());
      const left = Math.min(...images.map((box) => box.left));
      const right = Math.max(...images.map((box) => box.right));
      const top = Math.min(...images.map((box) => box.top));
      const bottom = Math.max(...images.map((box) => box.bottom));
      return { left: left - print.left, top: top - print.top, right: print.right - right, bottom: print.bottom - bottom };
    });
  }
  async function insideMock() {
    return page.locator('#mock').evaluate((mock) => {
      const box = mock.getBoundingClientRect();
      const images = [...mock.querySelectorAll('.print image')].map((image) => image.getBoundingClientRect());
      return {
        left: Math.min(...images.map((item) => item.left)) - box.left,
        top: Math.min(...images.map((item) => item.top)) - box.top,
        right: box.right - Math.max(...images.map((item) => item.right)),
        bottom: box.bottom - Math.max(...images.map((item) => item.bottom)),
      };
    });
  }
  for (const layout of ['row', 'stacked', 'triangle']) {
    await clickReady(page, `#lay button[data-value="${layout}"]`);
    await setSize(140);
    const inset = await insidePrint();
    expect(inset.left, `hat ${layout}`).toBeGreaterThan(1);
    expect(inset.top, `hat ${layout}`).toBeGreaterThan(1);
    expect(inset.right, `hat ${layout}`).toBeGreaterThan(1);
    expect(inset.bottom, `hat ${layout}`).toBeGreaterThan(1);
    const onHat = await insideMock();
    expect(onHat.left, `hat mock ${layout}`).toBeGreaterThan(2);
    expect(onHat.top, `hat mock ${layout}`).toBeGreaterThan(2);
    expect(onHat.right, `hat mock ${layout}`).toBeGreaterThan(2);
    expect(onHat.bottom, `hat mock ${layout}`).toBeGreaterThan(2);
  }
  await clickReady(page, '#prods button[data-value="mug"]');
  for (const layout of ['stacked', 'triangle']) {
    await clickReady(page, `#lay button[data-value="${layout}"]`);
    await setSize(140);
    const inset = await insidePrint();
    expect(inset.left, `mug ${layout}`).toBeGreaterThan(-1);
    expect(inset.top, `mug ${layout}`).toBeGreaterThan(-1);
    expect(inset.right, `mug ${layout}`).toBeGreaterThan(-1);
    expect(inset.bottom, `mug ${layout}`).toBeGreaterThan(-1);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('product preview stays beside the choices and inside the builder', async ({ page }, testInfo) => {
  const errors = track(page);
  await page.goto('/');
  await expect(page.locator('#mock img.blank')).toBeVisible();
  const mobile = testInfo.project.use.isMobile === true;
  await page.locator('#flow button[data-step="product"]').click();
  if (mobile) {
    const frame = await page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const steps = document.querySelector('.steps').getBoundingClientRect();
      const prods = document.querySelector('#prods').getBoundingClientRect();
      return {
        stageTop: stage.top,
        stepsTop: steps.top,
        mockH: mock.height,
        mockW: mock.width,
        vw: window.innerWidth,
        prodsTop: prods.top,
        photo: document.querySelector('#mock img.blank').currentSrc || document.querySelector('#mock img.blank').src,
      };
    });
    expect(frame.stepsTop).toBeGreaterThan(frame.stageTop + 40);
    expect(frame.prodsTop).toBeGreaterThan(frame.stageTop);
    expect(frame.mockH).toBeGreaterThan(frame.vw * 0.35);
    expect(frame.mockW).toBeGreaterThan(120);
    expect(frame.photo).toContain('/tee/');
    await page.evaluate(() => { document.querySelector('.steps').scrollTop = 240; });
    const stayed = await page.evaluate(() => {
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const grid = document.querySelector('#grid');
      return { top: mock.top, bottom: mock.bottom, vh: window.innerHeight, gridTop: grid ? grid.getBoundingClientRect().top : 0 };
    });
    expect(stayed.top).toBeGreaterThan(0);
    expect(stayed.bottom).toBeLessThan(stayed.vh);
    await expect(page.locator('#minislot')).not.toHaveClass(/on/);
    await expect(page.locator('#stagepin')).not.toHaveClass(/is-floating/);
  } else {
    const gap = await page.evaluate(() => {
      const card = document.querySelector('.product-controls').getBoundingClientRect();
      const mock = document.querySelector('#mock').getBoundingClientRect();
      return {
        hGap: card.left - mock.right,
        beside: mock.top < card.bottom && mock.bottom > card.top,
      };
    });
    expect(gap.beside).toBeTruthy();
    expect(gap.hGap).toBeGreaterThan(12);
    expect(gap.hGap).toBeLessThan(280);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    await page.locator('#flow button[data-step="pick"]').click();
    await page.locator('#builder').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, 180));
    const stuck = await page.evaluate(() => {
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const pick = document.querySelector('#step-pick').getBoundingClientRect();
      return { mockTop: mock.top, bar, pickTop: pick.top, mockBottom: mock.bottom };
    });
    expect(stuck.pickTop).toBeLessThan(stuck.mockBottom);
    expect(stuck.mockTop).toBeGreaterThan(stuck.bar - 2);
    expect(stuck.mockTop).toBeLessThan(stuck.bar + 80);
    await clickReady(page, '#prods button[data-value="hoodie"]');
    await page.locator('#builder').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const capped = await page.evaluate(() => {
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const cap = document.querySelector('.mockcap').getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      return {
        top: mock.top,
        bottom: mock.bottom,
        capTop: cap.top,
        capBottom: cap.bottom,
        bar,
        vh: window.innerHeight,
        fit: getComputedStyle(document.querySelector('#mock img.blank')).objectFit,
        product: document.querySelector('#mock').dataset.product,
      };
    });
    expect(capped.product).toBe('hoodie');
    expect(capped.fit).toBe('contain');
    expect(capped.top).toBeGreaterThan(capped.bar - 2);
    expect(capped.bottom).toBeLessThanOrEqual(capped.vh + 1);
    expect(capped.capTop).toBeGreaterThan(capped.bottom - 2);
    expect(capped.capBottom).toBeLessThanOrEqual(capped.vh + 1);
  }

  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.locator('footer').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await expect(page.locator('#stagepin')).not.toHaveClass(/is-floating/);
  const clear = await page.evaluate(() => {
    const mock = document.querySelector('#mock').getBoundingClientRect();
    const footer = document.querySelector('footer').getBoundingClientRect();
    return Math.min(mock.bottom, footer.bottom) - Math.max(mock.top, footer.top);
  });
  expect(clear).toBeLessThan(8);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reduced motion keeps the page still and tappable', async ({ page }) => {
  const errors = track(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#heroart img')).toHaveCount(3);
  const motion = await page.locator('#heroart').evaluate((el) => getComputedStyle(el).animationName);
  expect(motion).toBe('none');
  await expect(page.locator('#try button')).toHaveCount(10);
  await expect(page.locator('a.btn[href="#builder"]')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
