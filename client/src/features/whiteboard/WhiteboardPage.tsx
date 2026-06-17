/**
 * 白板编辑器页面
 *
 * 整合 Canvas 渲染引擎、工具栏、属性面板和交互系统。
 * 页面布局：左侧工具栏 | 中间 Canvas 画布 | 右侧属性面板
 *
 * Phase 8：拆分为 components/layout/* 三个组件，页面只做编排
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Canvas from '@/components/canvas/Canvas'
import { CanvasRenderer, HitArea } from '@/canvas'
import { ToolType } from '@/canvas/CanvasElement'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasViewport } from '@/hooks/useCanvasViewport'
import { useDrawTool } from '@/hooks/useDrawTool'
import { useElementSelection } from '@/hooks/useElementSelection'
import { useElementTransform } from '@/hooks/useElementTransform'
import { useImageUpload } from '@/hooks/useImageUpload'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useSocketCollab } from '@/hooks/useSocketCollab'
import { useAuthStore } from '@/stores/authStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import Navbar from '@/components/layout/Navbar'
import Toolbar from '@/components/layout/Toolbar'
import PropertiesPanel from '@/components/layout/PropertiesPanel'
import { exportAndDownload } from '@/utils/exportCanvas'
import { toast } from '@/stores/toastStore'
import { loadElements, saveElements, flushPendingElementsWrites, preloadImages, loadUndoStack, loadRedoStack, saveUndoStack } from '@/canvas/elementsStorage'

/** 属性面板折叠状态 key（按用户 ID 隔离） */
const PANEL_COLLAPSED_KEY_PREFIX = 'wb:panel:collapsed:'

