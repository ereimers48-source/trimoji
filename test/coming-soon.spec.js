import { expect, test } from '@playwright/test';

test('coming soon collects an email and the shop stays on a private path', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__mails = [];
    window.__openMail = (url) => { window.__mails.push(url); };
  });

  await page.goto('/');
  await expect(page.locator('.eyebrow')).toHaveText('Coming soon');
  await expect(page.locator('h1')).toContainText('Three emojis.');
  await expect(page.locator('h1')).toContainText('One you.');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Coming soon/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Trimoji — Three emojis. One you.');
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /Custom 3-emoji logos/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://trimojiapparel.com/assets/og.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://trimojiapparel.com/');
  await expect(page.locator('.lede')).toHaveText('Custom 3-emoji logos on tees, hoodies, mugs, hats, and phone cases.');
  await expect(page.locator('#mock')).toHaveCount(0);
  await expect(page.locator('a[href*="shop-preview"]')).toHaveCount(0);
  await expect(page.locator('a[href="https://www.instagram.com/trimojiapparel/"]')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/tiktok/i);

  await page.locator('#email').fill('ada@example.com');
  const notify = page.locator('#notify');
  await notify.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await notify.tap();
  else await notify.click();
  await expect(page.locator('#signup-status')).toContainText('hello@trimojiapparel.com');
  const mailto = await page.evaluate(() => window.__mails[0] || '');
  expect(mailto.startsWith('mailto:hello@trimojiapparel.com?')).toBe(true);
  expect(decodeURIComponent(mailto)).toContain('ada@example.com');

  const preview = await page.goto('/shop-preview');
  expect(preview.headers()['x-robots-tag'] || '').toMatch(/noindex/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('#mock')).toBeVisible();
});
