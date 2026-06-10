/**
 * 白板编辑器页面
 *
 * 整合 Canvas 渲染引擎、工具栏、属性面板和交互系统。
 * 页面布局：左侧工具栏 | 中间 Canvas 画布 | 右侧属性面板
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Canvas from '@/components/canvas/Canvas'
import { CanvasRenderer, HitArea } from '@/canvas'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasViewport } from '@/hooks/useCanvasViewport'
import { useDrawTool } from '@/hooks/useDrawTool'
import { useElementSelection } from '@/hooks/useElementSelection'
import { useElementTransform } from '@/hooks/useElementTransform'
import { useImageUpload } from '@/hooks/useImageUpload'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAuthStore } from '@/stores/authStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import Toolbar from '@/components/canvas/Toolbar'
import PropertiesPanel from '@/components/canvas/PropertiesPanel'

export default function WhiteboardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { currentWhiteboard, fetchWhiteboardById } = useWhiteboardStore()

  const canvasStore = useCanvasStore()
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [isLoading, setIsLoading] = useState(true)

  // 初始化 CanvasRenderer
  const handleRendererReady = useCallback((r: CanvasRenderer) => {
    setRenderer(r)
  }, [])

  // 视口控制
  const { handleWheel, zoomBy, zoomTo, resetViewport } = useCanvasViewport(renderer, {
    onZoomChange: setZoom,
  })

  // 绘图工具
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleEraser, handleDoubleClickText, cleanupTextEditor } = useDrawTool(renderer)

  // 元素选择
  const { handleSelect } = useElementSelection(renderer)

  // 元素变换
  const { handleTransformStart, handleTransformMove, handleTransformEnd } = useElementTransform(renderer)

  // 关键修复：图片上传 hook（文件选择器 + 拖拽 + 粘贴）
  const {
    fileInputRef,
    openFilePicker,
    onFileInputChange,
    onDragOver,
    onDrop,
    onPaste,
  } = useImageUpload(renderer)

  // 键盘快捷键
  useKeyboardShortcuts(renderer)

  // 关键修复：监听 activeTool，激活图片工具时自动打开文件选择器
  const activeTool = useCanvasStore((s) => s.activeTool)
  useEffect(() => {
    if (activeTool === 'image') {
      openFilePicker()
      // 选完文件后切回 select 工具，避免用户继续处于 image 模式
      useCanvasStore.getState().setTool('select')
    }
  }, [activeTool, openFilePicker])

  // 关键修复：监听 window 的 paste 事件
  useEffect(() => {
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onPaste])

  // 加载白板数据
  useEffect(() => {
    if (!id) return
    fetchWhiteboardById(id).finally(() => setIsLoading(false))
  }, [id, fetchWhiteboardById])

  // 统一的鼠标事件处理
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    [handleSelect, handleTransformStart, handleMouseDown, handleEraser]
  )

  /**
   * 关键修复：鼠标在画布上移动时，根据 hit test 结果设置光标样式。
   * - 8 个缩放手柄：双向箭头（方向与缩放方向一致）
   * - 1 个旋转手柄：Figma 风格的环形箭头（自定义 SVG cursor）
   * - 元素主体：move
   * - 其余：default
   *
   * 旋转手柄用 SVG data URL 自定义光标，CSS 没有现成的"环形箭头"cursor；
   * 末尾的 `alias` 是兜底（SVG 加载失败时降级）
   */
  const rotateCursorUrl =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12a9 9 0 1 1-3.5-7.1"/>' +
        '<polyline points="21 3 21 9 15 9"/>' +
        "</svg>"
    )

  const handleCursorHover = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) {
        e.currentTarget.style.cursor = "default"
        return
      }
      const state = useCanvasStore.getState()
      if (state.activeTool !== "select" || state.selectedIds.size === 0) {
        e.currentTarget.style.cursor = "default"
        return
      }

      const rect = e.currentTarget.getBoundingClientRect()
      const worldPos = renderer.screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top
      )

      const isOnlySelection = state.selectedIds.size === 1
      let hit: HitArea = { type: "none" }
      if (isOnlySelection) {
        const id = Array.from(state.selectedIds)[0]
        const element = state.elements.find((el) => el.id === id)
        if (element) {
          hit = renderer.hitTest(element, worldPos.x, worldPos.y, true)
        }
      } else {
        for (const id of state.selectedIds) {
          const element = state.elements.find((el) => el.id === id)
          if (!element) continue
          const h = renderer.hitTest(
            element,
            worldPos.x,
            worldPos.y,
            false
          )
          if (h.type === "move") {
            hit = h
            break
          }
        }
      }

      let cursor: string = "default"
      if (hit.type === "scale") {
        switch (hit.handle) {
          case "tl":
          case "br":
            cursor = "nwse-resize"
            break
          case "tr":
          case "bl":
            cursor = "nesw-resize"
            break
          case "tm":
          case "bm":
            cursor = "ns-resize"
            break
          case "ml":
          case "mr":
            cursor = "ew-resize"
            break
        }
      } else if (hit.type === "rotate") {
        // 关键修复：Figma 风格的环形箭头光标，热点居中 (12, 12)
        cursor = `url("${rotateCursorUrl}") 12 12, alias`
      } else if (hit.type === "move") {
        cursor = "move"
      }
      e.currentTarget.style.cursor = cursor
    },
    [renderer]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const activeTool = useCanvasStore.getState().activeTool

      if (activeTool === 'select') {
        handleTransformMove(e)
        // 关键修复：无论是否正在变换，都要更新光标反馈
        handleCursorHover(e)
      } else {
        handleMouseMove(e)
        e.currentTarget.style.cursor = 'crosshair'
      }
    },
    [handleTransformMove, handleMouseMove, handleCursorHover]
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
      // 优先使用注入的 _getRenderer（Canvas.tsx 在 onDoubleClick 时注入）
      const r = (e as any)._getRenderer?.() || renderer
      if (!r) return

      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
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
        handleDoubleClickText(e.clientX, e.clientY, clickedText.x, clickedText.y, clickedText, -1)
      }
    },
    [renderer, handleDoubleClickText]
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
        <Toolbar onToolChange={cleanupTextEditor} />

        {/* 中间 Canvas 画布 */}
        <div
          className="flex-1 relative"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
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

          {/* 关键修复：隐藏的文件选择 input，Toolbar 选图片工具时由 useImageUpload 触发 click */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileInputChange}
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
