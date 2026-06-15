/**
 * E2E 测试：检查移动 text vs rect 时的 op diff
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const API_URL = process.env.API_URL || 'http://localhost:3001/api'

const TEST_EMAIL = `text_repro_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'TextRepro'

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
      await nameInput.fill('Text Repro Board')
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
      text: e.text,
      fontSize: e.fontSize,
    }))
  })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

// 捕获所有 console 包含 broadcastOp/op 详细
const consoleLogs = []
page.on('console', (msg) => {
  const t = msg.text()
  if (
    t.includes('[useSocketCollab]') ||
    t.includes('merge') ||
    t.includes('offline') ||
    t.includes('REPRO') ||
    t.includes('error') ||
    t.includes('Text') ||
    t.includes('text')
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

console.log('=== 步骤 3: 在线添加文本元素 ===')
// 切到选择工具（避免点 canvas 时触发其他工具）
const selectBtn = page.locator('button[title*="选择"], button:has-text("选择")').first()
if (await selectBtn.isVisible().catch(() => false)) {
  await selectBtn.click()
  await page.waitForTimeout(300)
}

// 通过 store 直接添加一个 text 元素（避免 textarea 的复杂性）
const textEl = await page.evaluate(() => {
  const store = window.__canvasStore
  if (!store) return null
  const el = store.getState().createElement('text', {
    x: 100,
    y: 100,
    text: 'Hello World',
    fontSize: 16,
    width: 200,
    height: 32,
  })
  store.getState().addElement(el)
  return el
})
console.log(`文本添加: ${JSON.stringify(textEl)}`)
await page.waitForTimeout(1500)

let stateAfterText = await getElementState(page)
console.log(`文本添加后: ${JSON.stringify(stateAfterText)}`)

// 也加一个矩形
console.log('=== 步骤 4: 在线添加矩形（对照）===')
const rectEl = await page.evaluate(() => {
  const store = window.__canvasStore
  if (!store) return null
  const el = store.getState().createElement('rect', {
    x: 200,
    y: 200,
    width: 80,
    height: 80,
  })
  store.getState().addElement(el)
  return el
})
console.log(`矩形添加: ${JSON.stringify(rectEl)}`)
await page.waitForTimeout(1500)

stateAfterText = await getElementState(page)
console.log(`所有元素: ${JSON.stringify(stateAfterText)}`)
const textInfo = stateAfterText.find((e) => e.type === 'text')
const rectInfo = stateAfterText.find((e) => e.type === 'rect')

console.log('=== 步骤 5: 断网 ===')
await page.evaluate(() => {
  const socket = window.__socket
  if (!socket) return
  socket.disconnect()
})
await page.waitForTimeout(1000)
// 切到选择工具（重命名避免冲突）
const selectBtn2 = page.locator('button[title*="选择"], button:has-text("选择"), [data-tool="select"]').first()
if (await selectBtn2.isVisible().catch(() => false)) {
  await selectBtn2.click()
  await page.waitForTimeout(300)
}

console.log('=== 步骤 6: 离线移动文本 ===')
// 文本中心（width=200, height=32 大致）的中心
const textCenterX = (textInfo.x + (textInfo.width || 200) / 2) + 56  // 56 toolbar
const textCenterY = (textInfo.y + (textInfo.height || 32) / 2) + 48  // 48 header
console.log(`文本中心（屏幕）: ${textCenterX}, ${textCenterY}`)

await page.mouse.move(textCenterX, textCenterY)
await page.mouse.down()
await page.waitForTimeout(100)
const textTargetX = textCenterX + 200
const textTargetY = textCenterY + 100
for (let i = 1; i <= 10; i++) {
  const t = i / 10
  await page.mouse.move(
    textCenterX + (textTargetX - textCenterX) * t,
    textCenterY + (textTargetY - textCenterY) * t
  )
  await page.waitForTimeout(20)
}
await page.mouse.up()
await page.waitForTimeout(500)

const stateAfterTextMove = await getElementState(page)
const textAfter = stateAfterTextMove.find((e) => e.type === 'text')
console.log(`\n>>> REPRO: 离线移动文本后: ${JSON.stringify(textAfter)}`)
console.log(`>>> 期望 x=${(textInfo.x + 200).toFixed(1)} y=${(textInfo.y + 100).toFixed(1)}`)

// 暴露 offlineQueue 给测试
const queueContent = await page.evaluate(() => {
  const q = window.__offlineQueue || []
  return q.filter((op) => op.opType === 'update').map((op) => op.payload)
})
console.log(`\n>>> REPRO: 离线队列中 update op 数量: ${queueContent.length}`)
console.log(`>>> REPRO: 前 3 个 op:`)
queueContent.slice(0, 3).forEach((p, i) => {
  console.log(`  [${i}] ${JSON.stringify(p)}`)
})
console.log(`>>> REPRO: 最后一个 op:`)
if (queueContent.length > 0) {
  console.log(`  ${JSON.stringify(queueContent[queueContent.length - 1])}`)
}

console.log('\n=== 步骤 7: 立即重连 ===')
await page.evaluate(() => {
  const socket = window.__socket
  if (!socket) return
  socket.connect()
})
await page.waitForTimeout(5000)

const stateAfterReconnect = await getElementState(page)
const textReconnected = stateAfterReconnect.find((e) => e.type === 'text')
console.log(`\n>>> REPRO: 重连后文本: ${JSON.stringify(textReconnected)}`)

console.log('=== 步骤 8: 刷新页面，从服务端拉取 ===')
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)

const stateAfterRefresh = await getElementState(page)
const textRefresh = stateAfterRefresh.find((e) => e.type === 'text')
console.log(`\n>>> REPRO: 刷新后文本（来自服务端）: ${JSON.stringify(textRefresh)}`)

console.log('\n========== 复现结果 ==========')
console.log(`文本移动后本地: x=${textAfter.x} y=${textAfter.y}`)
console.log(`文本重连后本地: x=${textReconnected.x} y=${textReconnected.y}`)
console.log(`文本刷新后本地: x=${textRefresh.x} y=${textRefresh.y}`)

await browser.close()
process.exit(0)
