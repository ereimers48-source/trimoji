import { expect, test } from '@playwright/test';
import { printfulExternalId } from '../lib/printful.js';

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
    if (reason.includes('ERR_ABORTED') || reason.includes('Load request cancelled')) return;
    if (url.includes('jsdelivr.net') || url.includes('twemoji') || url.includes('favicon')) {
      errors.push(`asset ${reason} ${url}`);
    }
  });
  return errors;
}

async function press(locator, testInfo) {
  await locator.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
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

test('configurator, bag, and Stripe checkout', async ({ page }, testInfo) => {
  const errors = track(page);
  if (!live) {
    await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stripe test checkout</title><h1>Stripe test checkout</h1>',
    }));
  }

  await page.goto('/shop-preview');
  await expect(page.locator('.hero h1')).toContainText('Three emojis.');
  await expect(page.locator('.hero h1')).toContainText('One you.');
  await expect(page).toHaveTitle('Trimoji — Three emojis. One you.');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /three emojis/i);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://trimojiapparel.com/assets/og.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('a.btn[href="#shop"]')).toHaveCount(1);
  await expect(page.locator('#mock image')).toHaveCount(3);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/tee\/white-/);
  await expect.poll(() => page.locator('#mock img.blank').evaluate((el) => el.naturalWidth)).toBeGreaterThan(100);
  await expect(page.locator('#herophoto')).toHaveCount(0);
  await expect(page.locator('.hero-shot')).toHaveCount(0);
  const heroGap = await page.evaluate(() => {
    const start = document.querySelector('a.btn[href="#shop"]').getBoundingClientRect();
    const build = document.querySelector('#shop h2').getBoundingClientRect();
    return build.top - start.bottom;
  });
  expect(heroGap).toBeGreaterThan(8);
  expect(heroGap).toBeLessThan(140);
  await expect(page.locator('#testmode')).toBeVisible();
  await expect(page.locator('#testmode')).toContainText('Test mode');
  await expect(page.locator('body')).not.toContainText('sk_');
  await expect(page.locator('body')).not.toContainText('Made when you order');
  await expect(page.locator('body')).not.toContainText('Card details stay on Stripe');
  await expect(page.locator('body')).not.toContainText('Printed by Printful');
  await expect(page.locator('body')).not.toContainText('Before you pay');
  await expect(page.locator('#showcase')).toHaveCount(0);
  await expect(page.locator('#sizecap')).toContainText('Scales the trio');
  await expect(page.locator('#price')).toContainText('$29.00');
  await expect(page.locator('#price')).not.toContainText('free shipping');
  const shippingCopies = await page.locator('body').evaluate((el) => (el.innerText.match(/\$5\.99 flat, free over \$60/g) || []).length);
  expect(shippingCopies).toBe(1);
  const buyPos = await page.locator('.buybar').evaluate((el) => getComputedStyle(el).position);
  expect(buyPos).not.toBe('fixed');
  expect(buyPos).not.toBe('sticky');
  const touchAction = await page.locator('#lay button').first().evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toBe('manipulation');
  const blur = await page.locator('.nav').evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(blur === 'none' || blur === '').toBeTruthy();
  const addBox = await page.locator('#addbtn').boundingBox();
  expect(addBox.height).toBeGreaterThanOrEqual(44);

  const initial = await logoImages(page);
  expect(initial).toHaveLength(3);
  for (const image of initial) {
    expect(image.href).toContain('/72x72/');
    expect(image.href.endsWith('.png')).toBeTruthy();
    expect(image.xlink).toBe(image.href);
  }
  expect(new Set(initial.map((image) => image.y)).size).toBe(1);

  await press(page.locator('a.btn[href="#shop"]'), testInfo);
  await expect(page).toHaveURL(/#shop/);
  for (let n = 0; n < 3; n += 1) await press(page.locator('#slots [data-clear]').first(), testInfo);
  await expect(page.locator('#slots button.f')).toHaveCount(0);
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#toast')).toContainText('at least 1');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);

  await page.locator('#q').fill('pizza');
  await expect(page.locator('#grid button[title="pizza"]')).toBeVisible();
  await press(page.locator('#grid button[title="pizza"]'), testInfo);
  await page.locator('#q').fill('fire');
  await press(page.locator('#grid button[title="fire"]'), testInfo);
  await page.locator('#q').fill('');
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await press(page.locator('#tabs button[data-cat="sp"]'), testInfo);
  await press(page.locator('#grid button[title="smiling face with sunglasses"]').first(), testInfo);
  await expect(page.locator('#slots button.f')).toHaveCount(3);
  const slotHit = await page.locator('#slots button.slot-clear').first().evaluate((el) => el.getBoundingClientRect());
  expect(slotHit.width).toBeGreaterThanOrEqual(40);
  expect(slotHit.height).toBeGreaterThanOrEqual(40);

  await press(page.locator('#lay button[data-value="triangle"]'), testInfo);
  await expect(page.locator('#lay button[data-value="triangle"]')).toHaveClass(/on/);
  const triangle = await logoImages(page);
  expect(new Set(triangle.map((image) => image.y)).size).toBeGreaterThan(1);
  await press(page.locator('#lay button[data-value="stacked"]'), testInfo);
  const stacked = await logoImages(page);
  expect(new Set(stacked.map((image) => Math.round(image.x))).size).toBe(1);
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

  await expect(page.getByRole('heading', { name: 'Backdrop' })).toHaveCount(0);
  await expect(page.locator('#bgs')).toHaveCount(0);
  await expect(page.locator('#mock circle')).toHaveCount(0);

  const productRows = await page.locator('#prods').evaluate((el) => {
    const rows = new Map();
    for (const child of el.children) {
      const top = Math.round(child.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) || 0) + 1);
    }
    return [...rows.values()];
  });
  expect(productRows.reduce((sum, count) => sum + count, 0)).toBe(5);
  expect(productRows.slice(0, -1).every((count) => count > 1)).toBeTruthy();

  await press(page.locator('#prods button[data-value="hoodie"]'), testInfo);
  await expect(page.locator('#price')).toContainText('$54.00');
  await expect(page.locator('#cols button')).toHaveCount(5);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/hoodie\//);
  await press(page.locator('#prods button[data-value="mug"]'), testInfo);
  await expect(page.locator('#price')).toContainText('$19.00');
  await expect(page.locator('#sizes button')).toHaveText('11 oz');
  await press(page.locator('#prods button[data-value="hat"]'), testInfo);
  await expect(page.locator('#prods button[data-value="hat"]')).toHaveText('Trucker hat');
  await expect(page.locator('#price')).toContainText('$33.00');
  await expect(page.locator('#sizes button')).toHaveText('One size');
  await expect(page.locator('#unavail')).toBeHidden();
  const hatColors = await page.locator('#cols button').evaluateAll((els) => els.map((el) => el.title));
  expect(hatColors).toEqual(['White', 'Black', 'Navy', 'Charcoal']);
  await press(page.locator('#cols button[title="Charcoal"]'), testInfo);
  await expect(page.locator('#mock [data-hat="trucker"]')).toHaveCount(1);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/hat\/charcoal-/);
  await expect.poll(() => page.locator('#mock img.blank').evaluate((el) => el.naturalWidth)).toBeGreaterThan(100);

  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#items')).toContainText('Trucker hat');
  await expect(page.locator('#sub')).toHaveText('$33.00');
  await press(page.locator('#items button[data-remove="0"]'), testInfo);
  await expect(page.locator('#cc')).toHaveText('0');
  await press(page.locator('#closecart'), testInfo);

  await press(page.locator('#prods button[data-value="case"]'), testInfo);
  await expect(page.locator('#prods button[data-value="case"]')).toHaveText('Tough phone case');
  await expect(page.locator('#price')).toContainText('$29.00');
  await expect(page.locator('#colorhead')).toHaveText('Finish');
  await expect(page.locator('#sizehead')).toHaveText('Model');
  await expect(page.locator('#model option')).toHaveCount(14);
  await expect(page.locator('#model')).toHaveValue('iPhone 16');
  await page.locator('#model').selectOption('iPhone 17 Pro Max');
  await expect(page.locator('#model')).toHaveValue('iPhone 17 Pro Max');
  const finishes = await page.locator('#cols button').evaluateAll((els) => els.map((el) => el.textContent));
  expect(finishes).toEqual(['Glossy', 'Matte']);
  await press(page.locator('#cols button', { hasText: 'Matte' }), testInfo);
  await expect(page.locator('#mock')).toHaveAttribute('data-product', 'case');
  await expect(page.locator('#mock')).toHaveAttribute('data-finish', 'matte');
  await expect(page.locator('#mock [data-hat="trucker"]')).toHaveCount(0);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/case\/white\.svg$/);
  await expect.poll(() => page.locator('#mock img.blank').evaluate((el) => el.naturalWidth)).toBeGreaterThan(100);
  await expect(page.locator('#mock circle')).toHaveCount(0);
  const caseArt = await logoImages(page);
  expect(caseArt).toHaveLength(3);
  expect(Math.min(...caseArt.map((image) => image.y))).toBeGreaterThanOrEqual(2220 * 0.28 - 1);
  for (const layout of ['Row', 'Triangle', 'Stacked']) {
    await press(page.locator('#lay button', { hasText: layout }), testInfo);
    const placed = await page.locator('#mock image').evaluateAll((els) => {
      const boxes = els.map((el) => {
        const y = Number(el.getAttribute('y'));
        const x = Number(el.getAttribute('x'));
        const h = Number(el.getAttribute('height'));
        const w = Number(el.getAttribute('width'));
        const screen = el.getBoundingClientRect();
        return { top: y, bottom: y + h, left: x, right: x + w, screen };
      });
      const mock = document.getElementById('mock').getBoundingClientRect();
      return {
        top: Math.min(...boxes.map((box) => box.top)),
        bottom: Math.max(...boxes.map((box) => box.bottom)),
        left: Math.min(...boxes.map((box) => box.left)),
        right: Math.max(...boxes.map((box) => box.right)),
        screenTop: Math.min(...boxes.map((box) => box.screen.top)),
        screenBottom: Math.max(...boxes.map((box) => box.screen.bottom)),
        screenLeft: Math.min(...boxes.map((box) => box.screen.left)),
        screenRight: Math.max(...boxes.map((box) => box.screen.right)),
        mockTop: mock.top,
        mockBottom: mock.bottom,
        mockLeft: mock.left,
        mockRight: mock.right,
        mockHeight: mock.height,
      };
    });
    expect(placed.top, layout).toBeGreaterThanOrEqual(2220 * 0.28 - 1);
    expect(placed.bottom, layout).toBeLessThanOrEqual(2220 * 0.84 + 1);
    expect(placed.left, layout).toBeGreaterThan(4);
    expect(placed.right, layout).toBeLessThan(1392 - 4);
    expect(placed.screenTop, layout).toBeGreaterThanOrEqual(placed.mockTop - 1);
    expect(placed.screenBottom, layout).toBeLessThanOrEqual(placed.mockBottom + 1);
    expect(placed.screenLeft, layout).toBeGreaterThanOrEqual(placed.mockLeft - 1);
    expect(placed.screenRight, layout).toBeLessThanOrEqual(placed.mockRight + 1);
    expect(placed.mockBottom - placed.screenBottom, layout).toBeGreaterThan(placed.mockHeight * 0.08);
  }
  await press(page.locator('#lay button', { hasText: 'Row' }), testInfo);
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#items')).toContainText('Tough phone case');
  await expect(page.locator('#items')).toContainText('Matte');
  await expect(page.locator('#items')).toContainText('iPhone 17 Pro Max');
  await expect(page.locator('#sub')).toHaveText('$29.00');
  await expect(page.locator('#ship')).toHaveText('$5.99');
  await expect(page.locator('#tot')).toHaveText('$34.99');
  await press(page.locator('#items button[data-remove="0"]'), testInfo);
  await expect(page.locator('#cc')).toHaveText('0');
  await press(page.locator('#closecart'), testInfo);

  await press(page.locator('#prods button[data-value="tee"]'), testInfo);
  await press(page.locator('#cols button[title="Black"]'), testInfo);
  await expect(page.locator('#mock img.blank')).toHaveAttribute('src', /\/tee\/black-/);
  await expect(page.locator('#mock')).toHaveAttribute('data-ink', 'dark');
  await press(page.locator('#sizes button[data-value="L"]'), testInfo);
  await expect(page.locator('#price')).toContainText('$29.00');
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#sub')).toHaveText('$29.00');
  await expect(page.locator('#ship')).toHaveText('$5.99');
  await expect(page.locator('#tot')).toHaveText('$34.99');
  await expect(page.locator('#items')).toContainText('Black');
  await expect(page.locator('#items')).toContainText('L');
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
    const drawer = document.getElementById('drawer').getBoundingClientRect();
    return {
      pay: overlap(toastBox, pay),
      sum: overlap(toastBox, sum),
      drawerTop: drawer.top,
      drawerHeight: drawer.height,
      vh: window.innerHeight,
      sumBottom: sum.bottom,
    };
  });
  expect(toastFit.pay).toBeLessThan(8);
  expect(toastFit.sum).toBeLessThan(8);
  expect(toastFit.drawerTop).toBeLessThan(2);
  expect(Math.abs(toastFit.drawerHeight - toastFit.vh)).toBeLessThan(4);
  expect(toastFit.sumBottom).toBeGreaterThan(toastFit.vh - 80);
  await press(page.locator('#items button[data-qty="1"]'), testInfo);
  await expect(page.locator('#items .qty b')).toHaveText('2');
  await press(page.locator('#items button[data-qty="1"]'), testInfo);
  await expect(page.locator('#sub')).toHaveText('$87.00');
  await expect(page.locator('#ship')).toHaveText('Free');
  await expect(page.locator('#tot')).toHaveText('$87.00');
  await press(page.locator('#items button[data-qty="-1"]'), testInfo);
  await press(page.locator('#items button[data-qty="-1"]'), testInfo);
  await expect(page.locator('#ship')).toHaveText('$5.99');
  await expect(page.locator('#tot')).toHaveText('$34.99');

  await press(page.locator('#pay'), testInfo);
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  if (!live) await expect(page.locator('h1')).toHaveText('Stripe test checkout');
  else expect(page.url()).toContain('cs_test');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('emoji categories stay on the tapped tab', async ({ page }, testInfo) => {
  const errors = track(page);
  await page.goto('/shop-preview');
  await expect(page.locator('#tabs button')).toHaveCount(9);
  await expect(page.locator('#tabs button.on')).toHaveCount(1);
  await expect(page.locator('#tabs button[data-cat="fu"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await page.locator('#tabs').scrollIntoViewIfNeeded();
  await page.evaluate(() => syncPin());
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
  if (testInfo.project.use.isMobile === true) expect(flagsHeight).toBeGreaterThan(pickerHeight + 80);
  else expect(Math.abs(pickerHeight - flagsHeight)).toBeLessThan(8);
  expect(pickerHeight).toBeGreaterThan(40);

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

  await page.locator('#q').fill('face');
  await expect.poll(() => page.locator('#grid .cat').count()).toBeGreaterThan(1);
  await press(page.locator('#tabs button[data-cat="an"]'), testInfo);
  await expect(page.locator('#q')).toHaveValue('');
  await expect(page.locator('#grid .cat')).toHaveCount(1);
  await expect(page.locator('#c_an')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('trucker logo fills the front panel', async ({ page }) => {
  const errors = track(page);
  await page.goto('/shop-preview');
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
        printWidth: printBox.width ? (right - left) / printBox.width : 0,
        printHeight: printBox.height ? (bottom - top) / printBox.height : 0,
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
    await page.locator(`#prods button[data-value="${product}"]`).click();
    await page.locator('#lay button[data-value="row"]').click();
    await setSize(100);
    const placed = await logoBox();
    expect(placed.cx, product).toBeGreaterThan(0.42);
    expect(placed.cx, product).toBeLessThan(0.58);
    expect(placed.cy, product).toBeGreaterThan(0.28);
    expect(placed.cy, product).toBeLessThan(0.62);
    expect(placed.top, product).toBeGreaterThan(0.12);
    expect(placed.bottom, product).toBeLessThan(0.78);
    expect(placed.printWidth, product).toBeGreaterThan(0.9);
    expect(placed.printWidth, product).toBeLessThan(0.99);
  }
  await page.locator('#prods button[data-value="tee"]').click();
  await page.locator('#lay button[data-value="row"]').click();
  expect(await page.locator('#sz').inputValue()).toBe('100');
  await setSize(60);
  const teeSmall = await logoBox();
  await setSize(100);
  const teeFull = await logoBox();
  expect(teeSmall.printWidth).toBeLessThan(teeFull.printWidth * 0.75);
  expect(teeSmall.printWidth).toBeGreaterThan(teeFull.printWidth * 0.5);
  await setSize(140);
  const teeMax = await logoBox();
  expect(teeMax.printWidth).toBeGreaterThan(teeFull.printWidth * 0.97);
  expect(teeMax.printWidth).toBeLessThan(1);
  await page.locator('#lay button[data-value="triangle"]').click();
  await setSize(100);
  const teeTri = await logoBox();
  await setSize(140);
  const teeTriMax = await logoBox();
  expect(teeTriMax.height).toBeGreaterThan(teeTri.height * 1.15);
  await setSize(100);
  await page.locator('#lay button[data-value="row"]').click();
  await page.locator('#prods button[data-value="hat"]').click();
  await page.locator('#cols button[title="Navy"]').click();
  await page.locator('#lay button[data-value="row"]').click();
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
  await setSize(60);
  const small = await logoBox();
  expect(small.width).toBeLessThan(row.width * 0.75);
  await setSize(100);
  await page.locator('#lay button[data-value="stacked"]').click();
  const stacked = await logoBox();
  expect(stacked.height).toBeGreaterThan(0.28);
  expect(stacked.cy).toBeGreaterThan(0.4);
  expect(stacked.cy).toBeLessThan(0.52);
  await page.locator('#lay button[data-value="triangle"]').click();
  const triangle = await logoBox();
  expect(triangle.height).toBeGreaterThan(0.26);
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
  for (const layout of ['row', 'stacked', 'triangle']) {
    await page.locator(`#lay button[data-value="${layout}"]`).click();
    await setSize(140);
    const inset = await insidePrint();
    expect(inset.left, `hat ${layout}`).toBeGreaterThan(1);
    expect(inset.top, `hat ${layout}`).toBeGreaterThan(1);
    expect(inset.right, `hat ${layout}`).toBeGreaterThan(1);
    expect(inset.bottom, `hat ${layout}`).toBeGreaterThan(1);
  }
  await page.locator('#prods button[data-value="mug"]').click();
  for (const layout of ['stacked', 'triangle']) {
    await page.locator(`#lay button[data-value="${layout}"]`).click();
    await setSize(140);
    const inset = await insidePrint();
    expect(inset.left, `mug ${layout}`).toBeGreaterThan(-1);
    expect(inset.top, `mug ${layout}`).toBeGreaterThan(-1);
    expect(inset.right, `mug ${layout}`).toBeGreaterThan(-1);
    expect(inset.bottom, `mug ${layout}`).toBeGreaterThan(-1);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('preview sits with the choices and the bag button stays in the page', async ({ page }, testInfo) => {
  const errors = track(page);
  await page.goto('/shop-preview');
  await expect(page.locator('#mock img.blank')).toBeVisible();
  await expect(page.locator('#testmode')).toBeVisible();
  await page.evaluate(() => fitBar());
  const mobile = testInfo.project.use.isMobile === true;
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  if (mobile) {
    const openPreview = await page.evaluate(() => document.querySelector('#stage').getBoundingClientRect().height / window.innerHeight);
    expect(openPreview).toBeGreaterThan(0.37);
    expect(openPreview).toBeLessThan(0.43);
    await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      window.scrollTo(0, stage.getBoundingClientRect().top + window.scrollY - bar);
      syncPin();
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('compact'))).toBeTruthy();
    await page.evaluate(() => new Promise((resolve) => {
      const stage = document.getElementById('stage');
      let last = -1;
      let stable = 0;
      let frames = 0;
      function tick() {
        const height = stage.getBoundingClientRect().height;
        if (Math.abs(height - last) < 0.5) stable += 1;
        else stable = 0;
        last = height;
        frames += 1;
        if (stable >= 4 || frames > 90) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }));
    const frame = await page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const slots = document.querySelector('#slots').getBoundingClientRect();
      const search = document.querySelector('#q').getBoundingClientRect();
      const grid = document.querySelector('#grid').getBoundingClientRect();
      const gridEl = document.querySelector('#grid');
      const buy = document.querySelector('.buybar');
      const vh = window.innerHeight;
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const logos = [...document.querySelectorAll('#mock image')].map((el) => el.getBoundingClientRect());
      const pinBottom = slots.bottom;
      return {
        sticky: getComputedStyle(document.querySelector('#stage')).position,
        slotsSticky: getComputedStyle(document.querySelector('#slotbar')).position,
        searchPos: getComputedStyle(document.querySelector('#q')).position,
        gridPos: getComputedStyle(gridEl).position,
        choicePos: getComputedStyle(document.querySelector('#emoji-choice')).position,
        stageTop: stage.top,
        stageBottom: stage.bottom,
        stageH: stage.height,
        pinH: pinBottom - stage.top,
        gridOverflow: getComputedStyle(gridEl).overflowY,
        mock: { top: mock.top, bottom: mock.bottom, left: mock.left, right: mock.right, width: mock.width, height: mock.height },
        slots: { top: slots.top, bottom: slots.bottom },
        chips: [...document.querySelectorAll('#slots .slot')].map((el) => {
          const r = el.getBoundingClientRect();
          const img = el.querySelector('img.em');
          const ir = img ? img.getBoundingClientRect() : null;
          return { w: r.width, h: r.height, emoji: ir ? ir.width : 0 };
        }),
        search: { top: search.top, bottom: search.bottom, height: search.height },
        grid: { top: grid.top, bottom: grid.bottom, height: grid.height },
        vh,
        vw: window.innerWidth,
        bar,
        fit: getComputedStyle(document.querySelector('#mock img.blank')).objectFit,
        logos: logos.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height })),
        buyPos: getComputedStyle(buy).position,
        fixedBuy: [...document.querySelectorAll('body *')].some((el) => {
          const pos = getComputedStyle(el).position;
          return pos === 'fixed' && (el.id === 'addbtn' || el.classList.contains('buybar'));
        }),
        captionInStage: !!document.querySelector('#stage #sizecap'),
      };
    });
    expect(frame.sticky).toBe('sticky');
    expect(frame.slotsSticky).toBe('sticky');
    expect(frame.searchPos).toBe('static');
    expect(frame.gridPos).toBe('static');
    expect(frame.choicePos).toBe('static');
    expect(frame.stageTop).toBeGreaterThanOrEqual(frame.bar - 2);
    expect(frame.stageTop).toBeLessThan(frame.bar + 4);
    expect(frame.stageH).toBeGreaterThanOrEqual(168);
    expect(frame.stageH / frame.vh).toBeGreaterThan(0.18);
    expect(frame.stageH / frame.vh).toBeLessThan(0.32);
    expect(frame.stageH / frame.vh).toBeLessThan(openPreview - 0.08);
    expect(frame.pinH / frame.vh).toBeGreaterThan(0.18);
    expect(frame.pinH / frame.vh).toBeLessThan(0.46);
    expect(frame.pinH / frame.vh).toBeLessThan(0.55);
    expect(frame.mock.top).toBeGreaterThanOrEqual(frame.stageTop - 1);
    expect(frame.mock.top - frame.stageTop).toBeLessThan(2);
    expect(frame.mock.bottom).toBeLessThanOrEqual(frame.stageBottom + 1);
    expect(frame.stageBottom - frame.mock.bottom).toBeLessThan(2);
    expect(frame.mock.bottom).toBeLessThanOrEqual(frame.vh + 1);
    expect(frame.mock.left).toBeGreaterThanOrEqual(-1);
    expect(frame.mock.right).toBeLessThanOrEqual(frame.vw + 1);
    expect(frame.mock.height).toBeGreaterThan(frame.stageH * 0.97);
    expect(frame.fit).toBe('contain');
    expect(frame.logos.length).toBe(3);
    for (const logo of frame.logos) {
      expect(logo.width).toBeGreaterThan(4);
      expect(logo.height).toBeGreaterThan(4);
      expect(logo.top).toBeGreaterThanOrEqual(frame.mock.top - 1);
      expect(logo.bottom).toBeLessThanOrEqual(frame.mock.bottom + 1);
      expect(logo.left).toBeGreaterThanOrEqual(frame.mock.left - 1);
      expect(logo.right).toBeLessThanOrEqual(frame.mock.right + 1);
    }
    expect(frame.slots.top).toBeGreaterThanOrEqual(frame.stageBottom - 2);
    expect(frame.slots.bottom).toBeLessThanOrEqual(frame.vh + 1);
    expect(frame.chips).toHaveLength(3);
    for (const chip of frame.chips) {
      expect(Math.abs(chip.w - chip.h)).toBeLessThan(1.5);
      expect(chip.w).toBeGreaterThan(72);
      expect(chip.emoji).toBeGreaterThan(48);
      expect(chip.emoji).toBeGreaterThan(chip.w * 0.55);
    }
    expect(frame.search.top).toBeGreaterThanOrEqual(frame.slots.bottom - 4);
    expect(frame.search.bottom).toBeLessThanOrEqual(frame.vh + 1);
    expect(frame.search.height).toBeGreaterThanOrEqual(44);
    expect(frame.grid.top).toBeGreaterThanOrEqual(frame.search.bottom - 4);
    expect(frame.grid.height).toBeGreaterThan(40);
    expect(frame.gridOverflow).toBe('visible');
    expect(frame.buyPos).toBe('static');
    expect(frame.fixedBuy).toBeFalsy();
    expect(frame.captionInStage).toBeFalsy();
    const before = await logoImages(page);
    await press(page.locator('#grid button[data-emoji="❤️"]'), testInfo);
    const after = await logoImages(page);
    expect(after.map((image) => image.href).join('|')).not.toBe(before.map((image) => image.href).join('|'));
    const still = await page.evaluate(() => {
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const vh = window.innerHeight;
      return [...document.querySelectorAll('#mock image')].every((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.top >= mock.top - 1 && r.bottom <= mock.bottom + 1 && r.bottom <= vh + 1 && r.top >= 0;
      });
    });
    expect(still).toBeTruthy();
    for (const target of ['#prods', '#cols', '#sizes']) {
      await page.locator(`${target} button`).first().evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
      await page.evaluate(() => new Promise((resolve) => {
        const stage = document.getElementById('stage');
        let last = -1;
        let stable = 0;
        let frames = 0;
        function tick() {
          const height = stage.getBoundingClientRect().height;
          if (Math.abs(height - last) < 0.5) stable += 1;
          else stable = 0;
          last = height;
          frames += 1;
          if (stable >= 3 || frames > 90) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }));
      const pinned = await page.evaluate((selector) => {
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const slots = document.querySelector('#slots').getBoundingClientRect();
        const search = document.querySelector('#q').getBoundingClientRect();
        const grid = document.querySelector('#grid').getBoundingClientRect();
        const mock = document.querySelector('#mock').getBoundingClientRect();
        const section = document.querySelector(`${selector} button`).getBoundingClientRect();
        const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
        const vh = window.innerHeight;
        const logos = [...document.querySelectorAll('#mock image')];
        const pinBottom = slots.bottom;
        const covers = (a, b) => a.bottom > b.top + 8 && a.top < b.bottom - 8 && a.right > b.left && a.left < b.right;
        return {
          stuck: Math.abs(stage.top - bar) < 4,
          compact: document.documentElement.classList.contains('compact'),
          slotsSticky: getComputedStyle(document.querySelector('#slotbar')).position === 'sticky',
          searchStatic: getComputedStyle(document.querySelector('#q')).position === 'static',
          gridStatic: getComputedStyle(document.querySelector('#grid')).position === 'static',
          pinRatio: (pinBottom - stage.top) / vh,
          slotsUnder: slots.top >= stage.bottom - 2 && slots.top <= stage.bottom + 3,
          sectionTop: section.top,
          pinBottom,
          searchCovers: covers(search, section),
          gridCovers: covers(grid, section),
          mockTop: mock.top,
          mockBottom: mock.bottom,
          vh,
          logosIn: logos.every((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 4 && r.top >= mock.top - 1 && r.bottom <= Math.min(mock.bottom, vh) + 1;
          }),
        };
      }, target);
      expect(pinned.stuck, target).toBeTruthy();
      expect(pinned.compact, target).toBeTruthy();
      expect(pinned.slotsSticky, target).toBeTruthy();
      expect(pinned.searchStatic, target).toBeTruthy();
      expect(pinned.gridStatic, target).toBeTruthy();
      expect(pinned.pinRatio, target).toBeLessThan(0.55);
      expect(pinned.pinRatio, target).toBeLessThan(0.46);
      expect(pinned.slotsUnder, target).toBeTruthy();
      expect(pinned.searchCovers, target).toBeFalsy();
      expect(pinned.gridCovers, target).toBeFalsy();
      expect(pinned.sectionTop, target).toBeGreaterThanOrEqual(pinned.pinBottom - 8);
      expect(pinned.mockTop).toBeGreaterThanOrEqual(0);
      expect(pinned.mockBottom).toBeLessThanOrEqual(pinned.vh + 1);
      expect(pinned.logosIn, target).toBeTruthy();
    }
  } else {
    const gap = await page.evaluate(() => {
      const choices = document.querySelector('.choices').getBoundingClientRect();
      const mock = document.querySelector('#mock').getBoundingClientRect();
      return { hGap: choices.left - mock.right, beside: mock.top < choices.bottom && mock.bottom > choices.top };
    });
    expect(gap.beside).toBeTruthy();
    expect(gap.hGap).toBeGreaterThan(12);
    expect(gap.hGap).toBeLessThan(280);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    await page.locator('#shop').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, 180));
    const stuck = await page.evaluate(() => {
      const mock = document.querySelector('#mock').getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const logos = [...document.querySelectorAll('#mock image')].map((el) => el.getBoundingClientRect());
      return {
        mockTop: mock.top,
        bar,
        bottom: mock.bottom,
        left: mock.left,
        right: mock.right,
        vw: window.innerWidth,
        vh: window.innerHeight,
        fit: getComputedStyle(document.querySelector('#mock img.blank')).objectFit,
        logos: logos.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height })),
      };
    });
    expect(stuck.mockTop).toBeGreaterThan(stuck.bar - 2);
    expect(stuck.mockTop).toBeLessThan(stuck.bar + 120);
    expect(stuck.bottom).toBeLessThanOrEqual(stuck.vh + 1);
    expect(stuck.left).toBeGreaterThanOrEqual(-1);
    expect(stuck.right).toBeLessThanOrEqual(stuck.vw + 1);
    expect(stuck.fit).toBe('contain');
    const deskChips = await page.locator('#slots .slot').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const img = el.querySelector('img.em');
      const ir = img ? img.getBoundingClientRect() : null;
      return { w: r.width, h: r.height, emoji: ir ? ir.width : 0 };
    }));
    expect(deskChips).toHaveLength(3);
    for (const chip of deskChips) {
      expect(Math.abs(chip.w - chip.h)).toBeLessThan(1.5);
      expect(chip.w).toBeGreaterThan(100);
      expect(chip.emoji).toBeGreaterThan(56);
      expect(chip.emoji).toBeGreaterThan(chip.w * 0.55);
    }
    expect(stuck.logos).toHaveLength(3);
    for (const logo of stuck.logos) {
      expect(logo.width).toBeGreaterThan(8);
      expect(logo.height).toBeGreaterThan(8);
      expect(logo.top).toBeGreaterThanOrEqual(stuck.mockTop - 1);
      expect(logo.bottom).toBeLessThanOrEqual(stuck.bottom + 1);
      expect(logo.left).toBeGreaterThanOrEqual(stuck.left - 1);
      expect(logo.right).toBeLessThanOrEqual(stuck.right + 1);
    }
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('compact preview fills the phone band for every mockup', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.isMobile !== true, 'sticky compact preview is the phone layout');
  const errors = track(page);
  await page.goto('/shop-preview');
  await expect(page.locator('#mock img.blank')).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important}' });
  const products = ['tee', 'hoodie', 'mug', 'hat', 'case'];
  for (const product of products) {
    await press(page.locator(`#prods button[data-value="${product}"]`), testInfo);
    const colors = page.locator('#cols button');
    const count = await colors.count();
    expect(count, product).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await press(colors.nth(i), testInfo);
      await page.locator('#colorhead').evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
      await expect.poll(() => page.locator('#mock img.blank').evaluate((el) => el.naturalWidth)).toBeGreaterThan(100);
      const frame = await page.evaluate(() => {
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const mock = document.querySelector('#mock').getBoundingClientRect();
        const img = document.querySelector('#mock img.blank');
        const box = img.getBoundingClientRect();
        const slots = document.querySelector('#slots').getBoundingClientRect();
        const logos = [...document.querySelectorAll('#mock image')].map((el) => el.getBoundingClientRect());
        return {
          product: document.querySelector('#mock').dataset.product,
          compact: document.documentElement.classList.contains('compact'),
          sticky: getComputedStyle(document.querySelector('#stage')).position,
          fit: getComputedStyle(img).objectFit,
          stageTop: stage.top,
          stageBottom: stage.bottom,
          stageH: stage.height,
          vh: window.innerHeight,
          vw: window.innerWidth,
          mock: { top: mock.top, bottom: mock.bottom, left: mock.left, right: mock.right, width: mock.width, height: mock.height },
          img: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height },
          natural: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
          slotsTop: slots.top,
          slotsW: [...document.querySelectorAll('#slots .slot')].map((el) => el.getBoundingClientRect().width),
          logos: logos.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height })),
        };
      });
      const label = `${product} color ${i}`;
      expect(frame.compact, label).toBeTruthy();
      expect(frame.sticky, label).toBe('sticky');
      expect(frame.product, label).toBe(product);
      expect(frame.fit, label).toBe('contain');
      expect(frame.stageH, label).toBeGreaterThanOrEqual(168);
      expect(frame.img.height, label).toBeGreaterThanOrEqual(168);
      expect(frame.stageH / frame.vh, label).toBeGreaterThan(0.18);
      expect(frame.stageH / frame.vh, label).toBeLessThan(0.32);
      expect(frame.img.top - frame.stageTop, label).toBeLessThan(2);
      expect(frame.stageBottom - frame.img.bottom, label).toBeLessThan(2);
      expect(frame.img.height, label).toBeGreaterThan(frame.stageH * 0.97);
      expect(frame.img.left, label).toBeGreaterThanOrEqual(-1);
      expect(frame.img.right, label).toBeLessThanOrEqual(frame.vw + 1);
      expect(frame.natural, label).toBeGreaterThan(0);
      expect(Math.abs(frame.img.width / frame.img.height - frame.natural), label).toBeLessThan(0.03);
      expect(Math.abs(frame.mock.width / frame.mock.height - frame.natural), label).toBeLessThan(0.03);
      expect(frame.slotsTop, label).toBeGreaterThanOrEqual(frame.stageBottom - 2);
      expect(frame.slotsW, label).toHaveLength(3);
      for (const width of frame.slotsW) expect(width, label).toBeGreaterThan(72);
      expect(frame.logos, label).toHaveLength(3);
      for (const logo of frame.logos) {
        expect(logo.width, label).toBeGreaterThan(4);
        expect(logo.height, label).toBeGreaterThan(4);
        expect(logo.top, label).toBeGreaterThanOrEqual(frame.img.top - 1);
        expect(logo.bottom, label).toBeLessThanOrEqual(frame.img.bottom + 1);
        expect(logo.left, label).toBeGreaterThanOrEqual(frame.img.left - 1);
        expect(logo.right, label).toBeLessThanOrEqual(frame.img.right + 1);
      }
    }
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an empty middle slot stays empty on the product, in the bag, and in checkout', async ({ page }, testInfo) => {
  const errors = track(page);
  if (!live) {
    await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stripe test checkout</title><h1>Stripe test checkout</h1>',
    }));
  }
  let payload = null;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/checkout')) payload = req.postDataJSON();
  });
  await page.goto('/shop-preview');
  await expect(page.locator('#mock image')).toHaveCount(3);
  await press(page.locator('#lay button[data-value="row"]'), testInfo);
  const full = await logoImages(page);

  for (let n = 0; n < 3; n += 1) await press(page.locator('#slots [data-clear]').first(), testInfo);
  await expect(page.locator('#mock image')).toHaveCount(0);

  await press(page.locator('#slots button[data-slot="0"]'), testInfo);
  await expect(page.locator('#slots button[data-slot="0"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page.locator('#grid button[data-emoji="🔥"]'), testInfo);
  await expect(page.locator('#slots button[data-slot="1"]')).toHaveAttribute('aria-pressed', 'true');

  await press(page.locator('#slots button[data-slot="2"]'), testInfo);
  await expect(page.locator('#slots button[data-slot="2"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page.locator('#grid button[data-emoji="🍕"]'), testInfo);
  await expect(page.locator('#slots button[data-slot="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#slots button.f')).toHaveCount(2);
  await expect(page.locator('#triosay')).toContainText('empty');

  function assertRowGap(images, reference, label) {
    expect(images, label).toHaveLength(2);
    const width = images[0].w;
    const left = images[0].x + width / 2;
    const right = images[1].x + images[1].w / 2;
    expect(right - left, label).toBeGreaterThan(width * 1.9);
    expect(Math.abs(images[0].y - images[1].y), label).toBeLessThan(1);
    if (reference) {
      expect(Math.abs(images[0].x - reference[0].x), label).toBeLessThan(1);
      expect(Math.abs(images[1].x - reference[2].x), label).toBeLessThan(1);
      expect(Math.abs(width - reference[0].w), label).toBeLessThan(0.2);
    }
  }
  assertRowGap(await logoImages(page), full, 'tee');
  for (const product of ['hoodie', 'mug', 'hat', 'case']) {
    await press(page.locator(`#prods button[data-value="${product}"]`), testInfo);
    await press(page.locator('#lay button[data-value="row"]'), testInfo);
    assertRowGap(await logoImages(page), null, product);
  }

  await press(page.locator('#prods button[data-value="tee"]'), testInfo);
  await press(page.locator('#lay button[data-value="triangle"]'), testInfo);
  const triangle = await logoImages(page);
  expect(triangle).toHaveLength(2);
  const top = { x: triangle[0].x + triangle[0].w / 2, y: triangle[0].y + triangle[0].w / 2 };
  const corner = { x: triangle[1].x + triangle[1].w / 2, y: triangle[1].y + triangle[1].w / 2 };
  expect(corner.y - top.y).toBeGreaterThan(triangle[0].w * 0.4);
  expect(corner.x - top.x).toBeGreaterThan(triangle[0].w * 0.3);

  await press(page.locator('#lay button[data-value="stacked"]'), testInfo);
  const stacked = await logoImages(page);
  expect(stacked).toHaveLength(2);
  expect(Math.abs(stacked[0].x - stacked[1].x)).toBeLessThan(1);
  expect((stacked[1].y + stacked[1].w / 2) - (stacked[0].y + stacked[0].w / 2)).toBeGreaterThan(stacked[0].w * 1.9);

  await press(page.locator('#lay button[data-value="row"]'), testInfo);
  await press(page.locator('#addbtn'), testInfo);
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#items .gap')).toHaveCount(1);
  await expect(page.locator('#items .e img')).toHaveCount(2);
  await expect(page.locator('#items .gap')).toHaveAttribute('aria-label', 'Empty');
  await press(page.locator('#pay'), testInfo);
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  expect(payload.items[0].slots).toEqual(['🔥', null, '🍕']);
  expect(payload.items[0].emojis).toEqual(['🔥', null, '🍕']);
  expect(payload.items[0].layout).toBe('row');
  expect(payload.items[0].background).toBeUndefined();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the same emoji can repeat in every slot or leave a gap', async ({ page }, testInfo) => {
  const errors = track(page);
  if (!live) {
    await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stripe test checkout</title><h1>Stripe test checkout</h1>',
    }));
  }
  let payload = null;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/checkout')) payload = req.postDataJSON();
  });
  await page.goto('/shop-preview');
  await press(page.locator('#lay button[data-value="row"]'), testInfo);
  const full = await logoImages(page);
  for (let n = 0; n < 3; n += 1) await press(page.locator('#slots [data-clear]').first(), testInfo);
  const fire = page.locator('#grid button[data-emoji="🔥"]');
  for (let n = 0; n < 3; n += 1) await press(fire, testInfo);
  await press(fire, testInfo);
  await expect(page.locator('#slots button.f')).toHaveCount(3);
  await expect(page.locator('#grid button.sel')).toHaveCount(0);
  await expect(fire.locator('.count')).toHaveText('×3');
  const triple = await logoImages(page);
  expect(triple).toHaveLength(3);
  expect(new Set(triple.map((image) => image.href)).size).toBe(1);
  triple.forEach((image, index) => {
    expect(Math.abs(image.x - full[index].x)).toBeLessThan(1);
  });
  await press(page.locator('#addbtn'), testInfo);
  await press(page.locator('#closecart'), testInfo);
  await press(page.locator('#slots .slot[data-slot="1"] button.slot-clear'), testInfo);
  await expect(fire.locator('.count')).toHaveText('×2');
  await expect(page.locator('#grid button.sel')).toHaveCount(0);
  const gapped = await logoImages(page);
  expect(gapped).toHaveLength(2);
  expect(Math.abs(gapped[0].x - full[0].x)).toBeLessThan(1);
  expect(Math.abs(gapped[1].x - full[2].x)).toBeLessThan(1);
  expect(gapped[1].x - gapped[0].x).toBeGreaterThan(gapped[0].w * 1.9);
  await press(page.locator('#addbtn'), testInfo);
  const lines = page.locator('#items .item');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0).locator('img')).toHaveCount(3);
  await expect(lines.nth(0).locator('.gap')).toHaveCount(0);
  await expect(lines.nth(1).locator('img')).toHaveCount(2);
  await expect(lines.nth(1).locator('.gap')).toHaveCount(1);
  await press(page.locator('#pay'), testInfo);
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  expect(payload.items.map((item) => item.slots)).toEqual([['🔥', '🔥', '🔥'], ['🔥', null, '🔥']]);
  expect(payload.items.map((item) => item.emojis)).toEqual([['🔥', '🔥', '🔥'], ['🔥', null, '🔥']]);
  expect(payload.items.every((item) => item.background === undefined)).toBeTruthy();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('policy pages are linked from the shop and the bag', async ({ page }) => {
  const errors = track(page);
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Three emojis');
  await expect(page.locator('footer nav a')).toHaveText(['Privacy', 'Terms', 'Shipping', 'Returns', 'Contact', 'About']);
  await expect(page.locator('footer a[href="/stories"]')).toHaveCount(0);
  const og = await page.request.get('/assets/og.png');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type'] || '').toContain('image/png');
  expect(og.headers()['cache-control']).toBe('public, max-age=86400');
  expect((await page.request.get('/assets/products/tee/white-520.webp')).headers()['cache-control']).toBe('public, max-age=86400');
  expect((await page.request.get('/favicon.ico')).status()).toBe(200);
  expect((await page.request.get('/apple-touch-icon.png')).status()).toBe(200);
  expect((await page.request.get('/site.webmanifest')).status()).toBe(200);
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('<loc>https://trimojiapparel.com/</loc>');
  expect(sitemap).toContain('<loc>https://trimojiapparel.com/returns</loc>');
  expect(sitemap).toContain('<loc>https://trimojiapparel.com/contact</loc>');
  expect(sitemap).toContain('<loc>https://trimojiapparel.com/about</loc>');
  expect(sitemap).not.toMatch(/stories|account|shop-preview/);
  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toContain('Sitemap: https://trimojiapparel.com/sitemap.xml');
  expect(robots).toContain('Disallow: /shop-preview');
  await page.goto('/shop-preview');
  await expect(page.locator('footer nav a')).toHaveText(['Privacy', 'Terms', 'Shipping', 'Returns', 'Contact', 'About', 'Account']);
  await expect(page.locator('footer a[href="/stories"]')).toHaveCount(0);
  await expect(page.locator('.nav-links a[href="/account"]')).toHaveText('Account');
  const bagPolicy = page.locator('.buybar a[href="/returns"]');
  await expect(page.locator('.buybar')).toContainText('Custom-made to order. See our Returns policy.');
  await expect(page.locator('.buybar')).toContainText('replace it free or refund you');
  await expect(page.locator('.buybar')).toContainText('2–5 business days');
  await expect(page.locator('.buybar')).toContainText('3–4 business days');
  await expect(page.locator('#sizechartbtn')).toBeVisible();
  await expect(bagPolicy).toHaveText('Returns policy');
  expect(await bagPolicy.getAttribute('target')).toBeNull();
  await page.locator('#cartbtn').click();
  await expect(page.locator('#drawer a[href="/shipping"]')).toBeVisible();
  await expect(page.locator('#drawer a[href="/returns"]')).toHaveCount(2);
  const checkoutPolicy = page.locator('#drawer a[href="/returns"]', { hasText: 'Returns policy' });
  await expect(page.locator('#drawer')).toContainText('Custom-made to order. See our Returns policy.');
  await expect(page.locator('#drawer')).toContainText('2–5 business days');
  await expect(page.locator('#drawer')).toHaveAttribute('aria-modal', 'true');
  await expect(checkoutPolicy).toBeVisible();
  expect(await checkoutPolicy.getAttribute('target')).toBeNull();
  const pages = [
    ['/privacy', 'Privacy Policy', 'does not sell personal information'],
    ['/terms', 'Terms of Service', 'made to order'],
    ['/shipping', 'Shipping Policy', '2–5 business days'],
    ['/returns', 'Returns & Refund Policy', '30 days'],
    ['/contact', 'Contact', 'hello@trimojiapparel.com'],
    ['/about', 'About', 'Three emojis. One you.'],
  ];
  for (const [path, title, line] of pages) {
    const response = await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('h1')).toHaveText(title);
    await expect(page.locator('main')).toContainText(line);
    await expect(page.locator('main')).toContainText('hello@trimojiapparel.com');
    if (path === '/privacy') {
      await expect(page.locator('main')).toContainText('Last updated Oct 25, 2026.');
      await expect(page.locator('main')).toContainText('Accounts are optional');
      await expect(page.locator('main')).toContainText('We do not store a password');
      await expect(page.locator('main')).toContainText('Tough phone cases');
      await expect(page.locator('main')).not.toContainText('There are no customer accounts');
      await expect(page.locator('main')).not.toContainText('shirts, hoodies, hats, and mugs');
    }
    await expect(page.locator('footer nav a')).toHaveText(['Privacy', 'Terms', 'Shipping', 'Returns', 'Contact', 'About']);
    await expect(page.locator('footer a[href="/stories"]')).toHaveCount(0);
    await expect(page.locator('footer')).toContainText('© Trimoji');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\bLLC\b|Street|Avenue|\bSuite\b/);
    if (path === '/shipping') await expect(page.locator('main')).toContainText('3–4 business days');
    if (path === '/about') {
      const aboutText = await page.locator('main').innerText();
      expect(aboutText).not.toMatch(/founded|award|review|press|customers|years/i);
    }
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://trimojiapparel.com/assets/og.png');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `https://trimojiapparel.com${path}`);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
    if (path === '/returns') {
      expect(response.headers()['x-robots-tag'] || '').not.toMatch(/noindex/i);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      await expect(page.locator('#size-chart')).toContainText('Bella + Canvas 3001');
      await expect(page.locator('#size-chart')).toContainText('Gildan 18500');
      await expect(page.locator('#size-chart')).toContainText('34–37');
      await expect(page.locator('#size-chart')).toContainText('33.5');
      await expect(page.locator('main h2')).toHaveText([
        'Damaged, defective, or incorrect items',
        'Sizing',
        'Order changes and cancellations',
        'Lost or delayed packages',
        'Refunds',
        'Shipping address',
        'Contact',
      ]);
      await expect(page.locator('main a[href="mailto:hello@trimojiapparel.com"]').last()).toHaveText('hello@trimojiapparel.com');
    }
  }
  await page.goto('/success.html');
  await expect(page.locator('main')).toContainText('Tracking is emailed when it ships');
  await expect(page.locator('#order')).toBeHidden();
  await page.goto('/success.html?session_id=cs_test_playwright');
  await expect(page.locator('#order .label')).toHaveText('Order reference');
  await expect(page.locator('#ref')).toHaveText(printfulExternalId('cs_test_playwright'));
  await expect(page.locator('#lines')).toContainText('Tough phone case');
  await expect(page.locator('#lines')).toContainText('Glossy');
  await expect(page.locator('#lines')).toContainText('iPhone 16');
  await expect(page.locator('#sum')).toContainText('Shipping $5.99');
  await expect(page.locator('#sum')).toContainText('Tax $2.17');
  await expect(page.locator('#sum')).toContainText('Total $37.16');
  await expect(page.locator('main')).not.toContainText('secret@example.com');
  await expect(page.locator('main')).not.toContainText('1 Secret St');
  await expect(page.locator('footer nav a[href="/shipping"]')).toBeVisible();
  await expect(page.locator('footer nav a[href="/returns"]')).toHaveText('Returns');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('size chart, delivery estimate, and bag dialog are usable from the keyboard', async ({ page }, testInfo) => {
  const errors = track(page);
  await page.goto('/shop-preview');
  await expect(page.locator('#slots button button')).toHaveCount(0);
  const clear = page.locator('#slots button.slot-clear').first();
  await expect(clear).toBeVisible();
  expect(await clear.evaluate((el) => el.parentElement.tagName)).toBe('DIV');
  await expect(clear).toHaveAttribute('aria-label', /Clear slot/);

  await press(page.locator('#sizechartbtn'), testInfo);
  await expect(page.locator('#sizechart')).toBeVisible();
  await expect(page.locator('#sizechart')).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#sizechart-close')).toBeFocused();
  await expect(page.locator('#sizechart')).toContainText('34–37');
  await expect(page.locator('#sizechart')).toContainText('33.5');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sizechart')).toBeHidden();
  await expect(page.locator('#sizechartbtn')).toBeFocused();

  await press(page.locator('#prods button[data-value="mug"]'), testInfo);
  await expect(page.locator('#sizechartbtn')).toBeHidden();
  await press(page.locator('#prods button[data-value="hoodie"]'), testInfo);
  await expect(page.locator('#sizechartbtn')).toBeVisible();

  await page.locator('#cartbtn').focus();
  await page.locator('#cartbtn').click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#closecart')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await expect(page.locator('#drawer')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#cartbtn')).toBeFocused();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reduced motion keeps the page still', async ({ page }) => {
  const errors = track(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/shop-preview');
  await expect(page.locator('#mock image')).toHaveCount(3);
  const motion = await page.locator('#mock').evaluate((el) => getComputedStyle(el).animationName);
  expect(motion).toBe('none');
  await expect(page.locator('a.btn[href="#shop"]')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
