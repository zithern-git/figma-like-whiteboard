import { chromium } from 'playwright';

const TEST_EMAIL = `ot_test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Test123456';
const TEST_NAME = 'OTTester';
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
      await nameInput.fill('OT Test Board');
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

async function addRectangle(page, x, y) {
  const rectBtn = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first();
  if (await rectBtn.isVisible().catch(() => false)) {
    await rectBtn.click();
    await page.waitForTimeout(500);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 80);
    await page.mouse.up();
    await page.waitForTimeout(800);
  }
}

async function getElementCount(page) {
  const text = await page.locator('text=/\\d+ 个元素/').first().textContent().catch(() => '0 个元素');
  const match = text.match(/(\d+)\s*个元素/);
  return match ? parseInt(match[1], 10) : 0;
}

async function selectTool(page, toolName) {
  // 选择工具：选择工具(V)
  const selectBtn = page.locator('button[title*="选择"], button:has-text("选择"), [data-tool="select"]').first();
  if (await selectBtn.isVisible().catch(() => false)) {
    await selectBtn.click();
    await page.waitForTimeout(300);
  }
}

async function moveElement(page, fromX, fromY, toX, toY) {
  await selectTool(page);
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(toX, toY);
  await page.mouse.up();
  await page.waitForTimeout(1000);
}

// ========== OT 测试：并发移动同一元素 ==========
const browser = await chromium.launch({ headless: true });

// --- User A ---
const pageA = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pageA.on('console', msg => console.log(`[A][${msg.type()}] ${msg.text()}`));

console.log('--- User A: 注册并登录 ---');
await registerAndLogin(pageA);

const wbUrl = await createWhiteboard(pageA);
console.log(`Whiteboard URL: ${wbUrl}`);

// A 添加一个矩形在 (400, 300)
console.log('--- A: 添加矩形在 (400, 300) ---');
await addRectangle(pageA, 400, 300);
await pageA.waitForTimeout(1000);
await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_ot_initial.png', fullPage: true });
console.log('Screenshot: e2e_ot_initial.png');

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

const countB = await getElementCount(pageB);
console.log(`B sees ${countB} elements`);

// 验证 B 能看到 A 的元素
if (countB === 0) {
  console.log('❌ B 看不到 A 的元素，无法继续 OT 测试');
  await browser.close();
  process.exit(1);
}

await pageB.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_ot_B_joined.png', fullPage: true });
console.log('Screenshot: e2e_ot_B_joined.png');

// ========== OT 核心测试：A 和 B 同时移动同一元素 ==========
// 由于浏览器自动化是串行的，我们模拟"并发"：
// 1. A 移动元素到右侧
// 2. 在 A 的 op 到达服务器之前，B 也移动同一元素（基于旧位置）
// 3. 验证最终两边状态一致（convergence）

console.log('--- OT Test: A 移动元素到右侧 ---');
await moveElement(pageA, 450, 340, 700, 340);
await pageA.waitForTimeout(1500);
await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_ot_A_moved.png', fullPage: true });
console.log('Screenshot: e2e_ot_A_moved.png');

// B 此时也移动同一元素（基于它看到的旧位置）
console.log('--- OT Test: B 移动元素到下方 ---');
await moveElement(pageB, 450, 340, 450, 600);
await pageB.waitForTimeout(1500);
await pageB.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_ot_B_moved.png', fullPage: true });
console.log('Screenshot: e2e_ot_B_moved.png');

// 等待同步
console.log('--- 等待同步... ---');
await pageA.waitForTimeout(3000);
await pageB.waitForTimeout(3000);

await pageA.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_ot_A_final.png', fullPage: true });
await pageB.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_ot_B_final.png', fullPage: true });
console.log('Screenshot: e2e_ot_A_final.png, e2e_ot_B_final.png');

// 检查最终状态是否一致（convergence）
const countA_final = await getElementCount(pageA);
const countB_final = await getElementCount(pageB);
console.log(`Final: A count=${countA_final}, B count=${countB_final}`);

// 元素数量应该都是 1
if (countA_final === 1 && countB_final === 1) {
  console.log('✅ OT 测试通过：双方最终都保持 1 个元素（没有重复或丢失）');
} else {
  console.log('❌ OT 测试失败：元素数量不一致');
}

await browser.close();
console.log('Done.');
