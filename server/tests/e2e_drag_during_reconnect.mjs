/**
 * E2E 测试：用户拖动文本时重连（最关键场景）
 *
 * 1. 在线创建文本
 * 2. 选中文本
 * 3. 断网
 * 4. 开始拖动（mousedown 之后）
 * 5. 拖动过程中重连
 * 6. 继续拖动直到松手
 * 7. 验证服务端最终位置
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const TEST_EMAIL = `drag_reconnect_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'DragReconnect'

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
      await nameInput.fill('Drag Reconnect Board')
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

async function getElement(page, id) {
  return await page.evaluate((id) => {
    const store = window.__canvasStore
    if (!store) return null
    const el = store.getState().elements.find((e) => e.id === id)
    if (!el) return null
    return { id: el.id, type: el.type, x: el.x, y: el.y, width: el.width, height: el.height, text: el.text }
  }, id)
}

async function getOfflineQueueLength(page) {
  return await page.evaluate(() => {
    return window.__offlineQueue ? window.__offlineQueue.length : -1
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
    t.includes('error') ||
    t.includes('Text')
  ) {
    const line = `>>> ${t}`
    console.log(line)
    consoleLogs.push(line)
  }
})

console.log('=== 步骤 1-2: 注册登录 + 创建白板 ===')
await registerAndLogin(page)
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log('=== 步骤 3: 创建文本 ===')
const textId = await page.evaluate(() => {
  const store = window.__canvasStore
  const text = store.getState().createElement('text', {
    x: 100,
    y: 100,
    text: 'Hello World',
    fontSize: 16,
    width: 200,
    height: 32,
  })
  store.getState().addElement(text)
  return text.id
})
await page.waitForTimeout(1500)
const textInfo = await getElement(page, textId)
console.log(`文本初始: ${JSON.stringify(textInfo)}`)

console.log('=== 步骤 4: 选中文本 ===')
await page.evaluate((id) => {
  const store = window.__canvasStore
  store.getState().selectElement(id)
}, textId)
await page.waitForTimeout(300)

console.log('=== 步骤 5: 断网 ===')
await page.evaluate(() => {
  const socket = window.__socket
  if (socket) socket.disconnect()
})
await page.waitForTimeout(800)

console.log('=== 步骤 6: 开始拖动文本（断网状态下）===')
const textCenterX = textInfo.x + textInfo.width / 2 + 56
const textCenterY = textInfo.y + textInfo.height / 2 + 48
console.log(`文本中心（屏幕）: ${textCenterX}, ${textCenterY}`)

await page.mouse.move(textCenterX, textCenterY)
await page.mouse.down()
await page.waitForTimeout(100)

// 移动到一半（离线）
for (let i = 1; i <= 5; i++) {
  await page.mouse.move(textCenterX + i * 20, textCenterY + i * 10)
  await page.waitForTimeout(20)
}
await page.waitForTimeout(300)
const queueLenDuringOfflineMove = await getOfflineQueueLength(page)
console.log(`>>> 离线队列长度: ${queueLenDuringOfflineMove}`)

console.log('=== 步骤 7: 拖动过程中重连（关键场景）===')
await page.evaluate(() => {
  const socket = window.__socket
  if (socket) socket.connect()
})
// 不要等待，继续移动
await page.waitForTimeout(50)

for (let i = 6; i <= 15; i++) {
  await page.mouse.move(textCenterX + i * 20, textCenterY + i * 10)
  await page.waitForTimeout(20)
}

await page.mouse.up()
await page.waitForTimeout(500)

const textAfterDrag = await getElement(page, textId)
const expectedX = 100 + 15 * 20  // 起始 x=100, 移动 15*20=300
const expectedY = 100 + 15 * 10  // 起始 y=100, 移动 15*10=150
console.log(`\n>>> REPRO: 拖动后文本: x=${textAfterDrag.x} y=${textAfterDrag.y}`)
console.log(`>>> REPRO: 预期文本: x=${expectedX} y=${expectedY}`)
const dragDev = Math.abs(textAfterDrag.x - expectedX) > 0.5 || Math.abs(textAfterDrag.y - expectedY) > 0.5
console.log(`>>> REPRO: 偏差: ${dragDev ? '❌ 有偏差' : '✅ 正确'}`)

console.log('\n=== 步骤 8: 等待 ack ===')
await page.waitForTimeout(3000)

const textAfterAck = await getElement(page, textId)
console.log(`\n>>> REPRO: 重连后文本: x=${textAfterAck.x} y=${textAfterAck.y}`)

console.log('=== 步骤 9: 刷新页面 ===')
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)

const textAfterRefresh = await getElement(page, textId)
console.log(`\n>>> REPRO: 刷新后文本: x=${textAfterRefresh.x} y=${textAfterRefresh.y}`)

console.log('\n========== 复现结果 ==========')
console.log(`本地拖动后: x=${textAfterDrag.x} y=${textAfterDrag.y}`)
console.log(`重连后:    x=${textAfterAck.x} y=${textAfterAck.y}`)
console.log(`刷新后:    x=${textAfterRefresh.x} y=${textAfterRefresh.y}`)
console.log(`预期:      x=${expectedX} y=${expectedY}`)

const allMatch = textAfterDrag.x === textAfterAck.x && textAfterAck.x === textAfterRefresh.x &&
                  textAfterDrag.y === textAfterAck.y && textAfterAck.y === textAfterRefresh.y &&
                  textAfterDrag.x === expectedX && textAfterDrag.y === expectedY

console.log(`\n结果: ${allMatch ? '✅ 全部一致' : '❌ 不一致'}`)

await browser.close()
process.exit(allMatch ? 0 : 1)
