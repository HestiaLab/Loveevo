const { test, expect } = require('@playwright/test');

const publishedUrl = 'http://127.0.0.1:5174';

test('published PWA opens and records events offline', async ({ page, context }) => {
  await page.goto(publishedUrl);
  await expect(page.locator('.lv-onboarding, .lv-timeline-page')).toBeVisible();
  const skip = page.getByRole('button', { name: '暂时跳过' });
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.lv-timeline-page')).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await page.getByRole('button', { name: '写下第一条回忆' }).click();
  await page.getByLabel('事件标题').fill('离线记录');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存到本机。')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('link', { name: '时间线', exact: true }).click();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.lv-timeline-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: '离线记录' })).toBeVisible();

  await page.getByRole('button', { name: '记录新的回忆' }).click();
  await page.getByLabel('事件标题').fill('断网也能写');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存到本机。')).toBeVisible();
  await context.setOffline(false);
});