export default function WhiteboardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { currentWhiteboard, fetchWhiteboardById } = useWhiteboardStore()

  const canvasStore = useCanvasStore()
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [isLoading, setIsLoading] = useState(true)

  // 属性面板折叠态（按用户 ID 持久化）
  const [panelExpanded, setPanelExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const k = PANEL_COLLAPSED_KEY_PREFIX + (user?.id || 'anon')
    return window.localStorage.getItem(k) !== '1'
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id) return
    window.localStorage.setItem(
      PANEL_COLLAPSED_KEY_PREFIX + user.id,
      panelExpanded ? '0' : '1'
    )
  }, [panelExpanded, user?.id])

  // 撤销/重做可用态（订阅 store 的栈长度）
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  useEffect(() => {
    const update = () => {
      setCanUndo(canvasStore.canUndo())
      setCanRedo(canvasStore.canRedo())
    }
    update()
    // 订阅 zustand 栈变化
    const unsub = useCanvasStore.subscribe((s, prev) => {
      if (s.undoStack !== prev.undoStack || s.redoStack !== prev.redoStack) {
        update()
      }
    })
    return unsub
  }, [canvasStore])

  // 初始化 CanvasRenderer
  const handleRendererReady = useCallback((r: CanvasRenderer) => {
    setRenderer(r)
    // 关键修复：CanvasRenderer 可能从 localStorage 恢复了非默认 viewport（如 zoom=1.5），
    // 这里同步一下 zoom state 让 UI（顶部"150%"显示）也反映真实值，
    // 否则刷新后 UI 显示 100% 但画布已经缩放到了 1.5，造成不一致。
    const v = r.getViewport()
    if (v.zoom !== 1) {
      setZoom(v.zoom)
    }
  }, [])

  // 视口控制
  const { handleWheel, handlePanStart, handlePanMove, handlePanEnd, isPanning, zoomBy, resetViewport } = useCanvasViewport(renderer, {
    onZoomChange: setZoom,
  })

  // 绘图工具
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleEraser, handleDoubleClickText, cleanupTextEditor } = useDrawTool(renderer)

  // 元素选择
  const { handleSelect } = useElementSelection(renderer)

  // 元素变换
  const { handleTransformStart, handleTransformMove, handleTransformEnd, isTransforming } = useElementTransform(renderer)

  // 关键修复：图片上传 hook（文件选择器 + 拖拽 + 粘贴）
  const {
    fileInputRef,
    openFilePicker,
    onFileInputChange,
    onDragOver,
    onDrop,
    onPaste,
  } = useImageUpload(renderer)

  // ========== 实时协作（Phase 6.1） ==========
  // 关键修复（实时协作失效 bug）：必须传 shortId（不是 URL 里的 mongo _id）。
  //
  // URL 形如 /whiteboard/<mongo_id>，所以 useParams 拿到的 id 是 mongo _id。
  // 但是服务端：
  //   - 房间名：whiteboard:<shortId>
  //   - 广播 op 时附带的 whiteboardId：whiteboard.shortId
  // 而客户端 useSocketCollab 里的 element-op 过滤器按
  //   op.whiteboardId !== whiteboardId  丢弃。
  // 如果 whiteboardId 传的是 mongo _id，永远 != shortId，**所有远端 op 都被丢**。
  // 用户表现：A 改动 → 服务端持久化 + 广播给 B → B 收到 → 过滤掉 → B 看不到
  //          B 刷新 → join-whiteboard-ack 拉服务端最新状态 → 看到改动
  //
  // 修复：使用 currentWhiteboard.shortId（白板数据中明确字段）。
  // - currentWhiteboard 已加载：用 shortId ✓
  // - 还在加载中（isLoading=true）：传 null，不连 socket（避免用错的 id 连上）
  // - 加载失败：fallback 到 id（极端情况，filter 会失配，但用户也用不了白板）
  const socketWhiteboardId = isLoading
    ? null
    : (currentWhiteboard?.shortId ?? id ?? null)
  const { connectionStatus, onlineUsers } = useSocketCollab(socketWhiteboardId)

  // 关键修复（刷新立刻恢复）：从 localStorage 立即恢复 elements，
  // 不等待 socket 连接 / join-whiteboard-ack / fetchWhiteboardById。
  // 这个 useEffect 必须在 isLoading 守卫之前定义，且不能被 isLoading 卡住。
  // - 时机：组件 mount 之后立即执行（一次性）
  // - 与 socket 的协作：ack 到达后用服务端状态 setElements 全量替换
  //   （服务端是权威源，离线期间的 op 已通过 queue 合并到 ack payload）
  useEffect(() => {
    if (!id) return
    const cached = loadElements(id)
    if (cached.length > 0) {
      // 关键修复（刷新后保留 undo 栈）：setElements 传 false 不清空 undo 栈。
      // 然后立即用 loadUndoStack / loadRedoStack 恢复栈（不执行命令，只恢复栈内容）。
      useCanvasStore.getState().setElements(cached, false)
      const undoData = loadUndoStack(id)
      const redoData = loadRedoStack(id)
      if (undoData.length > 0 || redoData.length > 0) {
        console.log(
          `[WhiteboardPage] 从 localStorage 恢复 undo 栈（${undoData.length} 条）/ redo 栈（${redoData.length} 条）`
        )
        useCanvasStore.getState().restoreUndoStack(undoData, redoData)
      }
      // 关键修复（图片闪一下）：立即预热图片元素的 HTTP 缓存。
      // 刷新后 CanvasRenderer 会创建 new Image() + img.src = url，
      // 如果 HTTP 缓存没命中，需要 DNS + TCP + HTTP 请求 + 图片解码，
      // 几十~几百 ms 期间只能显示"加载中..."占位符。
      // 预热后图片走缓存，毫秒级完成，几乎无感知。
      preloadImages(cached)
    }
  }, [id])

  // 关键修复（刷新立刻恢复 + 保留 undo 栈）：订阅 elements / undoStack / redoStack 变化，
  // 自动写入 localStorage。这样下次刷新就能立即看到画布内容 + 撤销/重做栈。
  //
  // 关键修复（白板串扰 bug）：白板切换时（id 变化）需要清空 canvasStore 避免残留。
  // 但**绝对不能**调用 saveElements(id, [])，否则会覆盖当前白板的 localStorage 缓存，
  // 导致刷新后空白画布。
  //
  // 正确做法：
  // - 清空 canvasStore 内存（不写入 localStorage）
  // - 订阅只监听**当前 id** 对应的 store 变化
  // - 切换白板时先取消旧订阅，再建立新订阅
  useEffect(() => {
    if (!id) return
    // 关键修复：只清空内存中的 canvasStore，**不**写入 localStorage。
    // 原因：setElements([], true) 会触发 subscribe → saveElements(id, [])，
    // 把当前白板的 localStorage 缓存覆盖为空数组。用户刷新后 loadElements(id)
    // 只能读到 [] → 空白画布。
    useCanvasStore.setState({ elements: [] })
    useCanvasStore.getState().clearSelection()

    let prevElements = useCanvasStore.getState().elements
    let prevUndo = useCanvasStore.getState().undoStack
    let prevRedo = useCanvasStore.getState().redoStack
    const unsub = useCanvasStore.subscribe((s) => {
      let changed = false
      if (s.elements !== prevElements) {
        prevElements = s.elements
        saveElements(id, s.elements)
        changed = true
      }
      if (s.undoStack !== prevUndo || s.redoStack !== prevRedo) {
        prevUndo = s.undoStack
        prevRedo = s.redoStack
        // 关键修复（刷新后保留 undo 栈）：栈变化时也持久化。
        // 注意：undo/redo 操作每按一次都会改栈（~10-20Hz 频率），写栈比写 elements 轻量。
        saveUndoStack(id, useCanvasStore.getState().serializeUndoStack(), useCanvasStore.getState().serializeRedoStack())
        changed = true
      }
      void changed
    })
    return unsub
  }, [id])

  // 关键修复（刷新立刻恢复）：页面卸载 / 切页面前 flush 待写入的元素，
  // 防止最后几次 rAF 节流内的修改因浏览器没等到帧就关闭而丢失。
  useEffect(() => {
    if (!id) return
    const handler = () => flushPendingElementsWrites(id)
    window.addEventListener('beforeunload', handler)
    window.addEventListener('pagehide', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      window.removeEventListener('pagehide', handler)
    }
  }, [id])

  // 键盘快捷键
  useKeyboardShortcuts(renderer)

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

        // 空白处拖动 → 平移画布
        if (!isTransforming.current && e.button === 0 && !isPanning.current) {
          handlePanStart(e)
        }
      } else if (activeTool === 'eraser') {
        handleEraser(e)
      } else {
        handleMouseDown(e)
      }
    },
    [handleSelect, handleTransformStart, handleMouseDown, handleEraser, handlePanStart, isPanning, isTransforming]
  )

  /**
   * 鼠标在画布上移动时，根据 hit test 结果设置光标样式
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
        cursor = `url("${rotateCursorUrl}") 12 12, alias`
      } else if (hit.type === "move") {
        cursor = "move"
      }
      e.currentTarget.style.cursor = cursor
    },
    [renderer, rotateCursorUrl]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const activeTool = useCanvasStore.getState().activeTool

      if (activeTool === 'select') {
        if (isPanning.current) {
          handlePanMove(e)
        } else {
          handleTransformMove(e)
        }
        handleCursorHover(e)
      } else {
        handleMouseMove(e)
        e.currentTarget.style.cursor = 'crosshair'
      }
    },
    [handleTransformMove, handleMouseMove, handleCursorHover, handlePanMove, isPanning]
  )

  const onMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLCanvasElement>) => {
      const activeTool = useCanvasStore.getState().activeTool

      if (isPanning.current) {
        handlePanEnd()
      }

      if (activeTool === 'select') {
        handleTransformEnd(_e)
      } else {
        handleMouseUp(_e)
      }
    },
    [handleTransformEnd, handleMouseUp, handlePanEnd, isPanning]
  )

  // onMouseLeave 已被 Canvas 内部处理（鼠标移出画布时 mouseup）

  // 双击事件：编辑文本
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // 关键修复：原代码依赖私有属性 _getRenderer，这里直接用闭包内的 renderer
      const r = renderer
      if (!r) return

      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { x, y } = r.screenToWorld(sx, sy)

      const elements = useCanvasStore.getState().elements
      const clickedText = elements.find((el) => {
        if (el.type !== 'text') return false
        return x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height
      })

      if (clickedText) {
        useCanvasStore.getState().clearSelection()
        handleDoubleClickText(e.clientX, e.clientY, clickedText.x, clickedText.y, clickedText, -1)
      }
    },
    [renderer, handleDoubleClickText]
  )

  // ========== Navbar 回调 ==========

  const handleBack = () => {
    navigate('/whiteboards')
  }

  const handleZoomIn = useCallback(() => {
    zoomBy(1.1)
  }, [zoomBy])

  const handleZoomOut = useCallback(() => {
    zoomBy(0.9)
  }, [zoomBy])

  const handleUndo = useCallback(() => {
    canvasStore.undo()
  }, [canvasStore])

  const handleRedo = useCallback(() => {
    canvasStore.redo()
  }, [canvasStore])

  // ========== Toolbar 回调 ==========

  const handleToolChange = useCallback(
    (tool: ToolType) => {
      // 切换工具前自动保存正在编辑的文本
      cleanupTextEditor()
      useCanvasStore.getState().setTool(tool)
    },
    [cleanupTextEditor]
  )

  const handleClearCanvas = useCallback(() => {
    if (window.confirm('确定要清空画布吗？此操作不可撤销。')) {
      useCanvasStore.getState().clearAllElements()
    }
  }, [])

  const handleImportImage = useCallback(() => {
    openFilePicker()
  }, [openFilePicker])

  // ========== 导出 PNG ==========
  const handleExport = useCallback(async () => {
    if (!renderer) {
      toast.warning('画布尚未就绪')
      return
    }
    const mainCanvas = (renderer as unknown as { mainCanvas?: HTMLCanvasElement }).mainCanvas
    if (!mainCanvas) {
      toast.warning('画布引用不可用')
      return
    }
    try {
      toast.info('正在导出…')
      const state = useCanvasStore.getState()
      await exportAndDownload({
        elements: state.elements,
        viewport: renderer.getViewport(),
        width: mainCanvas.clientWidth,
        height: mainCanvas.clientHeight,
        mode: 'viewport',
        background: '#FFFFFF',
      })
      toast.success('已导出 PNG')
    } catch (err) {
      console.error('[export] 失败:', err)
      toast.error('导出失败，请重试')
    }
  }, [renderer])

  // 关键修复：不再用 isLoading 守卫阻塞画布渲染！
  // 之前：isLoading=true 时返回 "加载中..." 占位符，整个 WhiteboardPage（包括 Canvas 和
  //       我新加的 localStorage 恢复 useEffect）都不渲染，要等 fetchWhiteboardById
  //       完成（几秒）后才显示画布。刷新体验极差：用户看到空白 → 等几秒 → 突然出现画布。
  // 现在：始终渲染画布，isLoading 仅影响 Navbar 上的白板名（用 "加载中..." 兜底）。
  // - localStorage 恢复在组件 mount 时立即执行（见上面 useEffect）
  // - socket 连接在 isLoading=false 后启动（useSocketCollab 接收 null 就不连接）
  // - 服务端状态到达后用 setElements 全量替换（保持协作一致性）
  // - isLoading=true 时 fetchWhiteboardById 还在进行中，currentWhiteboard 可能是 null
  //   → Navbar 显示 "加载中..." 兜底名称，不影响画布渲染

  return (
    <div className="h-screen flex flex-col bg-[#FAFAFA] overflow-hidden">
      {/* 顶部导航栏 */}
      <Navbar
        whiteboardName={currentWhiteboard?.name || '未命名白板'}
        onBack={handleBack}
        zoom={zoom}
        onZoomOut={handleZoomOut}
        onZoomIn={handleZoomIn}
        onResetViewport={resetViewport}
        elementCount={canvasStore.elements.length}
        connectionStatus={connectionStatus}
        onlineUsers={onlineUsers}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onExport={handleExport}
      />

      {/* 主工作区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧工具栏 */}
        <Toolbar
          activeTool={canvasStore.activeTool}
          onToolChange={handleToolChange}
          onClearCanvas={handleClearCanvas}
          onImportImage={handleImportImage}
        />

        {/* 中间 Canvas 画布 */}
        <div
          className="flex-1 relative transition-[width] duration-300 ease-out min-w-0"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <Canvas
            onRendererReady={handleRendererReady}
            elements={canvasStore.elements}
            selectedIds={canvasStore.selectedIds}
            whiteboardId={id}
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
        <PropertiesPanel
          expanded={panelExpanded}
          onToggle={() => setPanelExpanded((v) => !v)}
        />
      </div>
    </div>
  )
}

/**
 * 获取工具提示文字
 */
function getToolHint(tool: string): string {
  const hints: Record<string, string> = {
    select: '选择工具 (V) - 点击选中，拖拽移动，Shift 锁比例',
    pen: '画笔 (P) - 拖拽绘制自由曲线',
    line: '直线 (L) - 拖拽绘制直线',
    rect: '矩形 (R) - 拖拽绘制矩形',
    circle: '圆形 (O) - 拖拽绘制圆形',
    text: '文本 (T) - 点击放置文本',
    eraser: '橡皮擦 (E) - 点击擦除元素',
  }
  return hints[tool] || tool
}
