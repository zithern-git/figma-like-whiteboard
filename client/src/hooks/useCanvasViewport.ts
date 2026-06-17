/**
 * 画布视口控制 Hook (useCanvasViewport) 🔥
 *
 * 管理画布的缩放和平移交互，是用户导航画布的核心交互方式。
 *
 * 功能：
 * - 滚轮缩放：以鼠标位置为中心进行缩放，缩放范围 0.1x ~ 10x
 * - 空格+拖拽平移：按住空格键时拖拽鼠标平移画布
 * - 空白处拖拽平移：选择工具下，鼠标在画布空白处按下并拖动时平移画布
 *   （Figma 默认行为，避免与元素拖动 / 手柄 / 框选冲突）
 * - 缩放百分比实时显示
 *
 * 缩放原理：
 * 以鼠标位置为中心缩放意味着缩放后鼠标指向的世界坐标点保持不变。
 * 公式：newViewport.translateX = mouseX - (mouseX - oldViewport.translateX) * newZoom / oldZoom
 *       newViewport.translateY = mouseY - (mouseY - oldViewport.translateY) * newZoom / newZoom
 */

import { useCallback, useRef, useEffect } from 'react'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'

interface UseCanvasViewportOptions {
  /** 缩放百分比变化回调 */
  onZoomChange?: (zoom: number) => void
}

export function useCanvasViewport(
  renderer: CanvasRenderer | null,
  options: UseCanvasViewportOptions = {}
) {
  const { onZoomChange } = options
  const isPanning = useRef(false)
  const isSpacePressed = useRef(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  /** 缩放范围限制 */
  const clampZoom = useCallback((zoom: number): number => {
    return Math.max(0.1, Math.min(10, zoom))
  }, [])

  /**
   * 处理滚轮缩放 🔥
   *
   * 以鼠标位置为中心缩放，缩放因子 delta * 0.001。
   * 缩放后调整视口偏移，使鼠标指向的世界坐标保持不变。
   *
   * @param e - 滚轮事件
   */
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!renderer) return
      e.preventDefault()

      const viewport = renderer.getViewport()
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // 计算新的缩放比例（向下滚动缩小，向上滚动放大）
      const delta = -e.deltaY * 0.001
      const newZoom = clampZoom(viewport.zoom * (1 + delta))

      // 以鼠标位置为中心缩放：调整视口偏移使鼠标指向的世界坐标不变
      const newTranslateX = mouseX - (mouseX - viewport.translateX) * (newZoom / viewport.zoom)
      const newTranslateY = mouseY - (mouseY - viewport.translateY) * (newZoom / viewport.zoom)

      renderer.setViewport({ translateX: newTranslateX, translateY: newTranslateY, zoom: newZoom })
      onZoomChange?.(newZoom)
    },
    [renderer, clampZoom, onZoomChange]
  )

  /**
   * 键盘事件处理
   *
   * 空格键按下时进入平移模式，松开时退出。
   * 浏览器默认行为被阻止以防止页面滚动。
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中按空格时触发平移
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        isSpacePressed.current = true
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        isSpacePressed.current = false
        isPanning.current = false
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  /**
   * 开始平移（mousedown 时调用）
   *
   * 记录当前鼠标位置为基准点。空格+拖动 / 空白处拖动时调用。
   *
   * @param e - 鼠标事件
   */
  const handlePanStart = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return
      isPanning.current = true
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      lastMousePos.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    },
    [renderer]
  )

  /**
   * 平移中（mousemove 时调用）
   *
   * 用 dx/dy 调整视口 translateX/translateY（屏幕坐标 = 世界坐标 * zoom + translate，
   * 所以视口位移 = 鼠标位移）。
   */
  const handlePanMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer || !isPanning.current) return
      e.preventDefault()
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const curX = e.clientX - rect.left
      const curY = e.clientY - rect.top
      const dx = curX - lastMousePos.current.x
      const dy = curY - lastMousePos.current.y
      lastMousePos.current = { x: curX, y: curY }
      const viewport = renderer.getViewport()
      renderer.setViewport({
        translateX: viewport.translateX + dx,
        translateY: viewport.translateY + dy,
      })
    },
    [renderer]
  )

  /**
   * 结束平移（mouseup 时调用）
   */
  const handlePanEnd = useCallback(() => {
    isPanning.current = false
  }, [])

  /**
   * 平移缩放
   *
   * 缩放值乘以 step 因子，以当前值为基础进行缩放。
   *
   * @param step - 缩放步长（>1 放大，<1 缩小）
   */
  const zoomBy = useCallback(
    (step: number) => {
      if (!renderer) return
      const viewport = renderer.getViewport()
      const newZoom = clampZoom(viewport.zoom * step)
      renderer.setViewport({ zoom: newZoom })
      onZoomChange?.(newZoom)
    },
    [renderer, clampZoom, onZoomChange]
  )

  /**
   * 缩放到指定比例
   *
   * @param zoom - 目标缩放比例
   */
  const zoomTo = useCallback(
    (zoom: number) => {
      if (!renderer) return
      const clamped = clampZoom(zoom)
      renderer.setViewport({ zoom: clamped })
      onZoomChange?.(clamped)
    },
    [renderer, clampZoom, onZoomChange]
  )

  /**
   * 重置视口（缩放 100%，平移归零）
   */
  const resetViewport = useCallback(() => {
    if (!renderer) return
    renderer.setViewport({ translateX: 0, translateY: 0, zoom: 1 })
    onZoomChange?.(1)
  }, [renderer, onZoomChange])

  return {
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    isSpacePressed,
    lastMousePos,
    zoomBy,
    zoomTo,
    resetViewport,
  }
}
