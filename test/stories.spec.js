import { expect, test } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a story stays private until an admin approves it', async ({ page }, testInfo) => {
  const marker = `handwritten ${testInfo.project.name} note`;
  const story = `${marker}. These three emojis are mine and nobody else wrote this sentence.`;
  const response = await page.goto('/stories');
  expect(response.headers()['x-robots-tag'] || '').toMatch(/noindex/i);
  await expect(page.locator('h1')).toHaveText('Your 3 emojis, your story');
  await expect(page.locator('.lede')).toHaveText('Real stories from real people. Written by you, not by AI.');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('#empty')).toContainText('yours can be the first');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('footer nav a')).toHaveText(['Privacy', 'Terms', 'Shipping', 'Returns', 'Contact', 'About']);
  await expect(page.locator('footer a[href="/stories"]')).toHaveCount(0);

  await page.goto('/');
  await expect(page.locator('.eyebrow')).toHaveText('Coming soon');
  await expect(page.locator('footer a[href="/stories"]')).toHaveCount(0);
  await expect(page.locator('footer a[href="/about"]')).toHaveText('About');
  await page.goto('/shop-preview');
  await expect(page.locator('footer a[href="/stories"]')).toHaveCount(0);

  await page.goto('/stories');
  await page.locator('#emoji1').fill('🌈');
  await page.locator('#emoji2').fill('🌈');
  await page.locator('#emoji3').fill('🌈');
  await page.locator('#firstName').fill('SpamBot');
  await page.locator('#city').fill('Nowhere');
  await page.locator('#story').fill('This honeypot note is long enough to pass the form and must never be stored.');
  await page.locator('#consent').check();
  await page.locator('#company').fill('acquired-company');
  await page.locator('#send').click();
  await expect(page.locator('#form-status')).toContainText('waiting for review');

  await page.locator('#emoji1').fill('🔥');
  await page.locator('#emoji2').fill('🔥');
  await page.locator('#emoji3').fill('🍕');
  await page.locator('#firstName').fill('Riley');
  await page.locator('#city').fill('Faketown, ZZ');
  await page.locator('#story').fill(`<b>${story}</b>`);
  await page.locator('#email').fill('private-reader@example.com');
  await page.locator('#photo').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#consent').check();
  await page.locator('#send').click();
  await expect(page.locator('#form-status')).toContainText('waiting for review');
  await page.reload();
  await expect(page.locator('#list')).not.toContainText(marker);
  await expect(page.locator('main')).not.toContainText('private-reader@example.com');
  await expect(page.locator('#list b')).toHaveCount(0);

  const admin = await page.goto('/stories-admin');
  expect(admin.headers()['x-robots-tag'] || '').toMatch(/noindex/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.locator('#token').fill('nope');
  await page.locator('#gate button').click();
  await expect(page.locator('#admin-status')).toContainText('token');
  await page.locator('#token').fill('test-admin-token');
  await page.locator('#gate button').click();
  await expect(page.locator('#queue')).toContainText(marker);
  await expect(page.locator('#queue')).toContainText('private-reader@example.com');
  await expect(page.locator('#queue')).not.toContainText('SpamBot');
  const card = page.locator('#queue article', { hasText: marker });
  await expect(card.locator('b')).toHaveCount(0);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('#queue')).not.toContainText(marker);

  await page.goto('/stories');
  const published = page.locator('#list article', { hasText: marker });
  await expect(published).toBeVisible();
  await expect(published).toContainText('Riley · Faketown, ZZ');
  await expect(published).toContainText('🔥');
  await expect(published.locator('img')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('private-reader@example.com');
  await expect(published.locator('b, script')).toHaveCount(0);
});
