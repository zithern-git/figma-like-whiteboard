/**
 * E2E 测试：精确复现"离线移动后位置随机变化"问题
 *
 * 场景：
 * 1. 创建白板 + 添加矩形（初始位置可记录）
 * 2. 断网（socket.disconnect）
 * 3. 离线状态下，鼠标移动到矩形上，按下，拖动到 (650, 240)
 * 4. 鼠标释放
 * 5. 读取本地 state，记录矩形位置
 * 6. 重连（socket.connect）
 * 7. 等待重连 + 合并完成
 * 8. 再次读取本地 state
 * 9. 对比
 *
 * 同时在控制台记录 offlineQueue 的内容、每个 op 的 updates、merge 后的最终值
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const API_URL = process.env.API_URL || 'http://localhost:3001/api'

const TEST_EMAIL = `repro_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'ReproTest'

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
      await nameInput.fill('Repro Test Board')
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

async function getOfflineQueue(page) {
  // 临时补丁：暴露 offlineQueue 到 window
  return await page.evaluate(() => {
    const socket = window.__socket
    if (!socket) return null
    return {
      connected: socket.connected,
      // 我们没有直接暴露 offlineQueue，但我们可以通过 store 反推
      elements: window.__canvasStore.getState().elements.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
      })),
    }
  })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const consoleLogs = []
page.on('console', (msg) => {
  const t = msg.text()
  if (
    t.includes('[useSocketCollab]') ||
    t.includes('[broadcastOp]') ||
    t.includes('merge') ||
    t.includes('[element-op]') ||
    t.includes('offline') ||
    t.includes('REPRO') ||
    t.includes('error')
  ) {
    const line = `>>> ${t}`
    console.log(line)
    consoleLogs.push(line)
  }
})

// 监听 socket 错误事件
page.on('pageerror', (err) => {
  console.log(`>>> PAGE ERROR: ${err.message}`)
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

console.log('=== 步骤 5: 离线移动矩形到 (650, 240) ===')
// 切到选择工具
const selectBtn = page.locator('button[title*="选择"], button:has-text("选择"), [data-tool="select"]').first()
if (await selectBtn.isVisible().catch(() => false)) {
  await selectBtn.click()
  await page.waitForTimeout(300)
}

// 矩形的初始位置（stateAfterA[0]）和大小（80, 80）我们知道了。
// 但要拖到世界坐标 (650, 240) 需要把屏幕坐标转世界坐标。
// viewport 默认 translateX=0, translateY=0, zoom=1，所以屏幕坐标 = 世界坐标。
// 矩形中心在 (240, 190)。要移动到 (650, 240)，需要把中心从 (240, 190) 拖到 (650, 240)。
// 拖动增量：(410, 50)。
// 鼠标按下在矩形中心 (240, 190)，然后 30 步拖到 (650, 240)。

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
  await page.waitForTimeout(30)
}
await page.mouse.up()
await page.waitForTimeout(500)

const stateAfterMove = await getElementState(page)
const movedRect = stateAfterMove?.find((e) => e.id === rectId)
console.log(`\n>>> REPRO: 离线移动后本地 state:`)
console.log(`>>> REPRO: ${JSON.stringify(movedRect)}`)
console.log(`>>> REPRO: 期望 x=650 y=240`)

if (movedRect.x === 650 && movedRect.y === 240) {
  console.log(`✅ 离线移动到正确位置 (${movedRect.x}, ${movedRect.y})`)
} else {
  console.log(`⚠️ 离线移动位置偏差: 实际 (${movedRect.x}, ${movedRect.y})，期望 (650, 240)`)
  console.log(`   偏差: (${movedRect.x - 650}, ${movedRect.y - 240})`)
}

// 打印离线队列中的所有 op
const queueContent = await page.evaluate(() => {
  return (window.__offlineQueue || []).map((op) => ({
    opType: op.opType,
    payload: op.payload,
  }))
})
console.log(`\n>>> REPRO: 离线队列中共有 ${queueContent.length} 条 op:`)
queueContent.forEach((op, i) => {
  console.log(`  [${i}] opType=${op.opType} payload=${JSON.stringify(op.payload)}`)
})
const lastUpdate = queueContent.filter((o) => o.opType === 'update').pop()
console.log(`>>> REPRO: 最后一个 update op 的 payload: ${JSON.stringify(lastUpdate)}`)

console.log('=== 步骤 6: 重连 ===')
await page.evaluate(() => {
  const socket = window.__socket
  if (!socket) return
  console.log('>>> REPRO: 调用 socket.connect() 触发重连')
  socket.connect()
})
console.log('等待 8 秒让 socket 重连 + 补发 + 合并 + 服务端持久化...')
await page.waitForTimeout(8000)

const reconnected = await page.evaluate(() => window.__socket?.connected)
console.log(`重连后 socket.connected = ${reconnected}`)

const stateAfterReconnect = await getElementState(page)
const reconnectedRect = stateAfterReconnect?.find((e) => e.id === rectId)
console.log(`\n>>> REPRO: 重连后本地 state:`)
console.log(`>>> REPRO: ${JSON.stringify(reconnectedRect)}`)
console.log(`>>> REPRO: 期望 x=650 y=240`)

if (reconnectedRect.x === 650 && reconnectedRect.y === 240) {
  console.log(`✅ 重连后位置正确 (${reconnectedRect.x}, ${reconnectedRect.y})`)
} else {
  console.log(`❌ 重连后位置错误: 实际 (${reconnectedRect.x}, ${reconnectedRect.y})，期望 (650, 240)`)
  console.log(`   偏差: (${reconnectedRect.x - 650}, ${reconnectedRect.y - 240})`)
}

console.log('=== 步骤 7: 刷新页面，从服务端拉取最新状态 ===')
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)

const stateAfterRefresh = await getElementState(page)
const refreshRect = stateAfterRefresh?.find((e) => e.id === rectId)
console.log(`\n>>> REPRO: 刷新后 state（来自服务端）:`)
console.log(`>>> REPRO: ${JSON.stringify(refreshRect)}`)

// 汇总
console.log('\n========== 复现结果 ==========')
console.log(`移动后本地: x=${movedRect.x} y=${movedRect.y}`)
console.log(`重连后本地: x=${reconnectedRect.x} y=${reconnectedRect.y}`)
console.log(`刷新后本地: x=${refreshRect.x} y=${refreshRect.y}`)
console.log(`期望: x=650 y=240`)

await browser.close()
process.exit(0)
