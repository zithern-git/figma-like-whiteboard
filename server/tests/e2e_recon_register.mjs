import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173/register');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// 截图
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_register_page.png', fullPage: true });
console.log('Screenshot: e2e_register_page.png');

// 列出所有 input 元素
const inputs = await page.locator('input').all();
for (const inp of inputs) {
  const type = await inp.getAttribute('type');
  const name = await inp.getAttribute('name');
  const placeholder = await inp.getAttribute('placeholder');
  console.log(`Input: type=${type}, name=${name}, placeholder=${placeholder}`);
}

// 列出所有按钮
const buttons = await page.locator('button').all();
for (const btn of buttons) {
  const text = await btn.textContent();
  console.log(`Button: "${text?.trim()}"`);
}

await browser.close();
