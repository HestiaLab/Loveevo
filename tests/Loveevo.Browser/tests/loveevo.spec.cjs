const { test, expect } = require('@playwright/test');
const path = require('node:path');

async function skipOnboarding(page) {
  await page.goto('/');
  await expect(page.locator('.lv-onboarding, .lv-timeline-page')).toBeVisible();
  const skip = page.getByRole('button', { name: '暂时跳过' });
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.lv-timeline-page')).toBeVisible();
}

async function openWorkspace(page) {
  await page.getByRole('link', { name: '工作台', exact: true }).click();
  await expect(page.locator('.lv-workspace, .lv-mobile-app')).toBeVisible();
}

async function returnToTimeline(page) {
  await expect(page.locator('.lv-workspace, .lv-mobile-app')).toBeVisible();
  const link = page.getByRole('link', { name: '时间线', exact: true });
  if (await link.isVisible()) await link.click();
  else await page.getByRole('button', { name: '时间线', exact: true }).click();
  await expect(page.locator('.lv-timeline-page')).toBeVisible();
}

async function createEvent(page, title) {
  await page.goto('/');
  await expect(page.locator('.lv-timeline-page')).toBeVisible();
  const first = page.getByRole('button', { name: '写下第一条回忆' });
  if (await first.isVisible()) await first.click();
  else await page.getByRole('button', { name: '记录新的回忆' }).click();
  await expect(page.getByRole('heading', { name: '记录这一刻' })).toBeVisible();
  await page.getByLabel('事件标题').fill(title);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存到本机。')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
}

