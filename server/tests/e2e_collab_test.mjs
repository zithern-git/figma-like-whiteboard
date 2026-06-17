import { chromium } from 'playwright';

const TEST_EMAIL = `test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Test123456';
const TEST_NAME = 'TestUser';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

async function registerAndLogin(page) {
  await page.goto(`${BASE_URL}/register`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // 昵称、邮箱、密码
  const inputs = await page.locator('input').all();
  if (inputs.length >= 3) {
    await inputs[0].fill(TEST_NAME);
    await inputs[1].fill(TEST_EMAIL);
    await inputs[2].fill(TEST_PASSWORD);
  }
  await page.click('button:has-text("注册")');

  // 等待注册完成
  await page.waitForTimeout(2500);

  // 如果还在登录页，就登录
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
  // 查找"创建第一个白板"或"创建白板"按钮
  const newBoardBtn = page.locator('button:has-text("创建第一个白板"), button:has-text("创建白板"), button:has-text("新建白板"), [data-testid="new-whiteboard"]').first();
  if (await newBoardBtn.isVisible().catch(() => false)) {
    await newBoardBtn.click();
    await page.waitForTimeout(800);
    // 填写白板名称
    const nameInput = page.locator('input[placeholder*="白板名称"], input[placeholder*="名称"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Test Whiteboard');
      await page.waitForTimeout(300);
    }
    // 点击对话框中的"创建"按钮
    const confirmBtn = page.locator('button:has-text("创建"), button[type="submit"]').last();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
  }
  return page.url();
}

async function addRectangle(page, x, y) {
  // 尝试点击矩形工具
  const rectBtn = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first();
  if (await rectBtn.isVisible().catch(() => false)) {
    await rectBtn.click();
    await page.waitForTimeout(500);
    // 矩形需要拖拽绘制
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 80);
    await page.mouse.up();
    await page.waitForTimeout(800);
  }
}

async function getElementCount(page) {
  // 从页面右上角的"X 个元素"文本获取元素数量
  const text = await page.locator('text=/\\d+ 个元素/').first().textContent().catch(() => '0 个元素');
  const match = text.match(/(\d+)\s*个元素/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getElementPositions(page) {
  return await page.evaluate(() => {
    // 尝试多种可能的选择器
    const selectors = ['[data-element-id]', '[id^="el-"]', 'svg g[data-id]', '.canvas-element', '[data-shape]'];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        const result = [];
        els.forEach(el => {
          const rect = el.getBoundingClientRect();
          result.push({
            id: el.getAttribute('data-element-id') || el.id || el.getAttribute('data-id'),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
        });
        return result;
      }
    }
    return [];
  });
}

// ========== 主测试 ==========
const browser = await chromium.launch({ headless: true });

// --- User A ---
const pageA = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pageA.on('console', msg => console.log(`[A][${msg.type()}] ${msg.text()}`));
pageA.on('pageerror', err => console.log(`[A][error] ${err.message}`));

console.log('--- User A: 注册并登录 ---');
await registerAndLogin(pageA);
console.log(`User A URL after login: ${pageA.url()}`);

await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_after_login_A.png', fullPage: true });
console.log('Screenshot: e2e_after_login_A.png');

// 创建/进入白板
const wbUrl = await createWhiteboard(pageA);
console.log(`Whiteboard URL: ${wbUrl}`);
await pageA.waitForTimeout(1000);
await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_whiteboard_A.png', fullPage: true });
console.log('Screenshot: e2e_whiteboard_A.png');

// 在白板上添加一个矩形
console.log('--- User A: 添加矩形 ---');
await addRectangle(pageA, 400, 300);
await pageA.waitForTimeout(1000);
await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_after_add_rect_A.png', fullPage: true });
console.log('Screenshot: e2e_after_add_rect_A.png');

// --- User B (同一白板) ---
const pageB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pageB.on('console', msg => console.log(`[B][${msg.type()}] ${msg.text()}`));
pageB.on('pageerror', err => console.log(`[B][error] ${err.message}`));

console.log('--- User B: 登录同一账号 ---');
await pageB.goto(`${BASE_URL}/login`);
await pageB.waitForLoadState('networkidle');
const loginInputs = await pageB.locator('input').all();
if (loginInputs.length >= 2) {
  await loginInputs[0].fill(TEST_EMAIL);
  await loginInputs[1].fill(TEST_PASSWORD);
}
await pageB.click('button:has-text("登录")');
await pageB.waitForTimeout(2500);

// 进入同一个白板
console.log('--- User B: 进入同一白板 ---');
await pageB.goto(wbUrl);
await pageB.waitForLoadState('networkidle');
await pageB.waitForTimeout(3000); // 给 Socket 连接和同步留时间
await pageB.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_whiteboard_B.png', fullPage: true });
console.log('Screenshot: e2e_whiteboard_B.png');

// 检查 B 是否能看到 A 添加的元素
const countA = await getElementCount(pageA);
const countB = await getElementCount(pageB);
const posA = await getElementPositions(pageA);
const posB = await getElementPositions(pageB);
console.log(`User A element count: ${countA}, positions: ${JSON.stringify(posA)}`);
console.log(`User B element count: ${countB}, positions: ${JSON.stringify(posB)}`);

let passed = true;

if (countA === 0) {
  console.log('❌ User A 没有成功添加元素');
  passed = false;
}

if (countB === 0) {
  console.log('❌ 协作测试失败：User B 看不到 User A 添加的元素');
  passed = false;
} else {
  console.log('✅ 协作测试通过：User B 能看到 User A 添加的元素');
}

// 测试 2: User B 添加元素，User A 是否也能看到
console.log('--- User B: 添加第二个矩形 ---');
await addRectangle(pageB, 600, 400);
await pageB.waitForTimeout(1000);
await pageB.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_after_add_rect_B.png', fullPage: true });
console.log('Screenshot: e2e_after_add_rect_B.png');

// 等待同步
await pageA.waitForTimeout(2000);
await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_whiteboard_A_after_B.png', fullPage: true });
console.log('Screenshot: e2e_whiteboard_A_after_B.png');

const countA2 = await getElementCount(pageA);
const countB2 = await getElementCount(pageB);
console.log(`After B adds: A count=${countA2}, B count=${countB2}`);

if (countA2 >= 2 && countB2 >= 2) {
  console.log('✅ 双向协作测试通过：双方都能看到对方的元素');
} else {
  console.log('❌ 双向协作测试失败');
  passed = false;
}

await browser.close();
console.log(passed ? '\n🎉 所有 E2E 测试通过！' : '\n⚠️ 部分 E2E 测试失败');
process.exit(passed ? 0 : 1);
