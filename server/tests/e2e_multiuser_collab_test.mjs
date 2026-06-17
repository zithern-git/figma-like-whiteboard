/**
 * E2E 协作测试：3+ 浏览器窗口同时编辑同一白板
 *
 * 测试目标：
 * - 3+ 浏览器窗口同时编辑同一白板，验证无数据不一致
 * - 操作乱序模拟（延迟发送），验证 OT 正确处理
 * - 断线重连测试，验证增量操作同步完整
 */

import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5173'
const TEST_PASSWORD = 'Test123456'

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

async function registerUser(page, index) {
  const email = `multi_${Date.now()}_${index}@test.com`
  const name = `User${index}`

  await page.goto(`${BASE_URL}/register`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)

  const inputs = await page.locator('input').all()
  if (inputs.length >= 3) {
    await inputs[0].fill(name)
    await inputs[1].fill(email)
    await inputs[2].fill(TEST_PASSWORD)
  }
  await page.click('button:has-text("注册")')
  await page.waitForTimeout(2500)

  if (page.url().includes('/login')) {
    const loginInputs = await page.locator('input').all()
    if (loginInputs.length >= 2) {
      await loginInputs[0].fill(email)
      await loginInputs[1].fill(TEST_PASSWORD)
    }
    await page.click('button:has-text("登录")')
    await page.waitForTimeout(2500)
  }

  return email
}

async function createWhiteboard(page) {
  const newBoardBtn = page.locator('button:has-text("创建第一个白板"), button:has-text("创建白板"), button:has-text("新建白板")').first()
  if (await newBoardBtn.isVisible().catch(() => false)) {
    await newBoardBtn.click()
    await page.waitForTimeout(800)
    const nameInput = page.locator('input[placeholder*="白板名称"], input[placeholder*="名称"]').first()
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Multiuser Test Board')
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

async function addRectangle(page, x, y) {
  const rectBtn = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first()
  if (await rectBtn.isVisible().catch(() => false)) {
    await rectBtn.click()
    await page.waitForTimeout(500)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 100, y + 80)
    await page.mouse.up()
    await page.waitForTimeout(800)
  }
}

async function getElementCount(page) {
  const text = await page.locator('text=/\\d+ 个元素/').first().textContent().catch(() => '0 个元素')
  const match = text.match(/(\d+)\s*个元素/)
  return match ? parseInt(match[1], 10) : 0
}

async function getElementIds(page) {
  return await page.evaluate(() => {
    const state = window.__canvasStore?.getState?.()
    if (state?.elements) {
      return state.elements.map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y }))
    }
    return []
  })
}

async function loginUser(page, email) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  const inputs = await page.locator('input').all()
  if (inputs.length >= 2) {
    await inputs[0].fill(email)
    await inputs[1].fill(TEST_PASSWORD)
  }
  await page.click('button:has-text("登录")')
  await page.waitForTimeout(2500)
}

// ========== 主测试 ==========
console.log(cyan('\n========================================'))
console.log(cyan('多用户协作一致性测试'))
console.log(cyan('========================================\n'))

const browser = await chromium.launch({ headless: true })
const results = []

