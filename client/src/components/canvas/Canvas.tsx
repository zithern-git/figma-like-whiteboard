import { useRef, useEffect, useCallback } from 'react'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'
import { CanvasElement } from '@/canvas/CanvasElement'
import { loadViewport } from '@/canvas/viewportStorage'

interface CanvasProps {
  onRendererReady: (renderer: CanvasRenderer) => void
  elements: CanvasElement[]
  selectedIds: Set<string>
  /** 关键修复：白板 ID，用于 viewport 持久化的 localStorage 命名空间 */
  whiteboardId?: string
  onMouseDown?: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onMouseMove?: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onMouseUp?: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onWheel?: (e: React.WheelEvent<HTMLCanvasElement>) => void
  onDoubleClick?: (e: React.MouseEvent<HTMLCanvasElement>) => void
}

export default function Canvas({
  onRendererReady,
  elements,
  selectedIds,
  whiteboardId,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onDoubleClick,
}: CanvasProps) {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const mainCanvasRef = useRef<HTMLCanvasElement>(null)
  const tempCanvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)

  useEffect(() => {
    if (!bgCanvasRef.current || !mainCanvasRef.current || !tempCanvasRef.current) return

    // 关键修复：从 localStorage 恢复用户上次的视口状态（平移/缩放位置），
    // 避免拖动 / 缩放后刷新页面视口被重置为 (0, 0, 1)。按 whiteboardId 命名空间隔离。
    const restoredViewport = whiteboardId ? loadViewport(whiteboardId) : undefined

    const renderer = new CanvasRenderer(
      bgCanvasRef.current,
      mainCanvasRef.current,
      tempCanvasRef.current,
      {
        whiteboardId,
        initialViewport: restoredViewport,
      }
    )
    rendererRef.current = renderer
    onRendererReady(renderer)

    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
  }, [onRendererReady, whiteboardId])

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setElements(elements)
    }
  }, [elements])

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setSelectedIds(selectedIds)
    }
  }, [selectedIds])

  // 关键修复：监听 canvas 容器尺寸变化（属性面板折叠/展开、侧栏宽度调整等
  // 不会触发 window.resize，但会让容器变宽/变窄），调用 renderer.resizeAndRender()
  // 同步内部 canvas bitmap 尺寸并立即重绘，避免出现空白区或拉伸。
  //
  // 闭包读 rendererRef.current 而不是捕获 r，避免 renderer 重建后引用旧实例。
  //
  // rAF 批处理：属性面板的 width 过渡动画会触发 ResizeObserver 在每帧（约 60fps）
  // 持续触发；不做批处理会导致每帧都执行 canvas.width = X（清空画布）然后重绘，
  // 视觉上表现为闪烁。rAF 批处理后，每个动画帧最多重置一次。
  //
  // resize + redraw 原子化：进一步消除"canvas.width=X 之后到下一帧 render() 之前"
  // 这一帧间隙（约 16ms），避免看到空白画布。
  useEffect(() => {
    const target = bgCanvasRef.current?.parentElement
    if (!target) return

    let scheduled = false
    const observer = new ResizeObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        rendererRef.current?.resizeAndRender()
      })
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const getRenderer = useCallback((): CanvasRenderer | null => {
    return rendererRef.current
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = rendererRef.current
      if (!r) return
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      void r.screenToWorld(sx, sy)

      ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer
      onMouseDown?.(e)
    },
    [onMouseDown, getRenderer]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = rendererRef.current
      if (!r) return
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      void r.screenToWorld(sx, sy)

      ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer
      onMouseMove?.(e)
    },
    [onMouseMove, getRenderer]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = rendererRef.current
      if (!r) return
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      void r.screenToWorld(sx, sy)

      ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer
      onMouseUp?.(e)
    },
    [onMouseUp, getRenderer]
  )

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      handleMouseUp(e)
    },
    [handleMouseUp]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // 关键修复：阻止双击事件冒泡，防止触发父元素的 mousedown
      e.stopPropagation()
      e.preventDefault()

      // 关键修复：注入 _getRenderer，让 onDoubleClick 可以访问 renderer
      ;(e as unknown as Record<string, unknown>)._getRenderer = getRenderer

      onDoubleClick?.(e)
    },
    [onDoubleClick, getRenderer]
  )

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: '#FFFFFF' }}>
      <canvas ref={bgCanvasRef} className="absolute inset-0" style={{ zIndex: 1, pointerEvents: 'none' }} />
      <canvas ref={mainCanvasRef} className="absolute inset-0" style={{ zIndex: 2, pointerEvents: 'none' }} />
      <canvas
        ref={tempCanvasRef}
        className="absolute inset-0"
        style={{ zIndex: 3 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={onWheel}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  )
}
