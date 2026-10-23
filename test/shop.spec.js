import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const live = process.env.QA_LIVE === '1';

function track(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror ${err.message}`));
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
  await expect(page.locator('#testmode')).toBeVisible();
  await expect(page.locator('#testmode')).toContainText('Test mode');
  await expect(page.locator('body')).not.toContainText('sk_');
  await expect(page.locator('a.btn[href="#builder"]')).toHaveCount(1);
  await expect(page.locator('a[href="#builder"] button')).toHaveCount(0);

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

  await page.locator('#grid button[title="fire"]').evaluate((el) => { el.dataset.keep = '1'; });
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
  await expect(page.locator('#c_fl')).toBeAttached();
  await press(page.locator('#tabs button[data-cat="fl"]'), testInfo);
  const flagsVisible = await page.locator('#c_fl').evaluate((el) => {
    const grid = document.getElementById('grid');
    const top = el.getBoundingClientRect().top - grid.getBoundingClientRect().top;
    return top >= -2 && top < grid.clientHeight;
  });
  expect(flagsVisible).toBeTruthy();
  await press(page.locator('#grid button[title="smiling face with sunglasses"]').first(), testInfo);
  await expect(page.locator('#heroart img')).toHaveCount(3);
  await press(page.locator('#grid button[title="face with tears of joy"]').first(), testInfo);
  await expect(page.locator('#heroart img')).toHaveCount(3);
  const picked = await page.locator('#heroart img').evaluateAll((els) => els.map((el) => el.alt));
  expect(picked).toEqual(['🔥', '😎', '😂']);
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
  await expect(page.locator('#sizes button')).toHaveText('11 oz');

  await press(page.locator('#prods button[data-value="hat"]'), testInfo);
  await expect(page.locator('#addbtn')).toBeDisabled();
  await expect(page.locator('#unavail')).toContainText('embroidery');
  await expect(page.locator('#cc')).toHaveText('0');

  await press(page.locator('#prods button[data-value="tee"]'), testInfo);
  await press(page.locator('#cols button[title="Black"]'), testInfo);
  await expect(page.locator('#mock path').first()).toHaveAttribute('fill', '#1f1f24');
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
