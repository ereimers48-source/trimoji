import { expect, test } from '@playwright/test';

async function press(locator, testInfo) {
  await locator.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

async function inbox(page, email) {
  const data = await page.evaluate(async () => {
    const res = await fetch('/api/test/inbox');
    return res.json();
  });
  return data.messages.filter((message) => message.to === email);
}

test('passwordless account sign-in, saved designs, and orders', async ({ page }, testInfo) => {
  const email = `account-${testInfo.project.name}@example.com`;
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  const home = await page.goto('/');
  expect(home.status()).toBe(200);
  await expect(page.locator('footer a[href="/account"]')).toHaveCount(0);
  await expect(page.locator('header a[href="/account"]')).toHaveCount(0);

  const signedOut = await page.goto('/account');
  expect(signedOut.headers()['x-robots-tag'] || '').toMatch(/noindex/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('h1')).toHaveText('Account');
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#send-link')).toHaveText('Email me a sign-in link');
  await expect(page.locator('.privacy')).toContainText('We do not store a password');
  await expect(page.locator('#signed-in')).toBeHidden();

  await page.goto('/shop-preview');
  await expect(page.locator('.nav-links a[href="/account"]')).toHaveText('Account');
  await expect(page.locator('footer a[href="/account"]')).toHaveText('Account');
  await expect(page.locator('#savedesign')).toBeHidden();
  await expect(page.locator('#saveprompt')).toBeVisible();
  await page.locator('#savelink').click();
  await expect(page).toHaveURL(/\/account\?next=/);
  await expect(page.locator('#send-link')).toBeVisible();

  await page.locator('#email').fill(email);
  await page.locator('#send-link').click();
  await expect(page.locator('#request-status')).toHaveText('If that address can sign in, we sent a link. It expires in 15 minutes.');
  await page.locator('#email').fill('nobody@example.com');
  await page.locator('#send-link').click();
  await expect(page.locator('#request-status')).toHaveText('If that address can sign in, we sent a link. It expires in 15 minutes.');

  const blocked = await page.evaluate(async () => {
    const res = await fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    });
    return res.status;
  });
  expect(blocked).toBe(403);

  const messages = await inbox(page, email);
  expect(messages.length).toBeGreaterThan(0);
  const link = messages.at(-1).text.match(/https?:\/\/\S+/)[0];
  await page.goto(link);
  await expect(page).toHaveURL(/\/account/);
  await expect(page.locator('#hello')).toContainText(email);
  await expect(page.locator('#signout')).toHaveText('Sign out');
  await expect(page.locator('#delete')).toHaveText('Delete my account and data');
  const jar = await page.context().cookies();
  const session = jar.find((cookie) => cookie.name === 'trimoji_session');
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe('Lax');
  expect(session.secure).toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toContain('trimoji_session');

  await page.goto('/shop-preview');
  await expect(page.locator('#savedesign')).toBeVisible();
  await expect(page.locator('#saveprompt')).toBeHidden();
  await press(page.locator('#slots .slot[data-slot="1"] button.slot-clear'), testInfo);
  await press(page.locator('#savedesign'), testInfo);
  await expect(page.locator('#toast')).toContainText('Design saved.');

  await page.goto('/account');
  await page.locator('#tab-designs').click();
  await expect(page.locator('#designs')).toContainText('empty');
  await expect(page.locator('#designs img.preview')).toBeVisible();
  const preview = await page.locator('#designs img.preview').getAttribute('src');
  const previewResponse = await page.request.get(preview);
  expect(previewResponse.headers()['content-type'] || '').toContain('image/svg+xml');
  expect(await previewResponse.text()).toContain('<svg');

  await page.evaluate(async () => {
    const res = await fetch('/api/test/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error('order seed failed');
  });
  await page.goto('/account');
  await expect(page.locator('#orders')).toContainText('abc123abc123abc123abc123abc123ab');
  await expect(page.locator('#orders')).toContainText('T-shirt');
  await expect(page.locator('#orders')).toContainText('Austin, TX');
  await expect(page.locator('#orders')).toContainText('$34.99');
  await expect(page.locator('#orders')).toContainText('Shipped');
  await expect(page.locator('#orders a')).toHaveAttribute('href', 'https://example.com/track/TRACK123');
  await expect(page.locator('#orders')).not.toContainText('4242');
  await expect(page.locator('main')).not.toContainText('pf_test_playwright');

  await page.locator('#tab-designs').click();
  await page.locator('#designs a', { hasText: 'Open in builder' }).click();
  await expect(page).toHaveURL(/saved=/);
  await expect(page.locator('#slots button[data-slot="0"]')).toHaveClass(/f/);
  await expect(page.locator('#slots button[data-slot="1"]')).not.toHaveClass(/\bf\b/);
  await expect(page.locator('#slots button[data-slot="2"]')).toHaveClass(/f/);

  await page.goto('/account');
  await page.locator('#signout').click();
  await expect(page.locator('#send-link')).toBeVisible();
  await page.goto(link);
  await expect(page).toHaveURL(/signin=invalid/);
  await expect(page.locator('#request-status')).toHaveText('That sign-in link is invalid or expired.');

  const again = await inbox(page, email);
  await page.goto('/account');
  await page.locator('#email').fill(email);
  await page.locator('#send-link').click();
  await expect(page.locator('#request-status')).toContainText('If that address can sign in');
  const resent = (await inbox(page, email)).filter((message) => !again.includes(message));
  await page.goto(resent.at(-1).text.match(/https?:\/\/\S+/)[0]);
  await expect(page.locator('#hello')).toContainText(email);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#delete').click();
  await expect(page.locator('#send-link')).toBeVisible();
  await expect(page.locator('#signed-in')).toBeHidden();

  expect(errors, errors.join('\n')).toEqual([]);
});
