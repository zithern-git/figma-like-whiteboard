import { useCallback, useState } from 'react'
import { CanvasElement } from '@/canvas/CanvasElement'

interface TestDrawToolProps {
  onAddElement: (element: CanvasElement) => void
}

const TEMP_ID = 'test-draw-tool'

export function TestDrawTool({ onAddElement }: TestDrawToolProps) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = (e as any)._getRenderer()
    if (!renderer) return

    const rect = e.currentTarget.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const { x, y } = renderer.screenToWorld(screenX, screenY)

    setIsDrawing(true)
    setStartPoint({ x, y })

    // 通过 CanvasRenderer 的公共 API 注册临时绘制
    renderer.addTemporaryDraw(TEMP_ID, (ctx) => {
      ctx.fillStyle = 'red'
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
    }, 10)
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint) return

    const renderer = (e as any)._getRenderer()
    if (!renderer) return

    const rect = e.currentTarget.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const { x, y } = renderer.screenToWorld(screenX, screenY)

    // 更新临时绘制
    renderer.addTemporaryDraw(TEMP_ID, (ctx) => {
      ctx.strokeStyle = 'blue'
      ctx.lineWidth = 2
      ctx.strokeRect(
        Math.min(startPoint.x, x),
        Math.min(startPoint.y, y),
        Math.abs(x - startPoint.x),
        Math.abs(y - startPoint.y)
      )
    }, 10)
  }, [isDrawing, startPoint])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint) return

    const renderer = (e as any)._getRenderer()
    if (!renderer) return

    const rect = e.currentTarget.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const { x, y } = renderer.screenToWorld(screenX, screenY)

    setIsDrawing(false)
    renderer.removeTemporaryDraw(TEMP_ID)

    // 提交矩形到主层
    const element: CanvasElement = {
      id: Date.now().toString(),
      type: 'rect',
      x: Math.min(startPoint.x, x),
      y: Math.min(startPoint.y, y),
      width: Math.abs(x - startPoint.x),
      height: Math.abs(y - startPoint.y),
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: 'transparent'
    }

    onAddElement(element)
  }, [isDrawing, startPoint, onAddElement])

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp
  }
}
