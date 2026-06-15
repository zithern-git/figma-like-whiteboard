import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 捕获 console 日志
page.on('console', msg => console.log(`[console] ${msg.type()}: ${msg.text()}`));
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));

await page.goto('http://localhost:5173/');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

// 截图
await page.screenshot({ path: 'c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_recon_1.png', fullPage: true });
console.log('Screenshot saved: e2e_recon_1.png');

// 输出 DOM 中可见的按钮/元素
const buttons = await page.locator('button').all();
console.log(`Found ${buttons.length} buttons`);
for (const btn of buttons) {
  const text = await btn.textContent();
  console.log(`  Button: "${text?.trim()}"`);
}

await browser.close();
