from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173/")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.screenshot(path="c:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/server/tests/e2e_recon_1.png", full_page=True)
    print("Screenshot saved: e2e_recon_1.png")
    browser.close()
