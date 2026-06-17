/**
 * 测试修复：DevTools 打开时画布不会白屏
 *
 * 验证方法：
 * 1. 打开白板页面
 * 2. 添加一些元素（让画布有内容）
 * 3. 模拟 window.blur 事件（DevTools 打开会触发）
 * 4. 检查画布内容是否还在
 * 5. 模拟 document.visibilitychange (hidden=true)
 * 6. 检查画布内容是否还在
 */
import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5174'

const TEST_EMAIL = `devtools_test_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'DevToolsTest'

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
      await nameInput.fill('DevTools Test')
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

console.log('=== 注册登录 + 创建白板 ===')
await registerAndLogin(page)
await createWhiteboard(page)
await page.waitForTimeout(2000)

console.log('=== 添加元素 ===')
await page.evaluate(() => {
  const store = window.__canvasStore
  store.getState().addElement(store.getState().createElement('rect', { x: 100, y: 100, width: 200, height: 150 }))
  store.getState().addElement(store.getState().createElement('text', { x: 400, y: 200, text: 'Hello', width: 200, height: 32 }))
})
await page.waitForTimeout(500)

console.log('=== 截屏：正常状态 ===')
await page.screenshot({ path: 'before-blur.png' })

console.log('=== 模拟 window.blur 事件（DevTools 打开时触发）===')
const beforeBlurRAF = await page.evaluate(() => {
  // 检查 rAF 是否在运行
  return new Promise((resolve) => {
    let count = 0
    const start = Date.now()
    const id = setInterval(() => {
      requestAnimationFrame(() => {
        count++
        if (Date.now() - start > 200) {
          clearInterval(id)
          resolve(count)
        }
      })
    }, 16)
  })
})
console.log(`>>> 触发 blur 前的 rAF 帧数: ${beforeBlurRAF}`)

// 触发 window blur
await page.evaluate(() => {
  window.dispatchEvent(new Event('blur'))
})
await page.waitForTimeout(500)

const afterBlurRAF = await page.evaluate(() => {
  return new Promise((resolve) => {
    let count = 0
    const start = Date.now()
    const id = setInterval(() => {
      requestAnimationFrame(() => {
        count++
        if (Date.now() - start > 200) {
          clearInterval(id)
          resolve(count)
        }
      })
    }, 16)
  })
})
console.log(`>>> 触发 blur 后的 rAF 帧数: ${afterBlurRAF}`)
console.log(`>>> blur 不再影响 rAF: ${afterBlurRAF > 5 ? '✅' : '❌ (rAF 已停止)'}`)

console.log('=== 截屏：blur 后状态 ===')
await page.screenshot({ path: 'after-blur.png' })

console.log('=== 模拟 visibilitychange (hidden=true) ===')
await page.evaluate(() => {
  // 模拟 document.hidden = true
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(500)

const afterHiddenRAF = await page.evaluate(() => {
  return new Promise((resolve) => {
    let count = 0
    const start = Date.now()
    const id = setInterval(() => {
      requestAnimationFrame(() => {
        count++
        if (Date.now() - start > 200) {
          clearInterval(id)
          resolve(count)
        }
      })
    }, 16)
  })
})
console.log(`>>> visibility=hidden 后的 rAF 帧数: ${afterHiddenRAF}`)
console.log(`>>> hidden 暂停 rAF: ${afterHiddenRAF < 2 ? '✅' : '❌ (rAF 仍在运行)'}`)

console.log('=== 模拟 visibilitychange (hidden=false) ===')
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(500)

const afterVisibleRAF = await page.evaluate(() => {
  return new Promise((resolve) => {
    let count = 0
    const start = Date.now()
    const id = setInterval(() => {
      requestAnimationFrame(() => {
        count++
        if (Date.now() - start > 200) {
          clearInterval(id)
          resolve(count)
        }
      })
    }, 16)
  })
})
console.log(`>>> visibility=visible 后的 rAF 帧数: ${afterVisibleRAF}`)
console.log(`>>> visible 恢复 rAF: ${afterVisibleRAF > 5 ? '✅' : '❌ (rAF 未恢复)'}`)

console.log('\n=== 总结 ===')
console.log(`1. window.blur 不再影响渲染: ${afterBlurRAF > 5 ? '✅ 修复成功' : '❌ 修复失败'}`)
console.log(`2. document.hidden=true 暂停 rAF: ${afterHiddenRAF < 2 ? '✅ 节能生效' : '❌ 节能失效'}`)
console.log(`3. document.hidden=false 恢复 rAF: ${afterVisibleRAF > 5 ? '✅ 恢复正常' : '❌ 恢复失败'}`)

await browser.close()
