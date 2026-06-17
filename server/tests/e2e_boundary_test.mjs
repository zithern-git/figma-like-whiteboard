/**
 * E2E 边界情况测试
 *
 * 测试场景：
 * - 空画布渲染
 * - 超长文本元素
 * - 超大图片元素
 * - 多标签页同时编辑
 * - 页面刷新恢复
 */

import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5173'
const TEST_PASSWORD = 'Test123456'

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

async function registerAndLogin(page) {
  const email = `boundary_${Date.now()}@test.com`
  const name = 'BoundaryTest'

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
      await nameInput.fill('Boundary Test Board')
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

async function getElementCount(page) {
  const text = await page.locator('text=/\\d+ 个元素/').first().textContent().catch(() => '0 个元素')
  const match = text.match(/(\d+)\s*个元素/)
  return match ? parseInt(match[1], 10) : 0
}

async function takeScreenshot(page, name) {
  await page.screenshot({
    path: `c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_boundary_${name}.png`,
    fullPage: true,
  })
}

// ========== 主测试 ==========
console.log(cyan('\n========================================'))
console.log(cyan('边界情况测试'))
console.log(cyan('========================================\n'))

const browser = await chromium.launch({ headless: true })
const results = []

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (msg) => console.log(`[console][${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`))

// 注册登录
await registerAndLogin(page)
console.log(green('登录成功'))

// 创建白板
const wbUrl = await createWhiteboard(page)
console.log(green(`白板创建成功: ${wbUrl}`))
await page.waitForTimeout(1500)

// ========== 测试 1: 空画布渲染 ==========
console.log(cyan('\n--- 测试 1: 空画布渲染 ---'))

const emptyCount = await getElementCount(page)
console.log(`空画布元素数: ${emptyCount}`)

await takeScreenshot(page, 'empty_canvas')
console.log(green('✓ 空画布截图已保存'))

const test1Pass = emptyCount === 0
results.push({ name: '空画布渲染', pass: test1Pass })
if (test1Pass) {
  console.log(green('✓ 空画布渲染正常'))
} else {
  console.log(red('✗ 空画布不应有元素'))
}

// ========== 测试 2: 超长文本 ==========
console.log(cyan('\n--- 测试 2: 超长文本元素 ---'))

// 点击文本工具
const textBtn = page.locator('button[title*="文本"], button:has-text("文本"), [data-tool="text"]').first()
if (await textBtn.isVisible().catch(() => false)) {
  await textBtn.click()
  await page.waitForTimeout(500)

  // 点击画布放置文本
  await page.mouse.click(400, 300)
  await page.waitForTimeout(500)

  // 输入超长文本（1000+ 字符）
  const longText = 'A'.repeat(1200)
  const textInput = page.locator('textarea, [contenteditable="true"], input[type="text"]').first()
  if (await textInput.isVisible().catch(() => false)) {
    await textInput.fill(longText)
    await page.waitForTimeout(500)
    // 按 Enter 确认
    await textInput.press('Enter')
    await page.waitForTimeout(1000)
  }
}

const textCount = await getElementCount(page)
console.log(`添加文本后元素数: ${textCount}`)

await takeScreenshot(page, 'long_text')
console.log(green('✓ 超长文本截图已保存'))

const test2Pass = textCount > 0
results.push({ name: '超长文本', pass: test2Pass })
if (test2Pass) {
  console.log(green('✓ 超长文本元素添加成功'))
} else {
  console.log(red('✗ 超长文本元素添加失败'))
}

// ========== 测试 3: 多标签页同时编辑 ==========
console.log(cyan('\n--- 测试 3: 多标签页同时编辑 ---'))

const context = page.context()
const page2 = await context.newPage()
await page2.setViewportSize({ width: 1440, height: 900 })

await page2.goto(wbUrl)
await page2.waitForLoadState('networkidle')
await page2.waitForTimeout(3000)

// 两个标签页分别添加元素
const rectBtn1 = page.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first()
const rectBtn2 = page2.locator('button[title*="矩形"], button:has-text("矩形"), [data-tool="rectangle"]').first()

if (await rectBtn1.isVisible().catch(() => false)) {
  await rectBtn1.click()
  await page.waitForTimeout(300)
  await page.mouse.move(200, 200)
  await page.mouse.down()
  await page.mouse.move(300, 280)
  await page.mouse.up()
}

if (await rectBtn2.isVisible().catch(() => false)) {
  await rectBtn2.click()
  await page2.waitForTimeout(300)
  await page2.mouse.move(500, 200)
  await page2.mouse.down()
  await page2.mouse.move(600, 280)
  await page2.mouse.up()
}

await page.waitForTimeout(2000)
await page2.waitForTimeout(2000)

const countTab1 = await getElementCount(page)
const countTab2 = await getElementCount(page2)
console.log(`Tab1 元素数: ${countTab1}, Tab2 元素数: ${countTab2}`)

await takeScreenshot(page, 'tab1')
await takeScreenshot(page2, 'tab2')

const test3Pass = countTab1 === countTab2 && countTab1 >= 2
results.push({ name: '多标签页同步', pass: test3Pass })
if (test3Pass) {
  console.log(green('✓ 多标签页数据一致'))
} else {
  console.log(red('✗ 多标签页数据不一致'))
}

await page2.close()

// ========== 测试 4: 页面刷新恢复 ==========
console.log(cyan('\n--- 测试 4: 页面刷新恢复 ---'))

const countBeforeRefresh = await getElementCount(page)
console.log(`刷新前元素数: ${countBeforeRefresh}`)

await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(4000)

const countAfterRefresh = await getElementCount(page)
console.log(`刷新后元素数: ${countAfterRefresh}`)

await takeScreenshot(page, 'after_refresh')

const test4Pass = countAfterRefresh >= countBeforeRefresh
results.push({ name: '刷新恢复', pass: test4Pass })
if (test4Pass) {
  console.log(green('✓ 刷新后数据恢复成功'))
} else {
  console.log(red('✗ 刷新后数据丢失'))
}

// ========== 测试 5: 大量元素渲染性能 ==========
console.log(cyan('\n--- 测试 5: 大量元素渲染性能 ---'))

// 通过注入脚本快速添加 100 个元素
await page.evaluate(() => {
  const store = window.__canvasStore
  if (store) {
    const newElements = []
    for (let i = 0; i < 100; i++) {
      newElements.push({
        id: `bulk-${i}-${Date.now()}`,
        type: 'rect',
        x: Math.random() * 800,
        y: Math.random() * 600,
        width: 20 + Math.random() * 80,
        height: 20 + Math.random() * 80,
        fill: '#4ECDC4',
        stroke: '#000000',
        strokeWidth: 2,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'boundary-test',
      })
    }
    const state = store.getState()
    store.setState({ elements: [...state.elements, ...newElements] })
  }
})

await page.waitForTimeout(2000)
const bulkCount = await getElementCount(page)
console.log(`批量添加后元素数: ${bulkCount}`)

await takeScreenshot(page, 'bulk_elements')

const test5Pass = bulkCount >= 100
results.push({ name: '大量元素渲染', pass: test5Pass })
if (test5Pass) {
  console.log(green('✓ 大量元素渲染正常'))
} else {
  console.log(red('✗ 大量元素渲染异常'))
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
  console.log(green('🎉 所有边界测试通过！'))
} else {
  console.log(yellow('⚠️ 部分测试失败'))
}
console.log(cyan('========================================\n'))

await browser.close()
process.exit(allPassed ? 0 : 1)
