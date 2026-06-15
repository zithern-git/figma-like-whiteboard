/**
 * E2E 测试：复现"快速重连导致位置偏移"问题
 *
 * 场景：
 * 1. 在线添加矩形
 * 2. 断网
 * 3. 离线移动矩形到位置 A（多次 mousemove）
 * 4. **立即**重连（不等待）
 * 5. 重连过程中，可能还有 mousemove 没进入 offlineQueue
 * 6. 检查重连后的位置
 *
 * 预期：位置应该是 A
 * 实际（修复前）：位置可能是中间值
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const API_URL = process.env.API_URL || 'http://localhost:3001/api'

const TEST_EMAIL = `quick_repro_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'QuickRepro'

async function registerAndLogin(page) {
  await page.goto(`${BASE_URL}/register`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  const inputs = await page.locator('input').all()
  if (inputs.length >= 3) {
    await inputs[0].fill(TEST_NAME)
    await inputs[1].fill(TEST_EMAIL)
    await inputs[2].fill(TEST_PASSWORD)
  }
  await page.click('button:has-text("注册")')
  await page.waitForTimeout(2500)
  if (page.url().includes('/login')) {
    const loginInputs = await page.locator('input').all()
    if (loginInputs.length >= 2) {
      await loginInputs[0].fill(TEST_EMAIL)
      await loginInputs[1].fill(TEST_PASSWORD)
    }
    await page.click('button:has-text("登录")')
    await page.waitForTimeout(2500)
  }
}

async function createWhiteboard(page) {
  const newBoardBtn = page.locator('button:has-text("创建第一个白板"), button:has-text("创建白板"), button:has-text("新建白板")').first()
  if (await newBoardBtn.isVisible().catch(() => false)) {
    await newBoardBtn.click()
    await page.waitForTimeout(800)
    const nameInput = page.locator('input[placeholder*="白板名称"], input[placeholder*="名称"]').first()
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Quick Repro Board')
      await page.waitForTimeout(300)
    }
    const confirmBtn = page.locator('button:has-text("创建"), button[type="submit"]').last()
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click()
      await page.waitForTimeout(2000)
    }
  }
  return page.url()
}

async function getElementState(page) {
  return await page.evaluate(() => {
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

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const consoleLogs = []
page.on('console', (msg) => {
  const t = msg.text()
  if (
    t.includes('[useSocketCollab]') ||
    t.includes('merge') ||
    t.includes('offline') ||
    t.includes('REPRO') ||
    t.includes('error')
  ) {
    const line = `>>> ${t}`
    console.log(line)
    consoleLogs.push(line)
  }
})

console.log('=== 步骤 1: 注册登录 ===')
await registerAndLogin(page)
console.log(`✅ 登录: ${page.url()}`)

console.log('=== 步骤 2: 创建白板 ===')
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log('=== 步骤 3: 在线添加矩形（200,150 → 280,230）===')
const rectBtn = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first()
if (await rectBtn.isVisible().catch(() => false)) {
  await rectBtn.click()
  await page.waitForTimeout(500)
} else {
  const tools = await page.locator('button').all()
  if (tools.length > 1) await tools[1].click()
  await page.waitForTimeout(500)
}

await page.mouse.move(200, 150)
await page.mouse.down()
await page.mouse.move(280, 230)
await page.mouse.up()
await page.waitForTimeout(1500)

const stateAfterA = await getElementState(page)
console.log(`矩形添加后: ${JSON.stringify(stateAfterA)}`)
const rectId = stateAfterA[0]?.id

console.log('=== 步骤 4: 断网 ===')
await page.evaluate(() => {
  const socket = window.__socket
  if (!socket) return
  socket.disconnect()
})
await page.waitForTimeout(1000)
const isConn = await page.evaluate(() => window.__socket?.connected)
console.log(`socket.connected = ${isConn}`)

console.log('=== 步骤 5: 离线移动矩形（多 mousemove）===')
const selectBtn = page.locator('button[title*="选择"], button:has-text("选择"), [data-tool="select"]').first()
if (await selectBtn.isVisible().catch(() => false)) {
  await selectBtn.click()
  await page.waitForTimeout(300)
}

// 缓慢拖动，模拟用户实际操作
const startX = 240
const startY = 190
const targetX = 650
const targetY = 240
const steps = 30

await page.mouse.move(startX, startY)
await page.mouse.down()
await page.waitForTimeout(100)
for (let i = 1; i <= steps; i++) {
  const t = i / steps
  const x = startX + (targetX - startX) * t
  const y = startY + (targetY - startY) * t
  await page.mouse.move(x, y)
  await page.waitForTimeout(20)  // 20ms 间隔，更接近真实
}
await page.mouse.up()
await page.waitForTimeout(500)

const stateAfterMove = await getElementState(page)
const movedRect = stateAfterMove?.find((e) => e.id === rectId)
console.log(`\n>>> REPRO: 离线移动后本地 state: ${JSON.stringify(movedRect)}`)

console.log('\n=== 步骤 6: 立即重连（不等待）===')
await page.evaluate(() => {
  const socket = window.__socket
  if (!socket) return
  console.log('>>> REPRO: 调用 socket.connect() 触发重连')
  socket.connect()
})
// 只等很短的时间就检查
await page.waitForTimeout(500)
const stateRightAfterReconnect = await getElementState(page)
const rectAfterQuickReconnect = stateRightAfterReconnect?.find((e) => e.id === rectId)
console.log(`>>> REPRO: 重连后 0.5 秒本地 state: ${JSON.stringify(rectAfterQuickReconnect)}`)

// 等到稳定
await page.waitForTimeout(5000)

const stateAfterReconnect = await getElementState(page)
const reconnectedRect = stateAfterReconnect?.find((e) => e.id === rectId)
console.log(`\n>>> REPRO: 重连稳定后本地 state: ${JSON.stringify(reconnectedRect)}`)

console.log('=== 步骤 7: 刷新页面，从服务端拉取最新状态 ===')
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)

const stateAfterRefresh = await getElementState(page)
const refreshRect = stateAfterRefresh?.find((e) => e.id === rectId)
console.log(`>>> REPRO: 刷新后 state（来自服务端）: ${JSON.stringify(refreshRect)}`)

console.log('\n========== 复现结果 ==========')
console.log(`移动后本地:    x=${movedRect.x} y=${movedRect.y}`)
console.log(`重连后本地:    x=${reconnectedRect.x} y=${reconnectedRect.y}`)
console.log(`刷新后本地:    x=${refreshRect.x} y=${refreshRect.y}`)

await browser.close()
process.exit(0)
