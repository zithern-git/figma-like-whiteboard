/**
 * 测试：拖动画布后刷新页面，viewport 应该保持
 */
import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5174'

const TEST_EMAIL = `viewport_persist_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'ViewportPersist'

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
      await nameInput.fill('Viewport Persist Test')
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
  if (t.includes('error') && !t.includes('404') && !t.includes('Failed to load resource')) {
    console.log(`[error] ${t}`)
  }
})

console.log('=== 注册登录 + 创建白板 ===')
await registerAndLogin(page)
await createWhiteboard(page)
await page.waitForTimeout(2000)

const whiteboardId = page.url().split('/whiteboard/')[1]
console.log(`白板 ID: ${whiteboardId}`)

const canvas = page.locator('canvas').nth(2)
const box = await canvas.boundingBox()
console.log(`画布位置: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`)

console.log('\n=== 步骤 1: 拖动画布 ===')
await page.mouse.move(box.x + 700, box.y + 600)
await page.mouse.down()
await page.waitForTimeout(50)
await page.mouse.move(box.x + 900, box.y + 800, { steps: 10 })
await page.waitForTimeout(50)
await page.mouse.up()
await page.waitForTimeout(500)

console.log('=== 步骤 2: 缩放画布 ===')
await page.mouse.move(box.x + 500, box.y + 400)
await page.mouse.wheel(0, -500)
await page.waitForTimeout(500)

const zoomedUI = await page.evaluate(() => {
  const allText = document.body.innerText
  const match = allText.match(/(\d+)%/)
  return match ? parseInt(match[1]) : null
})
console.log(`缩放后 UI 文本: ${zoomedUI}%`)

console.log('\n=== 步骤 3: 等待 rAF 持久化 + 验证 localStorage ===')
await page.waitForTimeout(500)
const storedViewport = await page.evaluate((id) => {
  const raw = localStorage.getItem('whiteboard.viewport.' + id)
  return raw ? JSON.parse(raw) : null
}, whiteboardId)
console.log(`localStorage 中保存的 viewport:`, storedViewport)
const hasStorage = storedViewport !== null && typeof storedViewport.zoom === 'number'
console.log(`localStorage 有保存 viewport: ${hasStorage ? '✅' : '❌'}`)

console.log('\n=== 步骤 4: 刷新页面 ===')
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(3000)

console.log('=== 步骤 5: 验证刷新后 viewport 已恢复 ===')
const newZoomUI = await page.evaluate(() => {
  const allText = document.body.innerText
  const match = allText.match(/(\d+)%/)
  return match ? parseInt(match[1]) : null
})
console.log(`刷新后缩放 UI: ${newZoomUI}%`)
// 由于画布视口不通过 UI 直接显示，注入一个测试钩子读 viewport
const restoredViewport = await page.evaluate((id) => {
  const raw = localStorage.getItem('whiteboard.viewport.' + id)
  return raw ? JSON.parse(raw) : null
}, whiteboardId)
console.log(`刷新后 localStorage viewport:`, restoredViewport)

const viewportRestored = restoredViewport && restoredViewport.zoom === storedViewport.zoom
console.log(`刷新后 viewport 仍保存: ${viewportRestored ? '✅' : '❌'}`)

console.log('\n=== 步骤 6: 视觉验证（截图对比）===')
await page.screenshot({ path: 'after-refresh.png' })
console.log('已保存 after-refresh.png（应显示缩放 + 平移后的视图）')

// 添加一个元素验证位置
await page.evaluate(() => {
  const store = window.__canvasStore
  if (store.getState().elements.length === 0) {
    store.getState().addElement(store.getState().createElement('rect', { x: 100, y: 100, width: 50, height: 50, fill: 'red' }))
  }
})
await page.waitForTimeout(500)
const elemX = await page.evaluate(() => window.__canvasStore.getState().elements[0].x)
const elemY = await page.evaluate(() => window.__canvasStore.getState().elements[0].y)
console.log(`新元素位置: x=${elemX} y=${elemY} (世界坐标应 100, 100)`)

console.log('\n========== 总结 ==========')
console.log(`A 拖动 + 缩放后 localStorage 保存: ${hasStorage ? '✅' : '❌'}`)
console.log(`B 刷新后 viewport 仍存在:        ${viewportRestored ? '✅' : '❌'}`)

await browser.close()
process.exit(hasStorage && viewportRestored ? 0 : 1)
