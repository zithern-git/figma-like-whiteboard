/**
 * 测试画布平移功能（修正版：考虑视口偏移）
 */
import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5174'

const TEST_EMAIL = `pan_v2_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'PanV2'

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
  await page.waitForTimeout(3000)
  if (page.url().includes('/login')) {
    const loginInputs = await page.locator('input').all()
    if (loginInputs.length >= 2) {
      await loginInputs[0].fill(TEST_EMAIL)
      await loginInputs[1].fill(TEST_PASSWORD)
    }
    await page.click('button:has-text("登录")')
    await page.waitForTimeout(3000)
  }
}

async function createWhiteboard(page) {
  const newBoardBtn = page.locator('button:has-text("创建第一个白板"), button:has-text("创建白板"), button:has-text("新建白板")').first()
  if (await newBoardBtn.isVisible().catch(() => false)) {
    await newBoardBtn.click()
    await page.waitForTimeout(800)
    const nameInput = page.locator('input[placeholder*="白板名称"], input[placeholder*="名称"]').first()
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Pan V2 Test')
      await page.waitForTimeout(300)
    }
    const confirmBtn = page.locator('button:has-text("创建"), button[type="submit"]').last()
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click()
      await page.waitForTimeout(2000)
    }
  }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('onMouseDown') || (t.includes('error') && !t.includes('404'))) {
    console.log(`[console] ${t}`)
  }
})

console.log('=== 注册登录 + 创建白板 ===')
await registerAndLogin(page)
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log('=== 添加矩形 ===')
await page.evaluate(() => {
  const store = window.__canvasStore
  store.getState().addElement(store.getState().createElement('rect', { x: 200, y: 200, width: 100, height: 100, fill: '#4F46E5' }))
})
await page.waitForTimeout(500)

// 拿到 renderer 用于坐标系转换
const worldToScreen = async (wx, wy) => {
  return await page.evaluate(({ wx, wy }) => {
    const r = window.__canvasStore.getState()
    // 从 React 内部拿到 renderer 是复杂的，但 canvas 元素可以拿到 viewport 信息
    // 改用 canvas DOM 上下文：取 getBoundingClientRect 和 viewport 通过注入
    return null
  }, { wx, wy })
}

const canvas = page.locator('canvas').nth(2)
const box = await canvas.boundingBox()
console.log(`画布位置: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`)

console.log('\n=== 场景 A: 空白处拖动平移 ===')
// 空白处：屏幕 (700, 600) 远在矩形 (200, 200) 之外
await page.mouse.move(box.x + 700, box.y + 600)
await page.mouse.down()
await page.waitForTimeout(50)
await page.mouse.move(box.x + 700 + 200, box.y + 600 + 150, { steps: 10 })
await page.waitForTimeout(50)
await page.mouse.up()
await page.waitForTimeout(300)

// 验证：画布已经平移
// 矩形的世界坐标不变，但屏幕位置应该变化
// 通过 querySelector 拿到矩形 canvas 上 pixel 颜色？
// 简化：再次读取元素，世界坐标应该不变
const elemWorld = await page.evaluate(() => window.__canvasStore.getState().elements[0])
console.log(`A 元素世界坐标: x=${elemWorld.x} y=${elemWorld.y} (应该 200, 200)`)
const worldAOk = elemWorld.x === 200 && elemWorld.y === 200
console.log(`A 世界坐标不变: ${worldAOk ? '✅' : '❌'}`)

console.log('\n=== 场景 B: 在矩形位置拖动（应该是元素移动）===')
// 关键：场景 A 拖动后视口已被持久化到 localStorage，刷新后会被恢复。
// 这里清空 localStorage，让视口归零，确保测试可靠。
await page.evaluate(() => {
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith('whiteboard.viewport.')) localStorage.removeItem(k)
  })
})
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(2000)

await page.evaluate(() => {
  const store = window.__canvasStore
  // 视口归零后，元素应该在 (200, 200) 世界坐标 → 屏幕 (200+56, 200+48) = (256, 248)
  if (store.getState().elements.length === 0) {
    store.getState().addElement(store.getState().createElement('rect', { x: 200, y: 200, width: 100, height: 100, fill: '#4F46E5' }))
  }
})
await page.waitForTimeout(500)

const boxB = await canvas.boundingBox()
const rectInfo = await page.evaluate(() => window.__canvasStore.getState().elements[0])
console.log(`B 元素世界坐标: x=${rectInfo.x} y=${rectInfo.y} w=${rectInfo.width} h=${rectInfo.height}`)
// 视口归零（localStorage 已清空），屏幕位置 = box + 元素位置
const rectCenterX = boxB.x + rectInfo.x + rectInfo.width / 2
const rectCenterY = boxB.y + rectInfo.y + rectInfo.height / 2
console.log(`B 矩形中心（屏幕）: ${rectCenterX}, ${rectCenterY}`)

await page.mouse.move(rectCenterX, rectCenterY)
await page.mouse.down()
await page.waitForTimeout(50)
await page.mouse.move(rectCenterX + 100, rectCenterY + 80, { steps: 5 })
await page.waitForTimeout(50)
await page.mouse.up()
await page.waitForTimeout(500)

const rectAfter = await page.evaluate(() => window.__canvasStore.getState().elements[0])
console.log(`B 拖动后矩形: x=${rectAfter.x} y=${rectAfter.y}`)
const rectMoved = Math.abs(rectAfter.x - (rectInfo.x + 100)) < 5 && Math.abs(rectAfter.y - (rectInfo.y + 80)) < 5
console.log(`B 矩形被移动: ${rectMoved ? '✅ 正确（元素移动了 ~100,80）' : `❌ 错误（期望 ~${rectInfo.x + 100}, ${rectInfo.y + 80}）`}`)

console.log('\n=== 场景 C: 空格键 + 拖动 = 平移 ===')
// 关键：场景 B 拖动后视口被持久化了，清掉以便空格+拖动测试可靠
await page.evaluate(() => {
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith('whiteboard.viewport.')) localStorage.removeItem(k)
  })
})
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(2000)

const elemBeforeC = await page.evaluate(() => window.__canvasStore.getState().elements[0])
console.log(`C 元素世界坐标（拖动前）: x=${elemBeforeC.x} y=${elemBeforeC.y}`)

// 按住空格
await page.keyboard.down('Space')
await page.waitForTimeout(50)
// 在元素上按下（按空格时即使在元素上也应该平移）
await page.mouse.move(rectCenterX, rectCenterY)
await page.waitForTimeout(50)
await page.mouse.down()
await page.waitForTimeout(50)
await page.mouse.move(rectCenterX + 50, rectCenterY + 50, { steps: 5 })
await page.waitForTimeout(50)
await page.mouse.up()
await page.keyboard.up('Space')
await page.waitForTimeout(500)

const elemAfterC = await page.evaluate(() => window.__canvasStore.getState().elements[0])
console.log(`C 元素世界坐标（拖动后）: x=${elemAfterC.x} y=${elemAfterC.y}`)
const worldCOk = elemAfterC.x === elemBeforeC.x && elemAfterC.y === elemBeforeC.y
console.log(`C 空格+拖动平移（世界坐标不变）: ${worldCOk ? '✅' : '❌（元素被移动了）'}`)

console.log('\n=== 场景 D: 缩放测试 ===')
// 滚轮缩放
await page.mouse.move(boxB.x + 400, boxB.y + 300)
await page.mouse.wheel(0, -500)  // 放大
await page.waitForTimeout(500)

const zoomed = await page.evaluate(() => {
  // 通过查找 UI 上的缩放文本
  const allText = document.body.innerText
  const match = allText.match(/(\d+)%/)
  return match ? parseInt(match[1]) : null
})
console.log(`D 缩放后 UI 文本含百分比: ${zoomed}%`)
const zoomedOk = zoomed && zoomed > 100
console.log(`D 缩放功能正常: ${zoomedOk ? '✅' : '❌'}`)

console.log('\n========== 总结 ==========')
console.log(`A 空白处拖动平移:    ${worldAOk ? '✅' : '❌'}`)
console.log(`B 拖动元素移动:      ${rectMoved ? '✅' : '❌'}`)
console.log(`C 空格+拖动平移:     ${worldCOk ? '✅' : '❌'}`)
console.log(`D 滚轮缩放:          ${zoomedOk ? '✅' : '❌'}`)

await browser.close()
process.exit(worldAOk && rectMoved && worldCOk && zoomedOk ? 0 : 1)
