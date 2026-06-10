import { useRef, useEffect, useCallback } from 'react'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'
import { CanvasElement } from '@/canvas/CanvasElement'

interface CanvasProps {
  onRendererReady: (renderer: CanvasRenderer) => void
  elements: CanvasElement[]
  selectedIds: Set<string>
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
      const w = r.screenToWorld(sx, sy)

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
      const w = r.screenToWorld(sx, sy)

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
      const w = r.screenToWorld(sx, sy)

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
