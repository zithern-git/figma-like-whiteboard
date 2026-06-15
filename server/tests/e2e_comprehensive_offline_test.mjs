/**
 * E2E 综合测试：离线操作全面覆盖
 *
 * 场景：
 * 1. 在线添加元素 A
 * 2. 断网
 * 3. 离线添加元素 B
 * 4. 离线移动 B 到 P1
 * 5. 离线移动 A 到 P2
 * 6. 离线再添加元素 C
 * 7. 离线移动 C 到 P3
 * 8. 重连
 * 9. 验证：所有元素都在正确位置
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001/api';

const TEST_EMAIL = `comp_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Test123456';
const TEST_NAME = 'ComprehensiveTest';

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
      await nameInput.fill('Comprehensive Test Board');
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

async function getElementState(page) {
  return await page.evaluate(() => {
    // @ts-ignore
    const store = window.__canvasStore
    if (!store) return null
    return store.getState().elements.map((e) => ({
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
    }))
  })
}

const browser = await chromium.launch({ headless: true });
const results = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', msg => {
  const t = msg.text();
  if (t.includes('[useSocketCollab]') || t.includes('[broadcastOp]') || t.includes('merge')) {
    console.log(`>>> ${t}`);
  }
});

console.log('=== 步骤 1: 注册登录 ===');
await registerAndLogin(page);
console.log(`✅ 登录: ${page.url()}`);

console.log('=== 步骤 2: 创建白板 ===');
await createWhiteboard(page);
await page.waitForTimeout(1500);

console.log('=== 步骤 3: 在线添加元素 A（200,150 → 350,250）===');
const rectBtn = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first();
if (await rectBtn.isVisible().catch(() => false)) {
  await rectBtn.click();
  await page.waitForTimeout(500);
} else {
  const tools = await page.locator('button').all();
  if (tools.length > 1) await tools[1].click();
  await page.waitForTimeout(500);
}

await page.mouse.move(200, 150);
await page.mouse.down();
await page.mouse.move(350, 250);
await page.mouse.up();
await page.waitForTimeout(2000); // 等待服务端持久化

const stateAfterA = await getElementState(page);
console.log(`A 添加后: ${JSON.stringify(stateAfterA)}`);
const A_id = stateAfterA[0]?.id;

console.log('=== 步骤 4: 断网（用 socket.disconnect() 强制断开）===');
const closedOk = await page.evaluate(() => {
  // @ts-ignore
  const socket = window.__socket
  if (!socket) return 'no socket'
  // 关键修复：用 socket.disconnect() 而不是 engine.close()
  // socket.disconnect() 会：
  // 1. 同步设置 connected = false
  // 2. 触发 disconnect 事件
  // 3. 让 broadcastOp 走离线队列分支
  socket.disconnect()
  return 'disconnected, connected=' + socket.connected
});
console.log(`断网: ${closedOk}`);
await page.waitForTimeout(1000);
// 确认 socket 已断开
const isConn = await page.evaluate(() => {
  // @ts-ignore
  return window.__socket?.connected
});
console.log(`socket.connected = ${isConn}`);

console.log('=== 步骤 5: 离线添加元素 B（400,300 → 550,400）===');
// 选矩形工具
if (await rectBtn.isVisible().catch(() => false)) {
  await rectBtn.click();
  await page.waitForTimeout(500);
}

await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(550, 400);
await page.mouse.up();
await page.waitForTimeout(500);

const stateAfterB = await getElementState(page);
console.log(`B 离线添加后: ${JSON.stringify(stateAfterB)}`);
const B_id = stateAfterB[1]?.id;
const B_initial = stateAfterB[1];

console.log('=== 步骤 6: 离线移动 B 到 (700, 500) ===');
// 切到选择工具
const selectBtn = page.locator('button[title*="选择"], button:has-text("选择"), [data-tool="select"]').first();
if (await selectBtn.isVisible().catch(() => false)) {
  await selectBtn.click();
  await page.waitForTimeout(300);
}

// B 中心约 (475, 350)，拖到中心 (800, 600)
await page.mouse.move(475, 350);
await page.mouse.down();
await page.waitForTimeout(100);
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(475 + i * 30, 350 + i * 25);
  await page.waitForTimeout(50);
}
await page.mouse.up();
await page.waitForTimeout(500);

const stateAfterMoveB = await getElementState(page);
console.log(`B 移动后: ${JSON.stringify(stateAfterMoveB?.find((e) => e.id === B_id))}`);

console.log('=== 步骤 7: 离线移动 A 到 (500, 100) ===');
// A 中心约 (275, 200)，拖到中心 (550, 200) — 也就是把 A 移到 (450, 150)
await page.mouse.move(275, 200);
await page.mouse.down();
await page.waitForTimeout(100);
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(275 + i * 25, 200);
  await page.waitForTimeout(50);
}
await page.mouse.up();
await page.waitForTimeout(500);

const stateAfterMoveA = await getElementState(page);
console.log(`A 移动后: ${JSON.stringify(stateAfterMoveA?.find((e) => e.id === A_id))}`);

console.log('=== 步骤 8: 离线添加元素 C（600,500 → 750,600）===');
if (await rectBtn.isVisible().catch(() => false)) {
  await rectBtn.click();
  await page.waitForTimeout(500);
}

await page.mouse.move(600, 500);
await page.mouse.down();
await page.mouse.move(750, 600);
await page.mouse.up();
await page.waitForTimeout(500);

const stateAfterC = await getElementState(page);
console.log(`C 离线添加后: ${JSON.stringify(stateAfterC)}`);
const C_id = stateAfterC[2]?.id;

console.log('=== 步骤 9: 离线移动 C 到 (900, 700) ===');
if (await selectBtn.isVisible().catch(() => false)) {
  await selectBtn.click();
  await page.waitForTimeout(300);
}
// C 中心约 (675, 550)
await page.mouse.move(675, 550);
await page.mouse.down();
await page.waitForTimeout(100);
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(675 + i * 20, 550 + i * 15);
  await page.waitForTimeout(50);
}
await page.mouse.up();
await page.waitForTimeout(500);

const stateAfterAll = await getElementState(page);
console.log(`所有元素最终状态: ${JSON.stringify(stateAfterAll)}`);

console.log('=== 步骤 10: 恢复网络 ===');
// 关键修复：socket.disconnect() 是手动断开，socket.io 默认不会自动重连
// 我们需要手动调用 socket.connect() 触发重连
// （在真实场景中，如果只是 network drop，socket.io 的 transport 会自动重连）
console.log('手动重连 socket...');
await page.evaluate(() => {
  // @ts-ignore
  const socket = window.__socket
  if (!socket) return
  socket.connect()
})
console.log('等待 8s 让 socket 重连 + 补发 + 合并 + 服务端持久化...');
await page.waitForTimeout(8000);

const reconnected = await page.evaluate(() => {
  // @ts-ignore
  return window.__socket?.connected
});
console.log(`重连后 socket.connected = ${reconnected}`);

const stateAfterReconnect = await getElementState(page);
console.log(`重连后本地状态: ${JSON.stringify(stateAfterReconnect)}`);

console.log('=== 步骤 11: 刷新页面，从服务端拉取最新状态 ===');
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);

const stateAfterRefresh = await getElementState(page);
console.log(`刷新后状态（来自服务端）: ${JSON.stringify(stateAfterRefresh)}`);

// 验证
console.log('\n=== 验证 ===');

const expectedA = stateAfterAll?.find((e) => e.id === A_id);
const expectedB = stateAfterAll?.find((e) => e.id === B_id);
const expectedC = stateAfterAll?.find((e) => e.id === C_id);

const actualA = stateAfterRefresh?.find((e) => e.id === A_id);
const actualB = stateAfterRefresh?.find((e) => e.id === B_id);
const actualC = stateAfterRefresh?.find((e) => e.id === C_id);

console.log(`A: 期望 x=${expectedA?.x} y=${expectedA?.y}  实际 x=${actualA?.x} y=${actualA?.y}`);
console.log(`B: 期望 x=${expectedB?.x} y=${expectedB?.y}  实际 x=${actualB?.x} y=${actualB?.y}`);
console.log(`C: 期望 x=${expectedC?.x} y=${expectedC?.y}  实际 x=${actualC?.x} y=${actualC?.y}`);

function deviation(actual, expected) {
  if (!actual || !expected) return Infinity
  return Math.abs(actual.x - expected.x) + Math.abs(actual.y - expected.y)
}

const devA = deviation(actualA, expectedA)
const devB = deviation(actualB, expectedB)
const devC = deviation(actualC, expectedC)
console.log(`A 偏差: ${devA}, B 偏差: ${devB}, C 偏差: ${devC}`);

if (devA < 5 && devB < 5 && devC < 5) {
  console.log('✅ 三个元素位置都在可接受范围内（偏差 < 5px）');
  results.push({ test: '所有元素位置正确', pass: true });
} else {
  console.log(`❌ 位置偏差：A=${devA}px, B=${devB}px, C=${devC}px`);
  results.push({ test: '所有元素位置正确', pass: false });
}

// 汇总
console.log('\n========== 测试结果汇总 ==========');
let allPassed = true;
for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.test}`);
  if (!r.pass) allPassed = false;
}
console.log(allPassed ? '\n🎉 综合测试通过！' : '\n⚠️ 部分测试失败');

await browser.close();
process.exit(allPassed ? 0 : 1);