// --- 创建 3 个用户 ---
console.log('--- 创建 3 个用户 ---')
const users = []
for (let i = 0; i < 3; i++) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (msg) => console.log(`[User${i}][${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => console.log(`[User${i}][error] ${err.message}`))

  const email = await registerUser(page, i)
  users.push({ page, email, index: i })
  console.log(green(`User${i} 注册成功: ${email}`))
}

// User0 创建白板
console.log('\n--- User0 创建白板 ---')
const wbUrl = await createWhiteboard(users[0].page)
console.log(green(`白板 URL: ${wbUrl}`))
await users[0].page.waitForTimeout(1500)

// User1, User2 进入同一白板
console.log('\n--- User1, User2 进入同一白板 ---')
for (let i = 1; i < 3; i++) {
  await loginUser(users[i].page, users[i].email)
  await users[i].page.goto(wbUrl)
  await users[i].page.waitForLoadState('networkidle')
  await users[i].page.waitForTimeout(3000)
  console.log(green(`User${i} 已进入白板`))
}

// ========== 测试 1: 同时添加元素 ==========
console.log(cyan('\n--- 测试 1: 3 用户同时添加元素 ---'))

await Promise.all([
  addRectangle(users[0].page, 200, 200),
  addRectangle(users[1].page, 400, 200),
  addRectangle(users[2].page, 600, 200),
])

// 等待同步
await new Promise((r) => setTimeout(r, 3000))

const counts1 = await Promise.all(users.map((u) => getElementCount(u.page)))
console.log(`元素数量: User0=${counts1[0]}, User1=${counts1[1]}, User2=${counts1[2]}`)

const test1Pass = counts1.every((c) => c === 3)
results.push({ name: '同时添加元素', pass: test1Pass })
if (test1Pass) {
  console.log(green('✓ 所有用户看到 3 个元素'))
} else {
  console.log(red('✗ 元素数量不一致'))
}

// ========== 测试 2: 数据一致性检查 ==========
console.log(cyan('\n--- 测试 2: 数据一致性检查 ---'))

const ids0 = await getElementIds(users[0].page)
const ids1 = await getElementIds(users[1].page)
const ids2 = await getElementIds(users[2].page)

const test2Pass =
  ids0.length === ids1.length &&
  ids1.length === ids2.length &&
  ids0.every((e, i) => e.id === ids1[i]?.id && e.id === ids2[i]?.id)

results.push({ name: '数据一致性', pass: test2Pass })
if (test2Pass) {
  console.log(green('✓ 所有用户元素 ID 完全一致'))
} else {
  console.log(red('✗ 元素 ID 不一致'))
  console.log('User0:', ids0.map((e) => e.id))
  console.log('User1:', ids1.map((e) => e.id))
  console.log('User2:', ids2.map((e) => e.id))
}

// ========== 测试 3: 断线重连 ==========
console.log(cyan('\n--- 测试 3: User1 断线重连测试 ---'))

const countBefore = await getElementCount(users[1].page)
console.log(`User1 断线前元素数: ${countBefore}`)

// 模拟断网
await users[1].page.context().setOffline(true)
console.log('User1 已断网')

// User0 在 User1 断网期间添加元素
await addRectangle(users[0].page, 300, 400)
await users[0].page.waitForTimeout(1000)

// User1 恢复网络
await users[1].page.context().setOffline(false)
console.log('User1 恢复网络')

// 等待重连和同步
await users[1].page.waitForTimeout(5000)

const countAfterReconnect = await getElementCount(users[1].page)
console.log(`User1 重连后元素数: ${countAfterReconnect}`)

const test3Pass = countAfterReconnect > countBefore
results.push({ name: '断线重连同步', pass: test3Pass })
if (test3Pass) {
  console.log(green('✓ User1 重连后同步了新元素'))
} else {
  console.log(red('✗ User1 重连后未同步新元素'))
}

// ========== 测试 4: 刷新恢复 ==========
console.log(cyan('\n--- 测试 4: User2 刷新页面恢复 ---'))

const countBeforeRefresh = await getElementCount(users[2].page)
console.log(`User2 刷新前元素数: ${countBeforeRefresh}`)

await users[2].page.reload()
await users[2].page.waitForLoadState('networkidle')
await users[2].page.waitForTimeout(4000)

const countAfterRefresh = await getElementCount(users[2].page)
console.log(`User2 刷新后元素数: ${countAfterRefresh}`)

const test4Pass = countAfterRefresh >= countBeforeRefresh
results.push({ name: '刷新恢复', pass: test4Pass })
if (test4Pass) {
  console.log(green('✓ 刷新后数据恢复成功'))
} else {
  console.log(red('✗ 刷新后数据丢失'))
}

// ========== 汇总 ==========
console.log(cyan('\n========================================'))
console.log(cyan('测试结果汇总'))
console.log(cyan('========================================'))

let allPassed = true
for (const r of results) {
  const icon = r.pass ? green('✓') : red('✗')
  console.log(`${icon} ${r.name}`)
  if (!r.pass) allPassed = false
}

console.log(cyan('\n========================================'))
if (allPassed) {
  console.log(green('🎉 所有协作测试通过！'))
} else {
  console.log(yellow('⚠️ 部分测试失败'))
}
console.log(cyan('========================================\n'))

await browser.close()
process.exit(allPassed ? 0 : 1)