test('timeline is standalone and has only one create action', async ({ page }) => {
  await skipOnboarding(page);
  await expect(page.locator('.lv-timeline-page')).toBeVisible();
  await expect(page.locator('.lv-workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /写下第一条回忆|记录新的回忆/ })).toHaveCount(1);

  await openWorkspace(page);
  const sideTabs = page.locator('.atlas-v2-toolbar [role="tab"]');
  await expect(sideTabs).toHaveCount(2);
  await expect(sideTabs.nth(0)).toHaveText('阶段');
  await expect(sideTabs.nth(1)).toHaveText('筛选');
  const documentTabs = page.locator('.atlas-v2-group-document [role="tab"]');
  await expect(documentTabs.filter({ hasText: '关系总览' })).toHaveCount(1);
  await expect(documentTabs.filter({ hasText: '备份与设置' })).toHaveCount(1);
  await expect(documentTabs.filter({ hasText: '我们的时间线' })).toHaveCount(0);

  await page.locator('.lv-topbar').getByRole('button', { name: '关系总览' }).click();
  await expect(page.locator('.lv-document-page .overview-panel')).toBeVisible();
  await page.locator('.lv-topbar').getByRole('button', { name: '备份与设置' }).click();
  await expect(page.locator('.lv-document-page .settings-panel')).toBeVisible();
});

test('onboarding, event lifecycle, photo upload and persistence', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先认识一下你们。' })).toBeVisible();
  await page.getByLabel('我的称呼').fill('小林');
  await page.getByLabel('对方的称呼').fill('小周');
  await page.getByLabel('你们在一起的日子').fill('2026-01-01');
  await page.getByRole('button', { name: /继续/ }).click();

  await expect(page.getByRole('heading', { name: '记录第一个瞬间。' })).toBeVisible();
  await page.getByLabel('标题').fill('第一次见面');
  await page.getByRole('button', { name: '开始我们的故事' }).click();

  await expect(page.getByText('把每一个心动，')).toBeVisible();
  await expect(page.getByRole('heading', { name: '第一次见面' })).toBeVisible();

  await page.getByRole('button', { name: '记录新的回忆' }).click();
  await expect(page.getByRole('heading', { name: '记录这一刻' })).toBeVisible();
  await page.getByLabel('事件标题').fill('一起看海');
  await page.getByLabel('地点').fill('海边');
  await page.getByRole('textbox', { name: /^回忆/ }).fill('风吹过来，我们聊了很久。');
  await page.getByRole('button', { name: /心动/ }).click();
  await page.locator('input[type=file]').setInputFiles(path.resolve(__dirname, '../../../src/Loveevo.App/wwwroot/icons/icon-192.png'));
  await expect(page.getByAltText('待保存照片')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存到本机。')).toBeVisible();

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await returnToTimeline(page);
  await page.getByRole('heading', { name: '一起看海' }).click();
  await expect(page.getByText('风吹过来，我们聊了很久。')).toBeVisible();

  await page.reload();
  await returnToTimeline(page);
  await expect(page.getByRole('heading', { name: '一起看海' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '第一次见面' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile keeps timeline and workspace on separate screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先认识一下你们。' })).toBeVisible();
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await expect(page.locator('.lv-timeline-page')).toBeVisible();
  await expect(page.locator('.lv-mobile-app')).toHaveCount(0);

  await page.getByRole('link', { name: '工作台', exact: true }).click();
  await expect(page.locator('.lv-mobile-app')).toBeVisible();
  await expect(page.locator('.lv-mobile-nav')).toBeVisible();
  await expect(page.locator('.lv-workspace')).toHaveCount(0);
  await expect(page.locator('.lv-mobile-content .lv-timeline')).toHaveCount(0);
});

test('unsaved editor close guard supports cancel and discard', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '写下第一条回忆' }).click();
  await page.getByLabel('事件标题').fill('未保存的回忆');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未保存的修改' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByLabel('事件标题')).toHaveValue('未保存的回忆');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { name: '未保存的回忆' })).toHaveCount(0);
});

test('complete ZIP backup can be exported and restored after clearing data', async ({ page }) => {
  await skipOnboarding(page);
  await createEvent(page, '备份测试');
  await page.locator('.lv-topbar').getByRole('button', { name: '备份与设置' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^loveevo-backup-.*\.zip$/);
  const backupPath = await download.path();

  await page.getByRole('button', { name: '清除全部数据' }).click();
  await page.getByLabel('请输入“删除全部”以确认').fill('删除全部');
  await page.getByRole('button', { name: '确认清除全部数据' }).click();
  await expect(page.getByRole('heading', { name: '先认识一下你们。' })).toBeVisible();
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await page.locator('.lv-topbar').getByRole('button', { name: '备份与设置' }).click();
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await returnToTimeline(page);
  await expect(page.getByRole('heading', { name: '备份测试' })).toBeVisible();
});

test('changes propagate between browser tabs', async ({ context, page }) => {
  await skipOnboarding(page);
  const second = await context.newPage();
  await skipOnboarding(second);
  await createEvent(page, '跨标签页同步');
  await expect(second.getByRole('heading', { name: '跨标签页同步' })).toBeVisible();
  await second.close();
});

test('embedded browsers without PWA APIs can still load and save', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => {
    delete window.BroadcastChannel;
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  await skipOnboarding(page);
  await createEvent(page, '内置浏览器记录');
  await returnToTimeline(page);
  await expect(page.getByRole('heading', { name: '内置浏览器记录' })).toBeVisible();
});

test('custom stages can be created, selected and used for filtering', async ({ page }) => {
  await skipOnboarding(page);
  await openWorkspace(page);
  await page.getByRole('button', { name: '新增阶段' }).click();
  await page.getByLabel('阶段名称').fill('旅行');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /旅行 0 条/ })).toBeVisible();

  await returnToTimeline(page);
  await page.getByRole('button', { name: '写下第一条回忆' }).click();
  await page.getByLabel('事件标题').fill('第一次旅行');
  await page.getByLabel('所属阶段').selectOption({ label: '旅行' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await returnToTimeline(page);
  await page.locator('.lv-timeline-stage-strip').getByRole('button', { name: '旅行', exact: true }).click();
  await expect(page.getByRole('heading', { name: '第一次旅行' })).toBeVisible();
});

test('privacy mode removes sensitive content and photo bytes from view', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '写下第一条回忆' }).click();
  await page.getByLabel('事件标题').fill('隐私测试');
  await page.getByRole('textbox', { name: /^回忆/ }).fill('这段内容不应该在隐私模式中显示。');
  await page.locator('input[type=file]').setInputFiles(path.resolve(__dirname, '../../../src/Loveevo.App/wwwroot/icons/icon-192.png'));
  await expect(page.getByAltText('待保存照片')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await returnToTimeline(page);
  await page.getByRole('heading', { name: '隐私测试' }).click();

  await page.getByRole('button', { name: '切换隐私模式' }).click();
  await expect(page.getByRole('tab', { name: '隐私测试' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '回忆已隐藏' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '隐私测试' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '回忆已隐藏' })).toBeVisible();
  await expect(page.getByText('这段内容不应该在隐私模式中显示。')).toHaveCount(0);
  await expect(page.locator('.lv-event-detail img')).toHaveCount(0);
  await returnToTimeline(page);
  await expect(page.locator('.lv-event-card img')).toHaveCount(0);

  await openWorkspace(page);
  await page.reload();
  await expect(page.getByRole('tab', { name: '隐私测试' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '回忆已隐藏' })).toBeVisible();
  await expect(page.getByText('这段内容不应该在隐私模式中显示。')).toHaveCount(0);
});
