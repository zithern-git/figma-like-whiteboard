/**
 * 白板编辑器页面
 *
 * 整合 Canvas 渲染引擎、工具栏、属性面板和交互系统。
 * 页面布局：左侧工具栏 | 中间 Canvas 画布 | 右侧属性面板
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Canvas from '@/components/canvas/Canvas'
import { CanvasRenderer } from '@/canvas'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasViewport } from '@/hooks/useCanvasViewport'
import { useDrawTool } from '@/hooks/useDrawTool'
import { useElementSelection } from '@/hooks/useElementSelection'
import { useElementTransform } from '@/hooks/useElementTransform'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAuthStore } from '@/stores/authStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import Toolbar from '@/components/canvas/Toolbar'
import PropertiesPanel from '@/components/canvas/PropertiesPanel'
import { TextEditor } from '@/components/canvas/TextEditor'

export default function WhiteboardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { currentWhiteboard, fetchWhiteboardById } = useWhiteboardStore()

  const canvasStore = useCanvasStore()
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [isLoading, setIsLoading] = useState(true)

  // 文本编辑状态
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  // 同步 editingTextId 到 CanvasRenderer，使其跳过渲染正在编辑的文本
  useEffect(() => {
    if (renderer) {
      renderer.setEditingTextId(editingTextId)
    }
  }, [renderer, editingTextId])

  // 初始化 CanvasRenderer
  const handleRendererReady = useCallback((r: CanvasRenderer) => {
    setRenderer(r)
  }, [])

  // 视口控制
  const { handleWheel, zoomBy, zoomTo, resetViewport } = useCanvasViewport(renderer, {
    onZoomChange: setZoom,
  })

  // 绘图工具
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleEraser } = useDrawTool(renderer)

  // 元素选择
  const { handleSelect } = useElementSelection(renderer)

  // 元素变换
  const { handleTransformStart, handleTransformMove, handleTransformEnd } = useElementTransform(renderer)

  // 键盘快捷键
  useKeyboardShortcuts(renderer)

  // 加载白板数据
  useEffect(() => {
    if (!id) return
    fetchWhiteboardById(id).finally(() => setIsLoading(false))
  }, [id, fetchWhiteboardById])

  // 统一的鼠标事件处理
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // 如果正在编辑文本，先结束编辑
      if (editingTextId) {
        setEditingTextId(null)
        return
      }

      const activeTool = useCanvasStore.getState().activeTool

      if (activeTool === 'select') {
        handleSelect(e)
        handleTransformStart(e)
      } else if (activeTool === 'eraser') {
        handleEraser(e)
      } else {
        handleMouseDown(e)
      }
    },
    [handleSelect, handleTransformStart, handleMouseDown, handleEraser, editingTextId]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const activeTool = useCanvasStore.getState().activeTool

      if (activeTool === 'select') {
        handleTransformMove(e)
      } else {
        handleMouseMove(e)
      }
    },
    [handleTransformMove, handleMouseMove]
  )

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const activeTool = useCanvasStore.getState().activeTool

      if (activeTool === 'select') {
        handleTransformEnd(e)
      } else {
        handleMouseUp(e)
      }
    },
    [handleTransformEnd, handleMouseUp]
  )

  // 双击事件：编辑文本
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // 如果已经在编辑某个文本，不创建新的编辑框
      if (editingTextId) {
        return
      }

      const r = renderer
      if (!r) return

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { x, y } = r.screenToWorld(sx, sy)

      // 查找点击位置下的文本元素
      const elements = useCanvasStore.getState().elements
      const clickedText = elements.find((el) => {
        if (el.type !== 'text') return false
        return x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height
      })

      if (clickedText) {
        // 进入编辑模式时清除选中状态，避免选区边框和编辑框同时出现
        useCanvasStore.getState().clearSelection()
        setEditingTextId(clickedText.id)
      }
    },
    [renderer, editingTextId]
  )

  const handleBack = () => {
    navigate('/whiteboards')
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* 顶部工具栏 */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            ← 返回
          </button>
          <h1 className="text-sm font-medium text-gray-900">
            {currentWhiteboard?.name || '未命名白板'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* 缩放控制 */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <button
              onClick={() => zoomBy(0.9)}
              className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded"
            >
              -
            </button>
            <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => zoomBy(1.1)}
              className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded"
            >
              +
            </button>
            <button
              onClick={resetViewport}
              className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded text-xs"
              title="重置视口"
            >
              ⌂
            </button>
          </div>

          <div className="w-px h-5 bg-gray-200 mx-2" />

          <span className="text-xs text-gray-500">
            {canvasStore.elements.length} 个元素
          </span>
        </div>
      </header>

      {/* 主工作区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧工具栏 */}
        <Toolbar renderer={renderer} />

        {/* 中间 Canvas 画布 */}
        <div className="flex-1 relative">
          <Canvas
            onRendererReady={handleRendererReady}
            elements={canvasStore.elements}
            selectedIds={canvasStore.selectedIds}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onWheel={handleWheel}
            onDoubleClick={onDoubleClick}
          />

          {/* 文本编辑覆盖层 */}
          <TextEditor
            renderer={renderer}
            editingElementId={editingTextId}
            onFinish={() => setEditingTextId(null)}
          />

          {/* 当前工具提示 - Figma 风格，不透明背景遮住网格 */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none z-50">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.12)] border border-gray-100">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-[11px] text-gray-500 font-medium tracking-wide">
                {getToolHint(canvasStore.activeTool)}
              </span>
            </div>
          </div>
        </div>

        {/* 右侧属性面板 */}
        <PropertiesPanel />
      </div>
    </div>
  )
}

/**
 * 获取工具提示文字
 */
function getToolHint(tool: string): string {
  const hints: Record<string, string> = {
    select: '选择工具 (V) - 点击选中，拖拽移动',
    pen: '画笔 (P) - 拖拽绘制自由曲线',
    line: '直线 (L) - 拖拽绘制直线',
    rect: '矩形 (R) - 拖拽绘制矩形',
    circle: '圆形 (O) - 拖拽绘制圆形',
    text: '文本 (T) - 点击放置文本',
    eraser: '橡皮擦 (E) - 点击擦除元素',
  }
  return hints[tool] || tool
}
