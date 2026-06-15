/**
 * 综合测试：验证快速重连场景下文本同步的所有边界情况
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const TEST_EMAIL = `text_comprehensive_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'TextComp'

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
      await nameInput.fill('Text Comp Board')
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

async function getAllElements(page) {
  return await page.evaluate(() => {
    const store = window.__canvasStore
    if (!store) return null
    return store.getState().elements.map((e) => ({
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      text: e.text,
    }))
  })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('[useSocketCollab]') || t.includes('error')) {
    console.log(`>>> ${t}`)
  }
})

console.log('=== 步骤 1-2: 注册登录 + 创建白板 ===')
await registerAndLogin(page)
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log('=== 场景 A: 长文本 + 快速重连 ===')
await page.evaluate(() => {
  const store = window.__canvasStore
  const text = store.getState().createElement('text', {
    x: 100,
    y: 100,
    text: '这是一段很长的文本内容用于测试文本元素的离线移动和重连同步',
    fontSize: 18,
    width: 400,
    height: 36,
  })
  store.getState().addElement(text)
})
await page.waitForTimeout(1500)
const textId = (await getAllElements(page))[0].id
await page.evaluate((id) => {
  window.__canvasStore.getState().selectElement(id)
}, textId)
await page.waitForTimeout(300)

await page.evaluate(() => window.__socket.disconnect())
await page.waitForTimeout(500)

const textCenterX = 100 + 200 + 56
const textCenterY = 100 + 18 + 48
await page.mouse.move(textCenterX, textCenterY)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(textCenterX + i * 20, textCenterY + i * 10)
  await page.waitForTimeout(20)
}
await page.mouse.up()
await page.waitForTimeout(300)
const aAfter = (await getAllElements(page))[0]
console.log(`A 离线后: x=${aAfter.x} y=${aAfter.y}`)

await page.evaluate(() => window.__socket.connect())
await page.waitForTimeout(1500)  // 短等待，模拟快速重连
const aReconnected = (await getAllElements(page))[0]
console.log(`A 重连后: x=${aReconnected.x} y=${aReconnected.y}`)

await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)
const aRefreshed = (await getAllElements(page))[0]
console.log(`A 刷新后: x=${aRefreshed.x} y=${aRefreshed.y}`)

const aExpected = { x: 300, y: 200 }
const aOK = Math.abs(aAfter.x - aExpected.x) < 0.5 && Math.abs(aAfter.y - aExpected.y) < 0.5 &&
            Math.abs(aReconnected.x - aExpected.x) < 0.5 && Math.abs(aReconnected.y - aExpected.y) < 0.5 &&
            Math.abs(aRefreshed.x - aExpected.x) < 0.5 && Math.abs(aRefreshed.y - aExpected.y) < 0.5
console.log(`A 结果: ${aOK ? '✅ 一致' : '❌ 偏差'}`)
console.log(`A 文本内容保持: ${aRefreshed.text === '这是一段很长的文本内容用于测试文本元素的离线移动和重连同步' ? '✅' : '❌'}`)

console.log('\n=== 场景 B: 多选（文本+矩形）+ 快速重连 ===')
await page.evaluate(() => {
  const store = window.__canvasStore
  store.getState().selectAll()
})
await page.waitForTimeout(300)

await page.evaluate(() => window.__socket.disconnect())
await page.waitForTimeout(500)

const elems = await getAllElements(page)
const text = elems.find(e => e.type === 'text')
const rect = elems.find(e => e.type === 'rect')

const dragCenterX = Math.max(text.x, rect.x) + 50 + 56
const dragCenterY = Math.min(text.y, rect.y) + 18 + 48
await page.mouse.move(dragCenterX, dragCenterY)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(dragCenterX + i * 15, dragCenterY + i * 8)
  await page.waitForTimeout(20)
}
await page.mouse.up()
await page.waitForTimeout(300)
const bAfter = await getAllElements(page)
const bText = bAfter.find(e => e.type === 'text')
const bRect = bAfter.find(e => e.type === 'rect')
console.log(`B 离线后: text=(${bText.x},${bText.y}) rect=(${bRect.x},${bRect.y})`)

await page.evaluate(() => window.__socket.connect())
await page.waitForTimeout(1500)
const bReconnected = await getAllElements(page)
const bTextR = bReconnected.find(e => e.type === 'text')
const bRectR = bReconnected.find(e => e.type === 'rect')
console.log(`B 重连后: text=(${bTextR.x},${bTextR.y}) rect=(${bRectR.x},${bRectR.y})`)

await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)
const bRefreshed = await getAllElements(page)
const bTextF = bRefreshed.find(e => e.type === 'text')
const bRectF = bRefreshed.find(e => e.type === 'rect')
console.log(`B 刷新后: text=(${bTextF.x},${bTextF.y}) rect=(${bRectF.x},${bRectF.y})`)

const bTextOK = bText.x === bTextR.x && bTextR.x === bTextF.x && bText.y === bTextR.y && bTextR.y === bTextF.y
const bRectOK = bRect.x === bRectR.x && bRectR.x === bRectF.x && bRect.y === bRectR.y && bRectR.y === bRectF.y
console.log(`B 文本一致: ${bTextOK ? '✅' : '❌'}  矩形一致: ${bRectOK ? '✅' : '❌'}`)

await browser.close()

console.log('\n========== 总结 ==========')
console.log(`A 长文本:    ${aOK ? '✅' : '❌'}`)
console.log(`B 多选:     文本${bTextOK ? '✅' : '❌'} 矩形${bRectOK ? '✅' : '❌'}`)

process.exit(aOK && bTextOK && bRectOK ? 0 : 1)
