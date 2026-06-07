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
          } else {
            // 普通点击：单选
            store.setSelectedIds(new Set([element.id]))
          }
          return
        }
      }

      // 点击空白区域：取消选择
      if (!e.shiftKey) {
        store.clearSelection()
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