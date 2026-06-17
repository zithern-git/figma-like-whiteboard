/**
 * 快速测试：验证前端登录是否正常工作
 */
import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5174'

const TEST_EMAIL = `login_test_${Date.now()}@example.com`
const TEST_PASSWORD = 'Test123456'
const TEST_NAME = 'LoginTest'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => console.log(`[console] ${msg.text()}`))
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`))

console.log('=== 测试 1: 注册 ===')
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

const url = page.url()
console.log(`注册后 URL: ${url}`)

if (url.includes('/whiteboards')) {
  console.log('✅ 注册成功，已自动登录')
} else if (url.includes('/login')) {
  console.log('注册成功，跳转到登录页')
  const loginInputs = await page.locator('input').all()
  if (loginInputs.length >= 2) {
    await loginInputs[0].fill(TEST_EMAIL)
    await loginInputs[1].fill(TEST_PASSWORD)
  }
  await page.click('button:has-text("登录")')
  await page.waitForTimeout(3000)
  const loginUrl = page.url()
  console.log(`登录后 URL: ${loginUrl}`)
  if (loginUrl.includes('/whiteboards')) {
    console.log('✅ 登录成功')
  } else {
    console.log('❌ 登录失败')
  }
} else {
  console.log(`❌ 未知状态: ${url}`)
}

await browser.close()
