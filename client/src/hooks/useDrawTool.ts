/**
 * 绘图工具 Hook (useDrawTool) 🔥
 *
 * 管理绘图工具的交互流程：鼠标按下 → 拖拽 → 释放。
 * 支持所有绘图工具类型（画笔、直线、矩形、圆形、文本、图片）。
 *
 * 交互流程：
 * 1. onMouseDown：创建临时元素，记录起始点
 * 2. onMouseMove：更新临时元素（实时预览在临时层）
 * 3. onMouseUp：确认元素，提交到主层（通过 canvasStore）
 *
 * 各工具拖拽逻辑：
 * - 画笔（pen）：记录移动轨迹点序列，释放时 Catmull-Rom 平滑
 * - 直线（line）：从起点到当前鼠标位置绘制直线
 * - 矩形（rect）：从起点到当前鼠标位置确定包围盒
 * - 圆形（circle）：从起点到当前鼠标位置确定半径（Shift 锁正圆）
 * - 文本（text）：点击位置创建文本输入框
 * - 橡皮擦（eraser）：检测与元素包围盒相交，标记删除
 */

import { useCallback, useRef } from 'react'
import { CanvasRenderer, catmullRomSmooth } from '@/canvas'
import { CanvasElement, Point, ToolType } from '@/canvas/CanvasElement'
import { useCanvasStore } from '@/stores/canvasStore'

export function useDrawTool(renderer: CanvasRenderer | null) {
  const store = useCanvasStore()

  /** 是否正在绘制 */
  const isDrawing = useRef(false)
  /** 起始点（世界坐标） */
  const startPoint = useRef<Point>({ x: 0, y: 0 })
  /** 当前点（世界坐标） */
  const currentPoint = useRef<Point>({ x: 0, y: 0 })
  /** 画笔轨迹点序列 */
  const penPoints = useRef<Point[]>([])
  /** 是否按下了 Shift 键 */
  const isShiftPressed = useRef(false)

  /**
   * 处理鼠标按下事件
   *
   * 根据当前活动工具执行不同的初始化逻辑。
   *
   * @param e - 鼠标事件
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      const activeTool = useCanvasStore.getState().activeTool

      // 选择工具交给 useElementSelection 处理
      if (activeTool === 'select' || activeTool === 'eraser') return

      isDrawing.current = true
      startPoint.current = { ...worldPos }
      currentPoint.current = { ...worldPos }

      if (activeTool === 'pen') {
        penPoints.current = [{ ...worldPos }]
      }

      // 文本工具：点击位置创建文本元素
      if (activeTool === 'text') {
        const newElement = store.createElement('text', {
          x: worldPos.x,
          y: worldPos.y,
          width: 200,
          height: store.fontSize * 2,
          text: '双击编辑文本',
          fontSize: store.fontSize,
        })
        store.addElement(newElement)
        isDrawing.current = false
      }
    },
    [renderer, store]
  )

  /**
   * 处理鼠标移动事件
   *
   * 拖拽过程中实时更新临时层预览。
   *
   * @param e - 鼠标事件
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer || !isDrawing.current) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      currentPoint.current = { ...worldPos }

      const activeTool = useCanvasStore.getState().activeTool

      if (activeTool === 'pen') {
        // 画笔：记录轨迹点
        penPoints.current.push({ ...worldPos })
      }

      // 触发临时层重绘（显示拖拽预览）
      renderer.scheduleRender('temp')
    },
    [renderer]
  )

  /**
   * 处理鼠标释放事件
   *
   * 结束绘制，计算最终元素数据并提交到画布。
   *
   * @param e - 鼠标事件
   */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer || !isDrawing.current) return
      isDrawing.current = false

      const activeTool = useCanvasStore.getState().activeTool
      const start = startPoint.current
      const current = currentPoint.current

      if (activeTool === 'select' || activeTool === 'text') return

      let newElement: CanvasElement | null = null

      switch (activeTool) {
        case 'pen': {
          // 画笔：使用 Catmull-Rom 平滑后的点序列
          if (penPoints.current.length < 2) break
          const smoothedPoints = catmullRomSmooth(penPoints.current)
          const bounds = calculateBounds(smoothedPoints)
          newElement = store.createElement('pen', {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            points: smoothedPoints,
            fill: 'transparent',
          })
          break
        }
        case 'line': {
          const bounds = calculateBounds([start, current])
          const padding = 4
          newElement = store.createElement('line', {
            x: bounds.x - padding,
            y: bounds.y - padding,
            width: Math.max(bounds.width + padding * 2, 1),
            height: Math.max(bounds.height + padding * 2, 1),
            points: [{ x: start.x, y: start.y }, { x: current.x, y: current.y }],
            fill: 'transparent',
          })
          break
        }
        case 'rect': {
          const bounds = calculateBounds([start, current])
          const padding = store.strokeWidth
          newElement = store.createElement('rect', {
            x: bounds.x - padding,
            y: bounds.y - padding,
            width: Math.max(bounds.width + padding * 2, 1),
            height: Math.max(bounds.height + padding * 2, 1),
          })
          break
        }
        case 'circle': {
          const radiusX = Math.abs(current.x - start.x)
          const radiusY = isShiftPressed.current
            ? radiusX // Shift 锁正圆
            : Math.abs(current.y - start.y)
          const padding = store.strokeWidth
          newElement = store.createElement('circle', {
            x: start.x - radiusX - padding,
            y: start.y - radiusY - padding,
            width: (radiusX + padding) * 2,
            height: (radiusY + padding) * 2,
          })
          break
        }
      }

      if (newElement) {
        store.addElement(newElement)
      }

      penPoints.current = []
    },
    [renderer, store]
  )

  /**
   * 处理橡皮擦交互
   *
   * 检测橡皮擦轨迹与元素包围盒是否相交，命中则删除元素。
   *
   * @param e - 鼠标事件
   */
  const handleEraser = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return
      const activeTool = useCanvasStore.getState().activeTool
      if (activeTool !== 'eraser') return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldPos = renderer.screenToWorld(screenX, screenY)

      const state = useCanvasStore.getState()
      const eraserRadius = 20 / state.viewport.zoom // 橡皮擦半径（世界坐标）

      // 碰撞检测：检查橡皮擦范围与所有元素包围盒
      for (const element of state.elements) {
        if (isRectIntersectingCircle(
          element.x, element.y, element.width, element.height,
          worldPos.x, worldPos.y, eraserRadius
        )) {
          store.deleteElement(element.id)
          break // 每次只删除一个元素
        }
      }
    },
    [renderer, store]
  )

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleEraser,
    isDrawing,
  }
}

/**
 * 计算点序列的包围盒
 *
 * @param points - 点序列
 * @returns 包围盒 { x, y, width, height }
 */
function calculateBounds(points: Point[]): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  }
}

/**
 * 矩形与圆形相交检测
 *
 * 用于橡皮擦碰撞检测，判断橡皮擦圆形范围是否与元素包围盒相交。
 *
 * @param rx, ry, rw, rh - 矩形参数
 * @param cx, cy, cr - 圆形参数
 * @returns 是否相交
 */
function isRectIntersectingCircle(
  rx: number, ry: number, rw: number, rh: number,
  cx: number, cy: number, cr: number
): boolean {
  // 找到矩形上离圆心最近的点
  const closestX = Math.max(rx, Math.min(cx, rx + rw))
  const closestY = Math.max(ry, Math.min(cy, ry + rh))

  // 计算最近点与圆心的距离
  const dx = cx - closestX
  const dy = cy - closestY

  return dx * dx + dy * dy <= cr * cr
}