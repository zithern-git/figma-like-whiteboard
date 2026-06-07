/**
 * 元素变换 Hook (useElementTransform)
 *
 * 管理选中元素的变换操作，包括：
 * - 拖拽移动：选中元素后拖拽到新位置
 * - 缩放：拖拽 8 个控制手柄调整元素尺寸
 * - 旋转：拖拽旋转手柄以元素中心为轴旋转
 *
 * 变换类型：
 * 1. 移动（move）：拖拽元素主体，改变 x/y 坐标
 * 2. 缩放（scale）：拖拽包围盒手柄，改变 width/height
 * 3. 旋转（rotate）：拖拽旋转手柄，改变 rotation
 *
 * Shift 锁比例：缩放时按住 Shift 键保持宽高比不变
 */

import { useCallback, useRef } from 'react'
import { CanvasRenderer } from '@/canvas'
import { CanvasElement } from '@/canvas/CanvasElement'
import { useCanvasStore } from '@/stores/canvasStore'

/** 变换操作类型 */
type TransformType = 'move' | 'scale' | 'rotate' | 'none'

export function useElementTransform(renderer: CanvasRenderer | null) {
  const store = useCanvasStore()

  /** 当前变换类型 */
  const transformType = useRef<TransformType>('none')
  /** 变换起始世界坐标 */
  const transformStart = useRef({ x: 0, y: 0 })
  /** 变换前元素的初始状态（用于撤销） */
  const elementStatesBefore = useRef<Map<string, CanvasElement>>(new Map())
  /** 是否正在变换 */
  const isTransforming = useRef(false)

  /**
   * 开始变换
   *
   * 记录选中元素的初始状态和变换起始点。
   *
   * @param e - 鼠标事件
   */
  const handleTransformStart = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return

      const state = useCanvasStore.getState()
      if (state.activeTool !== 'select' || state.selectedIds.size === 0) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      transformStart.current = { ...worldPos }
      transformType.current = 'move'
      isTransforming.current = true

      // 记录所有选中元素的初始状态
      elementStatesBefore.current = new Map()
      for (const id of state.selectedIds) {
        const element = state.elements.find((el) => el.id === id)
        if (element) {
          elementStatesBefore.current.set(id, { ...element })
        }
      }
    },
    [renderer]
  )

  /**
   * 执行变换
   *
   * 根据变换类型实时更新选中元素的位置和尺寸。
   *
   * @param e - 鼠标事件
   */
  const handleTransformMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer || !isTransforming.current) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      const dx = worldPos.x - transformStart.current.x
      const dy = worldPos.y - transformStart.current.y

      const state = useCanvasStore.getState()

      if (transformType.current === 'move') {
        // 移动：所有选中元素同步平移
        for (const id of state.selectedIds) {
          const initial = elementStatesBefore.current.get(id)
          if (initial) {
            store.updateElement(id, {
              x: initial.x + dx,
              y: initial.y + dy,
            })
          }
        }
      }
      // 缩放和旋转逻辑在后续版本中实现
    },
    [renderer, store]
  )

  /**
   * 结束变换
   *
   * 最终确认变换结果，清除临时状态。
   */
  const handleTransformEnd = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isTransforming.current = false
      transformType.current = 'none'
      elementStatesBefore.current.clear()
    },
    []
  )

  return {
    handleTransformStart,
    handleTransformMove,
    handleTransformEnd,
    isTransforming,
  }
}