import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const chrome = { channel: 'chrome', launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] } };

export default defineConfig({
  testDir: 'test',
  testMatch: '**/*.spec.js',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.QA_LIVE === '1' ? 1 : 0,
  use: {
    baseURL,
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...chrome, viewport: { width: 1280, height: 740 }, hasTouch: false, isMobile: false } },
    { name: 'desktop-wide', use: { ...chrome, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } },
    { name: 'mobile', use: { ...chrome, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: phone } },
    { name: 'mobile-short', use: { ...chrome, viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: phone } },
    { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1280, height: 740 }, hasTouch: false, isMobile: false } },
    { name: 'webkit-wide', use: { browserName: 'webkit', viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } },
    { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: phone } },
    { name: 'webkit-short', use: { browserName: 'webkit', viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: phone } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node test/server.mjs',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
