/**
 * 三层 Canvas 组件 🔥
 *
 * 实现三层 Canvas DOM 结构，通过 CSS position: absolute 叠加。
 * 三层 Canvas 尺寸完全对齐，各自负责不同内容的渲染。
 *
 * 架构说明：
 * - 背景层：z-index 1，绘制网格背景和画布底色
 * - 主层：z-index 2，绘制所有已确认的静态元素
 * - 临时层：z-index 3，绘制交互中的临时元素
 *
 * 组件职责：
 * 1. 创建并管理三层 Canvas DOM 元素
 * 2. 初始化 CanvasRenderer 实例
 * 3. 将 CanvasRenderer 引用通过 ref 回调暴露给父组件
 */

import { useRef, useEffect, useCallback } from 'react'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'
import { CanvasElement } from '@/canvas/CanvasElement'

interface CanvasProps {
  /** CanvasRenderer 就绪回调 */
  onRendererReady: (renderer: CanvasRenderer) => void
  /** 元素列表 */
  elements: CanvasElement[]
  /** 选中元素 ID 集合 */
  selectedIds: Set<string>
  /** 鼠标事件回调 */
  onMouseDown?: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onMouseMove?: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onMouseUp?: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onWheel?: (e: React.WheelEvent<HTMLCanvasElement>) => void
}

export default function Canvas({
  onRendererReady,
  elements,
  selectedIds,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
}: CanvasProps) {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const mainCanvasRef = useRef<HTMLCanvasElement>(null)
  const tempCanvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)

  // 初始化 CanvasRenderer
  useEffect(() => {
    if (!bgCanvasRef.current || !mainCanvasRef.current || !tempCanvasRef.current) return

    const renderer = new CanvasRenderer(
      bgCanvasRef.current,
      mainCanvasRef.current,
      tempCanvasRef.current
    )
    rendererRef.current = renderer
    onRendererReady(renderer)

    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
  }, [onRendererReady])

  // 同步元素列表到渲染器
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setElements(elements)
    }
  }, [elements])

  // 同步选中状态到渲染器
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setSelectedIds(selectedIds)
    }
  }, [selectedIds])

  /** 获取 CanvasRenderer 实例 */
  const getRenderer = useCallback((): CanvasRenderer | null => {
    return rendererRef.current
  }, [])

  // 暴露 getRenderer 给父组件（通过 onRendererReady 回调中包装）
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (rendererRef.current) {
        // 将 getRenderer 附加到事件对象上
        ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer
      }
      onMouseDown?.(e)
    },
    [onMouseDown, getRenderer]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (rendererRef.current) {
        ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer
      }
      onMouseMove?.(e)
    },
    [onMouseMove, getRenderer]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (rendererRef.current) {
        ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer
      }
      onMouseUp?.(e)
    },
    [onMouseUp, getRenderer]
  )

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: '#E5E5E5' }}>
      {/* 背景层 Canvas - z-index: 1 */}
      <canvas
        ref={bgCanvasRef}
        className="absolute inset-0"
        style={{ zIndex: 1 }}
      />

      {/* 主层 Canvas - z-index: 2 */}
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0"
        style={{ zIndex: 2 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={onWheel}
      />

      {/* 临时层 Canvas - z-index: 3 */}
      <canvas
        ref={tempCanvasRef}
        className="absolute inset-0"
        style={{ zIndex: 3, pointerEvents: 'none' }}
      />
    </div>
  )
}