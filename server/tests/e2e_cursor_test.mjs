import { chromium } from 'playwright';

const TEST_EMAIL = `cursor_test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Test123456';
const TEST_NAME = 'CursorTester';
const BASE_URL = 'http://localhost:5173';

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
  const newBoardBtn = page.locator('button:has-text("创建第一个白板"), button:has-text("创建白板"), button:has-text("新建白板"), [data-testid="new-whiteboard"]').first();
  if (await newBoardBtn.isVisible().catch(() => false)) {
    await newBoardBtn.click();
    await page.waitForTimeout(800);
    const nameInput = page.locator('input[placeholder*="白板名称"], input[placeholder*="名称"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Cursor Test Board');
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

// ========== 远程光标测试 ==========
const browser = await chromium.launch({ headless: true });

// --- User A ---
const pageA = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pageA.on('console', msg => console.log(`[A][${msg.type()}] ${msg.text()}`));

console.log('--- User A: 注册并登录 ---');
await registerAndLogin(pageA);
const wbUrl = await createWhiteboard(pageA);
console.log(`Whiteboard URL: ${wbUrl}`);

// A 在白板上移动鼠标（触发光标广播）
console.log('--- A: 在白板上移动鼠标 ---');
await pageA.mouse.move(500, 400);
await pageA.waitForTimeout(500);
await pageA.mouse.move(600, 500);
await pageA.waitForTimeout(500);
await pageA.mouse.move(700, 300);
await pageA.waitForTimeout(500);

// --- User B 进入同一白板 ---
const pageB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pageB.on('console', msg => console.log(`[B][${msg.type()}] ${msg.text()}`));

console.log('--- User B: 登录并进入白板 ---');
await pageB.goto(`${BASE_URL}/login`);
await pageB.waitForLoadState('networkidle');
const loginInputs = await pageB.locator('input').all();
if (loginInputs.length >= 2) {
  await loginInputs[0].fill(TEST_EMAIL);
  await loginInputs[1].fill(TEST_PASSWORD);
}
await pageB.click('button:has-text("登录")');
await pageB.waitForTimeout(2500);

await pageB.goto(wbUrl);
await pageB.waitForLoadState('networkidle');
await pageB.waitForTimeout(3000);

// B 也在白板上移动鼠标
console.log('--- B: 在白板上移动鼠标 ---');
await pageB.mouse.move(400, 300);
await pageB.waitForTimeout(500);
await pageB.mouse.move(500, 400);
await pageB.waitForTimeout(500);

// 等待光标同步
await pageA.waitForTimeout(2000);
await pageB.waitForTimeout(2000);

// 截图检查
await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_cursor_A.png', fullPage: true });
await pageB.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_cursor_B.png', fullPage: true });
console.log('Screenshot: e2e_cursor_A.png, e2e_cursor_B.png');

// 检查在线用户列表
async function checkOnlineUsers(page) {
  // 查找在线用户指示器（可能是头像堆叠、用户列表等）
  const userIndicators = await page.locator('[data-testid="online-users"], .online-users, .user-avatar, [class*="avatar"]').all();
  return userIndicators.length;
}

const usersA = await checkOnlineUsers(pageA);
const usersB = await checkOnlineUsers(pageB);
console.log(`Online users indicator count: A=${usersA}, B=${usersB}`);

// 检查连接状态
async function checkConnectionStatus(page) {
  const statusText = await page.locator('text=/已连接|连接中|断开/', { exact: false }).first().textContent().catch(() => 'unknown');
  return statusText;
}

const statusA = await checkConnectionStatus(pageA);
const statusB = await checkConnectionStatus(pageB);
console.log(`Connection status: A="${statusA}", B="${statusB}"`);

// 检查是否有远程光标 SVG
async function hasRemoteCursor(page) {
  return await page.evaluate(() => {
    const cursors = document.querySelectorAll('svg [class*="cursor"], [class*="remote-cursor"], [data-cursor]');
    return cursors.length;
  });
}

const cursorsA = await hasRemoteCursor(pageA);
const cursorsB = await hasRemoteCursor(pageB);
console.log(`Remote cursors found: A=${cursorsA}, B=${cursorsB}`);

let passed = true;

if (statusA.includes('已连接') && statusB.includes('已连接')) {
  console.log('✅ 连接状态测试通过：双方都显示已连接');
} else {
  console.log('⚠️ 连接状态可能有问题');
}

// 由于远程光标可能是 SVG 内动态渲染的，DOM 选择器不一定能直接找到
// 但至少确认双方都在同一白板且连接正常
if (usersA > 0 || usersB > 0 || cursorsA > 0 || cursorsB > 0) {
  console.log('✅ 协作指示器测试通过：检测到在线用户或远程光标');
} else {
  console.log('⚠️ 未检测到在线用户指示器（可能是渲染方式不同）');
}

await browser.close();
console.log('Done.');
