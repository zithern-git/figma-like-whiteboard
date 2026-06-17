"""抓 http://localhost:5173 刷新时的 console 错误和弹框。"""
import sys
from playwright.sync_api import sync_playwright

console_msgs = []
dialog_msgs = []
page_errors = []


def on_console(msg):
    console_msgs.append(f"[{msg.type}] {msg.text}")


def on_pageerror(err):
    page_errors.append(str(err))


def on_dialog(dialog):
    dialog_msgs.append(f"[{dialog.type}] {dialog.message}")
    dialog.dismiss()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("dialog", on_dialog)

    page.goto("http://localhost:5173", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(2000)
    page.screenshot(path="C:/Users/zengq/Desktop/.vscode/figma-like-whiteboard/_dbg_initial.png", full_page=True)
    print("=== PAGE URL ===")
    print(page.url)
    print("\n=== PAGE ERRORS ===")
    for e in page_errors:
        print(e)
    print("\n=== CONSOLE ===")
    for m in console_msgs:
        print(m)
    print("\n=== DIALOGS ===")
    for d in dialog_msgs:
        print(d)
    print("\n=== HTML SNIPPET (title) ===")
    print(page.title())
    print("\n=== LOCALSTORAGE ===")
    try:
        ls = page.evaluate("() => Object.fromEntries(Object.entries(localStorage))")
        for k, v in ls.items():
            print(f"{k} = {v[:120] if isinstance(v, str) else v}")
    except Exception as e:
        print(f"ls eval error: {e}")

    browser.close()
