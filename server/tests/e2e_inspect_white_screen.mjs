/**
 * 复现右键检查白屏问题
 */
import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5174'

const TEST_EMAIL = `inspect_test_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'InspectTest'

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
      await nameInput.fill('Inspect Test')
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

const consoleLogs = []
page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`))

console.log('=== 注册登录 + 创建白板 ===')
await registerAndLogin(page)
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log(`当前 URL: ${page.url()}`)

// 添加一些元素让画布有内容
await page.evaluate(() => {
  const store = window.__canvasStore
  store.getState().addElement(store.getState().createElement('rect', { x: 100, y: 100, width: 200, height: 150 }))
  store.getState().addElement(store.getState().createElement('text', { x: 400, y: 200, text: 'Hello', width: 200, height: 32 }))
  store.getState().addElement(store.getState().createElement('circle', { x: 700, y: 300, width: 100, height: 100 }))
})
await page.waitForTimeout(500)

console.log('=== 检查画布 DOM 结构 ===')
const canvasInfo = await page.evaluate(() => {
  const canvases = document.querySelectorAll('canvas')
  return Array.from(canvases).map((c, i) => ({
    index: i,
    width: c.width,
    height: c.height,
    cssWidth: c.style.width,
    cssHeight: c.style.height,
    className: c.className,
    parent: c.parentElement?.className,
  }))
})
console.log('Canvas 元素:')
canvasInfo.forEach(c => console.log(`  [${c.index}] ${c.width}x${c.height} css=${c.cssWidth}x${c.cssHeight} class=${c.className} parent=${c.parent}`))

console.log('\n=== 检查 parent div 样式 ===')
const parentStyles = await page.evaluate(() => {
  const container = document.querySelector('canvas')?.parentElement
  if (!container) return null
  const styles = window.getComputedStyle(container)
  return {
    className: container.className,
    position: styles.position,
    width: styles.width,
    height: styles.height,
    overflow: styles.overflow,
    display: styles.display,
  }
})
console.log('Parent div:', JSON.stringify(parentStyles, null, 2))

console.log('\n=== 模拟右键点击（contextmenu）===')
const canvas = page.locator('canvas').first()
const box = await canvas.boundingBox()
if (box) {
  console.log(`Canvas 位置: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`)
  // 触发 contextmenu 事件
  await canvas.click({ button: 'right', position: { x: 100, y: 100 } })
  await page.waitForTimeout(500)

  // 截图对比
  await page.screenshot({ path: 'before-contextmenu.png', fullPage: false })
  console.log('已保存 before-contextmenu.png')
}

console.log('\n=== 打印相关 console 日志 ===')
consoleLogs.slice(-20).forEach(l => console.log(l))

await browser.close()
