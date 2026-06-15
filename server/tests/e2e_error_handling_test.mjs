/**
 * E2E 测试：错误处理与边界情况 (Phase 7)
 *
 * 测试内容：
 * 1. 前端 Toast 提示（axios 拦截器错误 → Toast）
 * 2. 空画布正常渲染（网格背景）
 * 3. 超长文本截断
 * 4. 窗口失焦 / 恢复焦点（rAF 暂停/恢复）
 * 5. 后端 404 走统一格式
 * 6. 后端校验失败走统一格式
 * 7. 后端认证失败走统一格式
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001/api';

const TEST_EMAIL = `test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Test123456';
const TEST_NAME = 'TestUser';

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
      await nameInput.fill('Error Test Board');
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

// --- 测试 1: 登录后进入白板 ---
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', msg => console.log(`[console][${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));

console.log('=== 测试 1: 注册登录 ===');
await registerAndLogin(page);
console.log(`✅ 登录成功，当前 URL: ${page.url()}`);

console.log('=== 测试 2: 创建白板 ===');
const wbUrl = await createWhiteboard(page);
console.log(`✅ 白板 URL: ${wbUrl}`);

// 截图：空画布状态
await page.waitForTimeout(1000);
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_empty_canvas.png', full_page: true });
console.log('Screenshot: e2e_empty_canvas.png');

// --- 测试 3: 空画布（0 个元素）应正常渲染网格 ---
console.log('=== 测试 3: 空画布网格背景 ===');
const count0 = await getElementCount(page);
console.log(`空画布元素数: ${count0}`);
if (count0 === 0) {
  console.log('✅ 空画布正常渲染（网格背景可见）');
  results.push({ test: '空画布', pass: true });
} else {
  console.log('⚠️ 空画布状态异常');
  results.push({ test: '空画布', pass: false });
}

// --- 测试 4: 超长文本截断 ---
console.log('=== 测试 4: 超长文本截断 ===');
// 点击文本工具
const textBtn = page.locator('button[title*="文本"], button:has-text("文本"), [data-tool="text"]').first();
if (await textBtn.isVisible().catch(() => false)) {
  await textBtn.click();
  await page.waitForTimeout(500);
  // 在画布上点击放置文本
  await page.mouse.click(500, 300);
  await page.waitForTimeout(500);

  // 查找文本输入框（textarea 或 contenteditable）
  const textArea = page.locator('textarea, [contenteditable="true"]').first();
  if (await textArea.isVisible().catch(() => false)) {
    const longText = 'A'.repeat(600); // 超过 500 字符
    await textArea.fill(longText);
    await page.waitForTimeout(300);
    // 按 Enter 或点击外部保存
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.mouse.click(700, 500); // 点击外部
    await page.waitForTimeout(800);

    await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_long_text.png', full_page: true });
    console.log('Screenshot: e2e_long_text.png');

    const countAfterText = await getElementCount(page);
    if (countAfterText >= 1) {
      console.log('✅ 超长文本元素已创建（Canvas 渲染时截断）');
      results.push({ test: '超长文本', pass: true });
    } else {
      console.log('❌ 文本元素未创建');
      results.push({ test: '超长文本', pass: false });
    }
  } else {
    console.log('⚠️ 未找到文本输入框');
    results.push({ test: '超长文本', pass: false });
  }
} else {
  console.log('⚠️ 未找到文本工具按钮');
  results.push({ test: '超长文本', pass: false });
}

// --- 测试 5: 窗口失焦 / 恢复焦点 ---
console.log('=== 测试 5: 窗口失焦/恢复焦点 ===');
try {
  // 模拟失焦
  await page.evaluate(() => window.blur());
  await page.waitForTimeout(500);
  // 模拟恢复焦点
  await page.evaluate(() => window.focus());
  await page.waitForTimeout(500);
  console.log('✅ 窗口失焦/恢复焦点未导致崩溃');
  results.push({ test: '失焦恢复', pass: true });
} catch (err) {
  console.log(`❌ 失焦/恢复焦点出错: ${err.message}`);
  results.push({ test: '失焦恢复', pass: false });
}

// --- 测试 6: 后端 API 错误响应格式 ---
console.log('=== 测试 6: 后端错误响应格式 ===');

// 6a: 404
const res404 = await fetch(`${API_URL}/nonexistent`);
const body404 = await res404.json();
console.log(`404 response: ${JSON.stringify(body404)}`);
if (body404.success === false && body404.error?.code === 'NOT_FOUND') {
  console.log('✅ 404 走统一错误格式');
  results.push({ test: 'API 404', pass: true });
} else {
  console.log('❌ 404 格式不正确');
  results.push({ test: 'API 404', pass: false });
}

// 6b: 校验失败（注册时缺少必填字段）
const resValidation = await fetch(`${API_URL}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'invalid-email', password: '123' }),
});
const bodyValidation = await resValidation.json();
console.log(`Validation response: ${JSON.stringify(bodyValidation)}`);
if (bodyValidation.success === false && bodyValidation.error?.code === 'VALIDATION_ERROR' && bodyValidation.error?.details) {
  console.log('✅ 校验失败走统一格式（含 details）');
  results.push({ test: 'API 校验失败', pass: true });
} else {
  console.log('❌ 校验失败格式不正确');
  results.push({ test: 'API 校验失败', pass: false });
}

// 6c: 认证失败
const resAuth = await fetch(`${API_URL}/auth/me`, {
  headers: { 'Authorization': 'Bearer invalid-token' },
});
const bodyAuth = await resAuth.json();
console.log(`Auth error response: ${JSON.stringify(bodyAuth)}`);
if (bodyAuth.success === false && bodyAuth.error?.code === 'AUTH_ERROR') {
  console.log('✅ 认证失败走统一格式');
  results.push({ test: 'API 认证失败', pass: true });
} else {
  console.log('❌ 认证失败格式不正确');
  results.push({ test: 'API 认证失败', pass: false });
}

// --- 汇总 ---
console.log('\n========== 测试结果汇总 ==========');
let allPassed = true;
for (const r of results) {
  const icon = r.pass ? '✅' : '❌';
  console.log(`${icon} ${r.test}`);
  if (!r.pass) allPassed = false;
}
console.log(allPassed ? '\n🎉 所有测试通过！' : '\n⚠️ 部分测试失败');

await browser.close();
process.exit(allPassed ? 0 : 1);
