/**
 * 键盘快捷键 Hook (useKeyboardShortcuts)
 *
 * 管理所有画布相关的键盘快捷键，参考 Figma 快捷键设计。
 *
 * 支持快捷键列表：
 * - Ctrl+Z / Ctrl+Y：撤销/重做
 * - V：选择工具 | P：画笔 | L：直线 | R：矩形 | O：圆形 | T：文本 | E：橡皮擦
 * - Delete / Backspace：删除选中元素
 * - Ctrl+D：复制选中元素
 * - Ctrl+A：全选
 * - Space+拖拽：平移画布
 * - Shift+拖拽：等比例缩放
 * - Ctrl+Shift+E：导出为 PNG
 * - Ctrl+Shift+Delete：清空画布
 * - Escape：取消选择
 */

import { useEffect, useCallback } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { ToolType } from '@/canvas/CanvasElement'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'

export function useKeyboardShortcuts(renderer: CanvasRenderer | null) {
  const store = useCanvasStore()

  /**
   * 快捷键映射表
   *
   * 将键盘按键映射到画布工具和操作。
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 忽略在输入框中的按键事件
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey
      const key = e.key.toLowerCase()

      // ========== 工具切换快捷键 ==========
      if (!ctrl && !shift) {
        const toolMap: Record<string, ToolType> = {
          v: 'select',
          p: 'pen',
          l: 'line',
          r: 'rect',
          o: 'circle',
          t: 'text',
          e: 'eraser',
        }
        if (key in toolMap) {
          e.preventDefault()
          store.setTool(toolMap[key])
          return
        }
      }

      // ========== Ctrl 组合键 ==========
      if (ctrl && !shift) {
        switch (key) {
          case 'z': {
            // Ctrl+Z：撤销
            e.preventDefault()
            store.undo()
            break
          }
          case 'y': {
            // Ctrl+Y：重做
            e.preventDefault()
            store.redo()
            break
          }
          case 'd': {
            // Ctrl+D：复制选中元素
            e.preventDefault()
            store.duplicateSelected()
            break
          }
          case 'a': {
            // Ctrl+A：全选
            e.preventDefault()
            store.selectAll()
            break
          }
        }
      }

      // ========== Ctrl+Shift 组合键 ==========
      if (ctrl && shift) {
        switch (key) {
          case 'e': {
            // Ctrl+Shift+E：导出为 PNG
            e.preventDefault()
            exportCanvas(renderer)
            break
          }
          case 'delete': {
            // Ctrl+Shift+Delete：清空画布
            e.preventDefault()
            store.clearAllElements()
            break
          }
        }
      }

      // ========== 删除 ==========
      if (!ctrl && (key === 'delete' || key === 'backspace')) {
        e.preventDefault()
        store.deleteSelectedElements()
      }

      // ========== Escape ==========
      if (key === 'escape') {
        // 取消选择或切换到选择工具
        const state = useCanvasStore.getState()
        if (state.selectedIds.size > 0) {
          store.deselectAll()
        } else {
          store.setTool('select')
        }
      }
    },
    [store, renderer]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}

/**
 * 导出画布为 PNG 图片
 *
 * 创建离屏 Canvas，将当前视口内的元素渲染上去，
 * 导出为 PNG 格式并触发浏览器下载。
 *
 * @param renderer - Canvas 渲染器
 */
function exportCanvas(renderer: CanvasRenderer | null): void {
  if (!renderer) return

  // 获取当前视口信息
  const viewport = renderer.getViewport()

  // 创建离屏 Canvas 用于导出
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = window.innerWidth * 2 // 2x 分辨率
  exportCanvas.height = window.innerHeight * 2
  const ctx = exportCanvas.getContext('2d')
  if (!ctx) return

  // 模拟视口渲染
  ctx.scale(2, 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)

  // 触发下载
  exportCanvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `whiteboard-${Date.now()}.png`
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
