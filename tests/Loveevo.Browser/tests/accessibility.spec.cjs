const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function openWorkspace(page) {
  await page.goto('/');
  await expect(page.locator('.lv-onboarding, .lv-workspace')).toBeVisible();
  const skip = page.getByRole('button', { name: '暂时跳过' });
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.lv-workspace')).toBeVisible();
}

async function scan(page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
}

test('desktop workspace meets automated WCAG 2.2 AA checks', async ({ page }) => {
  await openWorkspace(page);
  expect((await scan(page)).violations).toEqual([]);
});

test('mobile shell meets automated WCAG 2.2 AA checks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.lv-onboarding, .lv-mobile-app')).toBeVisible();
  const skip = page.getByRole('button', { name: '暂时跳过' });
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.lv-mobile-app')).toBeVisible();
  expect((await scan(page)).violations).toEqual([]);
});

test('event editor and unsaved-change dialog meet automated WCAG checks', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: '新回忆', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '记录这一刻' })).toBeVisible();
  expect((await scan(page)).violations).toEqual([]);

  await page.getByLabel('事件标题').fill('可访问性检查');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未保存的修改' })).toBeVisible();
  await page.locator('.lv-dialog').evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  expect((await scan(page)).violations).toEqual([]);
});
