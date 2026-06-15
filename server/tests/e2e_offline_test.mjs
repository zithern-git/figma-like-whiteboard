/**
 * E2E 测试：离线操作队列（断网 → 修改 → 重连 → 验证同步）
 *
 * 步骤：
 * 1. 注册登录
 * 2. 创建白板
 * 3. 断网（模拟 offline）
 * 4. 添加一个矩形元素
 * 5. 恢复网络
 * 6. 等待重连 + 补发
 * 7. 刷新页面，验证元素是否被保存到服务端
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001/api';

const TEST_EMAIL = `offline_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Test123456';
const TEST_NAME = 'OfflineTest';

async function registerAndLogin(page) {
  await page.goto(`${BASE_URL}/register`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const inputs = await page.locator('input').all();
  if (inputs.length >= 3) {
    await inputs[0].fill(TEST_NAME);
    await inputs[1].fill(TEST_EMAIL);
    await inputs[2].fill(TEST_PASSWORD);
  }
  await page.click('button:has-text("注册")');
  await page.waitForTimeout(2500);

  if (page.url().includes('/login')) {
    const loginInputs = await page.locator('input').all();
    if (loginInputs.length >= 2) {
      await loginInputs[0].fill(TEST_EMAIL);
      await loginInputs[1].fill(TEST_PASSWORD);
    }
    await page.click('button:has-text("登录")');
    await page.waitForTimeout(2500);
  }
}

async function createWhiteboard(page) {
  const newBoardBtn = page.locator('button:has-text("创建第一个白板"), button:has-text("创建白板"), button:has-text("新建白板")').first();
  if (await newBoardBtn.isVisible().catch(() => false)) {
    await newBoardBtn.click();
    await page.waitForTimeout(800);
    const nameInput = page.locator('input[placeholder*="白板名称"], input[placeholder*="名称"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Offline Test Board');
      await page.waitForTimeout(300);
    }
    const confirmBtn = page.locator('button:has-text("创建"), button[type="submit"]').last();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
  }
  return page.url();
}

async function getElementCount(page) {
  const text = await page.locator('text=/\\d+ 个元素/').first().textContent().catch(() => '0 个元素');
  const match = text.match(/(\d+)\s*个元素/);
  return match ? parseInt(match[1], 10) : 0;
}

// ========== 主测试 ==========
const browser = await chromium.launch({ headless: true });
const results = [];

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', msg => console.log(`[console][${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));

console.log('=== 步骤 1: 注册登录 ===');
await registerAndLogin(page);
console.log(`✅ 登录成功: ${page.url()}`);

console.log('=== 步骤 2: 创建白板 ===');
const wbUrl = await createWhiteboard(page);
console.log(`✅ 白板 URL: ${wbUrl}`);
await page.waitForTimeout(1500);

const countBefore = await getElementCount(page);
console.log(`初始元素数: ${countBefore}`);

// 截图：断网前
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_offline_before.png', full_page: true });

console.log('=== 步骤 3: 断网 ===');
await page.context().setOffline(true);
console.log('✅ 已设置 offline');
await page.waitForTimeout(500);

console.log('=== 步骤 4: 断网期间添加矩形 ===');
// 点击矩形工具
const rectBtn = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first();
if (await rectBtn.isVisible().catch(() => false)) {
  await rectBtn.click();
  await page.waitForTimeout(500);
} else {
  console.log('⚠️ 未找到矩形工具，尝试点击第二个工具按钮');
  const tools = await page.locator('button').all();
  if (tools.length > 1) await tools[1].click();
  await page.waitForTimeout(500);
}

// 在画布上拖拽画一个矩形
await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(600, 500);
await page.mouse.up();
await page.waitForTimeout(800);

const countDuringOffline = await getElementCount(page);
console.log(`断网期间元素数（本地）: ${countDuringOffline}`);
if (countDuringOffline > countBefore) {
  console.log('✅ 断网期间本地操作成功');
  results.push({ step: '断网期间添加矩形', pass: true });
} else {
  console.log('❌ 断网期间未添加矩形');
  results.push({ step: '断网期间添加矩形', pass: false });
}

// 截图：断网中
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_offline_during.png', full_page: true });

console.log('=== 步骤 5: 恢复网络 ===');
await page.context().setOffline(false);
console.log('✅ 已恢复网络');

// 等待重连 + 补发（socket reconnect delay 1s + 补发时间）
console.log('等待 4s 让 socket 重连并补发...');
await page.waitForTimeout(4000);

// 截图：重连后
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_offline_after_reconnect.png', full_page: true });

console.log('=== 步骤 6: 刷新页面，验证服务端是否保存 ===');
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);

const countAfterRefresh = await getElementCount(page);
console.log(`刷新后元素数: ${countAfterRefresh}`);

if (countAfterRefresh > countBefore) {
  console.log('✅ 离线操作已同步到服务端，刷新后仍然存在');
  results.push({ step: '刷新验证', pass: true });
} else {
  console.log('❌ 离线操作未保存到服务端');
  results.push({ step: '刷新验证', pass: false });
}

// 截图：刷新后
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_offline_after_refresh.png', full_page: true });

// ========== 汇总 ==========
console.log('\n========== 测试结果汇总 ==========');
let allPassed = true;
for (const r of results) {
  const icon = r.pass ? '✅' : '❌';
  console.log(`${icon} ${r.step}`);
  if (!r.pass) allPassed = false;
}
console.log(allPassed ? '\n🎉 离线操作队列测试通过！' : '\n⚠️ 部分测试失败');

await browser.close();
process.exit(allPassed ? 0 : 1);
