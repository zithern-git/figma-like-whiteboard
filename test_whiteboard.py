from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # 监听控制台错误
    errors = []
    def handle_console(msg):
        if msg.type == 'error':
            errors.append(msg.text)
    page.on("console", handle_console)

    # 监听页面错误
    page_errors = []
    def handle_page_error(err):
        page_errors.append(str(err))
    page.on("pageerror", handle_page_error)

    # 访问白板页面（未登录会被重定向到登录页，这是正常的）
    page.goto('http://localhost:5173/whiteboard/test-id-123')
    page.wait_for_load_state('networkidle')

    # 截图查看当前状态
    page.screenshot(path='d:/figma-like-whiteboard/screenshot_whiteboard.png', full_page=True)

    print("当前URL:", page.url)
    print("页面标题:", page.title())
    print("控制台错误:", errors)
    print("页面JS错误:", page_errors)

    # 检查是否有按钮元素
    buttons = page.locator('button').all()
    print(f"页面按钮数量: {len(buttons)}")
    for i, btn in enumerate(buttons[:10]):
        print(f"  按钮 {i+1}: {btn.inner_text().strip() or '(无文字)'}")

    browser.close()
