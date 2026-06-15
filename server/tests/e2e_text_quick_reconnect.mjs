/**
 * E2E 测试：快速重连场景下文本和图形的对比
 *
 * 关键场景：用户正在拖动 → 网络断开 → 继续拖动 → 网络恢复
 * 验证：
 * 1. 本地状态正确反映最终位置
 * 2. 服务端最终位置与本地一致
 * 3. 刷新页面后位置正确
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const TEST_EMAIL = `text_quick_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'TextQuick'

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
      await nameInput.fill('Text Quick Board')
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

async function getElement(page, type) {
  return await page.evaluate((t) => {
    const store = window.__canvasStore
    if (!store) return null
    const el = store.getState().elements.find((e) => e.type === t)
    if (!el) return null
    return { id: el.id, type: el.type, x: el.x, y: el.y, width: el.width, height: el.height, text: el.text }
  }, type)
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

console.log('=== 步骤 1: 注册登录 ===')
await registerAndLogin(page)
console.log(`✅ 登录: ${page.url()}`)

console.log('=== 步骤 2: 创建白板 ===')
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log('=== 步骤 3: 创建文本元素和矩形元素 ===')
await page.evaluate(() => {
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
  const rect = store.getState().createElement('rect', {
    x: 300,
    y: 100,
    width: 100,
    height: 100,
  })
  store.getState().addElement(rect)
})
await page.waitForTimeout(1500)

const textInfo = await getElement(page, 'text')
const rectInfo = await getElement(page, 'rect')
console.log(`文本: ${JSON.stringify(textInfo)}`)
console.log(`矩形: ${JSON.stringify(rectInfo)}`)

console.log('=== 步骤 4: 选中文本和矩形 ===')
await page.evaluate(() => {
  const store = window.__canvasStore
  store.getState().selectAll()
})
await page.waitForTimeout(300)

console.log('=== 步骤 5: 断网 ===')
await page.evaluate(() => {
  const socket = window.__socket
  if (socket) socket.disconnect()
})
await page.waitForTimeout(800)

console.log('=== 步骤 6: 离线移动（一次）文本到 (500, 200) ===')
const textCenterX = textInfo.x + textInfo.width / 2 + 56
const textCenterY = textInfo.y + textInfo.height / 2 + 48
// 第一次移动：纯粹离线
await page.mouse.move(textCenterX, textCenterY)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(textCenterX + i * 20, textCenterY + i * 10)
  await page.waitForTimeout(20)
}
await page.mouse.up()
await page.waitForTimeout(500)
const textAfterMove1 = await getElement(page, 'text')
console.log(`文本离线移动后: x=${textAfterMove1.x} y=${textAfterMove1.y}`)
const expectedText1 = { x: 300, y: 200 }
console.log(`文本预期: x=${expectedText1.x} y=${expectedText1.y}`)
const textDev1 = Math.abs(textAfterMove1.x - expectedText1.x) > 0.5 || Math.abs(textAfterMove1.y - expectedText1.y) > 0.5
console.log(`文本偏差: ${textDev1 ? '❌ 有偏差' : '✅ 正确'}`)

console.log('\n=== 步骤 7: 移动矩形到 (500, 200) ===')
const rectCenterX = rectInfo.x + rectInfo.width / 2 + 56
const rectCenterY = rectInfo.y + rectInfo.height / 2 + 48
await page.mouse.move(rectCenterX, rectCenterY)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(rectCenterX + i * 20, rectCenterY + i * 10)
  await page.waitForTimeout(20)
}
await page.mouse.up()
await page.waitForTimeout(500)
const rectAfterMove1 = await getElement(page, 'rect')
console.log(`矩形离线移动后: x=${rectAfterMove1.x} y=${rectAfterMove1.y}`)
const expectedRect1 = { x: 500, y: 200 }
console.log(`矩形预期: x=${expectedRect1.x} y=${expectedRect1.y}`)
const rectDev1 = Math.abs(rectAfterMove1.x - expectedRect1.x) > 0.5 || Math.abs(rectAfterMove1.y - expectedRect1.y) > 0.5
console.log(`矩形偏差: ${rectDev1 ? '❌ 有偏差' : '✅ 正确'}`)

console.log('\n=== 步骤 8: 立即重连（快速重连）===')
await page.evaluate(() => {
  const socket = window.__socket
  if (socket) socket.connect()
})
// 短等待（快速重连场景）
await page.waitForTimeout(2500)

const textAfterReconnect = await getElement(page, 'text')
const rectAfterReconnect = await getElement(page, 'rect')
console.log(`重连后文本: x=${textAfterReconnect.x} y=${textAfterReconnect.y}`)
console.log(`重连后矩形: x=${rectAfterReconnect.x} y=${rectAfterReconnect.y}`)

console.log('\n=== 步骤 9: 刷新页面，从服务端拉取 ===')
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)

const textAfterRefresh = await getElement(page, 'text')
const rectAfterRefresh = await getElement(page, 'rect')
console.log(`刷新后文本: x=${textAfterRefresh.x} y=${textAfterRefresh.y}`)
console.log(`刷新后矩形: x=${rectAfterRefresh.x} y=${rectAfterRefresh.y}`)

console.log('\n========== 复现结果 ==========')
console.log(`\n【文本】`)
console.log(`  离线移动后:  x=${textAfterMove1.x} y=${textAfterMove1.y}`)
console.log(`  重连后:     x=${textAfterReconnect.x} y=${textAfterReconnect.y}`)
console.log(`  刷新后:     x=${textAfterRefresh.x} y=${textAfterRefresh.y}`)
const textOk = textAfterMove1.x === textAfterReconnect.x && textAfterReconnect.x === textAfterRefresh.x &&
               textAfterMove1.y === textAfterReconnect.y && textAfterReconnect.y === textAfterRefresh.y
console.log(`  状态一致性: ${textOk ? '✅ 一致' : '❌ 不一致'}`)

console.log(`\n【矩形】`)
console.log(`  离线移动后:  x=${rectAfterMove1.x} y=${rectAfterMove1.y}`)
console.log(`  重连后:     x=${rectAfterReconnect.x} y=${rectAfterReconnect.y}`)
console.log(`  刷新后:     x=${rectAfterRefresh.x} y=${rectAfterRefresh.y}`)
const rectOk = rectAfterMove1.x === rectAfterReconnect.x && rectAfterReconnect.x === rectAfterRefresh.x &&
               rectAfterMove1.y === rectAfterReconnect.y && rectAfterReconnect.y === rectAfterRefresh.y
console.log(`  状态一致性: ${rectOk ? '✅ 一致' : '❌ 不一致'}`)

await browser.close()
process.exit(textOk && rectOk ? 0 : 1)
