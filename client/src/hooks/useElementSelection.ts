/**
 * 元素选择 Hook (useElementSelection)
 *
 * 管理元素的选中交互，包括：
 * - 点击选中：点击检测元素包围盒
 * - 多选（Shift+点击）：添加到选区
 * - 框选：拖拽矩形框覆盖选中
 * - 控制手柄绘制：选中元素周围显示 8 个缩放手柄 + 旋转手柄
 *
 * 点击检测原理：
 * 判断鼠标点击位置是否在元素包围盒内。
 * 通过 screenToWorld 将鼠标坐标转换为世界坐标后进行判断。
 */

import { useCallback, useRef } from 'react'
import { CanvasRenderer } from '@/canvas'
import { CanvasElement } from '@/canvas/CanvasElement'
import { useCanvasStore } from '@/stores/canvasStore'

export function useElementSelection(renderer: CanvasRenderer | null) {
  const store = useCanvasStore()

  /** 是否正在框选 */
  const isBoxSelecting = useRef(false)
  /** 框选起始点 */
  const boxSelectStart = useRef({ x: 0, y: 0 })

  /**
   * 处理点击检测
   *
   * 将鼠标点击的世界坐标与所有元素包围盒进行命中检测。
   * 从后往前遍历（上层元素优先），找到第一个命中的元素。
   * Shift 键按下时切换选中状态（多选模式）。
   *
   * 关键修复（Ctrl+A 后无法整组拖动）：
   * - 点到已选中的元素 → 保留当前多选，让用户能整组拖动
   * - 点到未选中的元素 → 单选替换
   * - 点到空白区：
   *     - 在所有选中元素整体包围盒内 → 保留选区（用户可拖动整组）
   *     - 在整体包围盒外 → 取消选区
   *   （如需无条件清空请按 Esc）
   *
   * @param e - 鼠标事件
   */
  const handleSelect = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      const state = useCanvasStore.getState()
      if (state.activeTool !== 'select') return

      // 从后往前遍历元素（上层元素优先命中）
      const elements = state.elements
      for (let i = elements.length - 1; i >= 0; i--) {
        const element = elements[i]
        if (isPointInElement(worldPos.x, worldPos.y, element)) {
          if (e.shiftKey) {
            // Shift + 点击：多选模式
            store.toggleSelected(element.id)
          } else if (state.selectedIds.has(element.id)) {
            // 关键修复：点击已选中的元素 → 保留当前多选（用于整组拖动）
            return
          } else {
            // 普通点击未选元素：单选
            store.setSelectedIds(new Set([element.id]))
          }
          return
        }
      }

      // 关键修复：点击空白区时，先用 hitTest 探测是不是点在了 8 个缩放手柄或
      // 旋转手柄上（手柄在 bbox 之外，不被 isPointInElement 捕获）。
      // 命中手柄 → 保留选区（让 transformStart 能正常处理旋转/缩放）
      // 没命中手柄 → 走原本的"包围盒外清空"逻辑
      if (state.selectedIds.size > 0) {
        // 1. 单选：精确探测手柄（缩放 + 旋转）
        if (state.selectedIds.size === 1) {
          const id = Array.from(state.selectedIds)[0]
          const el = state.elements.find((e) => e.id === id)
          if (el) {
            const hit = renderer.hitTest(el, worldPos.x, worldPos.y, true)
            if (hit.type === 'scale' || hit.type === 'rotate') {
              return // 命中手柄，保留选区
            }
          }
        }
        // 2. 包围盒外 → 取消选区
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const el of state.elements) {
          if (!state.selectedIds.has(el.id)) continue
          minX = Math.min(minX, el.x)
          minY = Math.min(minY, el.y)
          maxX = Math.max(maxX, el.x + (el.width || 0))
          maxY = Math.max(maxY, el.y + (el.height || 0))
        }
        const insideBoundingBox =
          worldPos.x >= minX &&
          worldPos.x <= maxX &&
          worldPos.y >= minY &&
          worldPos.y <= maxY
        if (!insideBoundingBox) {
          // 在整体包围盒外 → 取消选区
          store.clearSelection()
        }
        // 在包围盒内 → 保留选区，不做任何事
      }
    },
    [renderer, store]
  )

  /**
   * 处理框选
   *
   * 鼠标按下开始框选，移动时显示框选矩形，释放时选中所有被框选矩形覆盖的元素。
   */
  const handleBoxSelectStart = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      isBoxSelecting.current = true
      boxSelectStart.current = { ...worldPos }
    },
    [renderer]
  )

  const handleBoxSelectEnd = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isBoxSelecting.current || !renderer) return
      isBoxSelecting.current = false

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      const start = boxSelectStart.current
      const selectRect = {
        x: Math.min(start.x, worldPos.x),
        y: Math.min(start.y, worldPos.y),
        width: Math.abs(worldPos.x - start.x),
        height: Math.abs(worldPos.y - start.y),
      }

      // 检测所有在框选矩形内的元素
      const state = useCanvasStore.getState()
      const selectedIds = new Set<string>()

      for (const element of state.elements) {
        if (isRectIntersecting(
          element.x, element.y, element.width, element.height,
          selectRect.x, selectRect.y, selectRect.width, selectRect.height
        )) {
          selectedIds.add(element.id)
        }
      }

      if (selectedIds.size > 0) {
        store.setSelectedIds(selectedIds)
      }
    },
    [renderer, store]
  )

  return {
    handleSelect,
    handleBoxSelectStart,
    handleBoxSelectEnd,
    isBoxSelecting,
  }
}

/**
 * 判断点是否在元素包围盒内
 *
 * @param px, py - 点坐标（世界坐标）
 * @param element - 元素
 * @returns 是否在包围盒内
 */
function isPointInElement(px: number, py: number, element: CanvasElement): boolean {
  return (
    px >= element.x &&
    px <= element.x + element.width &&
    py >= element.y &&
    py <= element.y + element.height
  )
}

/**
 * 判断两个矩形是否相交
 *
 * @param ax, ay, aw, ah - 矩形 A
 * @param bx, by, bw, bh - 矩形 B
 * @returns 是否相交
 */
function isRectIntersecting(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return !(
    ax + aw < bx ||
    ax > bx + bw ||
    ay + ah < by ||
    ay > by + bh
  )
}