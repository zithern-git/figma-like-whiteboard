/**
 * 白板编辑器页面
 *
 * 整合 Canvas 渲染引擎、工具栏、属性面板和交互系统。
 * 页面布局：左侧工具栏 | 中间 Canvas 画布 | 右侧属性面板
 *
 * Phase 8：拆分为 components/layout/* 三个组件，页面只做编排
 */

import { useEffect, useLayoutEffect, useState, useCallback } from 'react'
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
import { loadElements, saveElements, flushPendingElementsWrites, preloadImages, loadUndoStack, loadRedoStack, saveUndoStack, loadWhiteboardName } from '@/canvas/elementsStorage'

/** 属性面板折叠状态 key（按用户 ID 隔离） */
const PANEL_COLLAPSED_KEY_PREFIX = 'wb:panel:collapsed:'

export default function WhiteboardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  // 关键修复（白板切换名称残留 bug）：
  // 之前 const { currentWhiteboard, fetchWhiteboardById } = useWhiteboardStore()，
  // 整个 store 订阅任何字段变化都触发 re-render，且 currentWhiteboard 可能是上一个白板的
  // 残留数据（id 不匹配当前 URL），导致：
  //   1) 从 second 画板退出后进入 first 画板，Navbar 一瞬间显示 "second" → "first"
  //   2) 频繁的 isLoading 切换触发不必要 re-render
  // 修复：用 selector 精确订阅，并在 id 不匹配时把残留数据视为 null。
  //   - currentWhiteboard 只在 id 匹配时返回真值，否则 null（首次 render 不会显示残留名称）
  //   - fetchWhiteboardById 是稳定的 action，用 selector 单独订阅即可
  const currentWhiteboard = useWhiteboardStore((s) =>
    s.currentWhiteboard && s.currentWhiteboard.id === id ? s.currentWhiteboard : null
  )
  const fetchWhiteboardById = useWhiteboardStore((s) => s.fetchWhiteboardById)

  const canvasStore = useCanvasStore()
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [isLoading, setIsLoading] = useState(true)

  // 关键修复（白板名"未命名白板"bug）：在第一次 render 之前同步从 localStorage
  // 读取白板名缓存。useState lazy init 只在 mount 时跑一次，渲染前完成。
  // 兜底逻辑（Navbar 名称）：
  //   - currentWhiteboard?.name 优先（HTTP GET 成功时）
  //   - 否则 cachedWhiteboardName（socket ack 缓存到 localStorage 的）
  //   - 否则 shortId（前 6 位）/ '未命名白板' 兜底
  const [cachedWhiteboardName, setCachedWhiteboardName] = useState<string | null>(
    () => (id ? loadWhiteboardName(id) : null)
  )
  // 关键修复：socket ack 到达时会更新 localStorage 缓存，但 cachedWhiteboardName
  // 是 useState 不会自动感知 localStorage 变化。让 useSocketCollab 通过 window 事件
  // 通知 WhiteboardPage 更新，或者直接在 socket ack 中回调 setCachedWhiteboardName。
  // 这里用更简单的方案：每次 id 变化时重新从 localStorage 读（已经在 useState lazy init 跑过）
  // socket ack 到达时通过自定义事件通知
  useEffect(() => {
    // 关键修复（白板名"未命名白板"bug）：用 url 的 id 匹配而不是 shortId。
    // 之前 ce.detail.shortId === id 永远 false（URL 是 mongo _id，shortId 是 6 位）。
    // 现在 socket ack 改用 whiteboardId 作 detail 字段，等于 URL 里的 id，能稳定匹配。
    const onNameUpdate = (e: Event) => {
      const ce = e as CustomEvent<{ whiteboardId: string; name: string }>
      if (ce.detail?.whiteboardId === id) {
        setCachedWhiteboardName(ce.detail.name)
      }
    }
    window.addEventListener('whiteboard-name-updated', onNameUpdate)
    return () => window.removeEventListener('whiteboard-name-updated', onNameUpdate)
  }, [id])

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
  // 关键修复（刷新零延迟 / 实时协作）：
  // 之前：socketWhiteboardId = isLoading ? null : (currentWhiteboard?.shortId ?? id ?? null)
  //   - isLoading=true 时 socket 不连接，要等 fetchWhiteboardById HTTP GET 几秒
  //   - fetchWhiteboardById 完成 → setIsLoading(false) → socket 连接 → ack 到达
  //   - 用户感觉"刷新后几秒才能看到画布"
  // 现在：直接用 URL 中的 id（shortId，路由 /whiteboard/:id 已经是 shortId）
  //   - socket 立即连接，ack 立即到达
  //   - fetchWhiteboardById 是为了拿到 currentWhiteboard.name 显示在 Navbar，
  //     **不阻塞画布渲染**和 socket 连接
  //   - currentWhiteboard?.shortId 和 id 在路由上都是 shortId，等价
  //   - 如果 id 是 mongo _id（防御性兜底），用 shortId 转换；如果两者不一致，
  //     socket 远端 op 的 whiteboardId 过滤会失配，但这是后端路由问题，不在客户端处理
  const socketWhiteboardId = id ?? null
  const { connectionStatus, onlineUsers } = useSocketCollab(socketWhiteboardId)

  // 关键修复（刷新立刻恢复 + 白板切换不串扰 + **消除 1-2 帧白屏**）：
  // 之前两个独立 useEffect 依赖 [id]，按代码顺序执行：
  //   1) useEffect A (line 142 旧版) 从 localStorage 恢复 → store 有 cached
  //   2) useEffect B (line 177 旧版) 清空 store → **cached 被清掉！**
  //   3) Canvas 渲染空白
  //   4) 等 socket connect + join + mongo query + ack → 几秒后才看到画布
  //
  // 修复 v2：用 useLayoutEffect 代替 useEffect，让 cached 在**浏览器 paint 之前**
  // 就设置到 zustand store。第一次 render（commit 阶段）后、浏览器 paint 前：
  //   1) 清空内存（白板切换时清掉 A 残留）
  //   2) 同步从 localStorage 恢复 cached
  //   3) 订阅 store 变化自动写 localStorage
  // 这样浏览器首次 paint 时，store 已经有 cached，Canvas 立即渲染 cached。
  // **消除了 1-2 帧（16-32ms）的"store 空 → render 空白"白屏**。
  useLayoutEffect(() => {
    if (!id) return
    // 第 1 步：清空内存（白板切换时清掉 A 残留；首次 mount 时清掉上一白板残留）
    useCanvasStore.setState({ elements: [] })
    useCanvasStore.getState().clearSelection()
    // 关键修复：清空 undo/redo 栈，避免跨白板栈引用旧元素
    // 走 canvasStore.clearUndoStack() 让 UndoManager 同步空栈到 React state
    useCanvasStore.getState().clearUndoStack()

    // 第 2 步：立即从 localStorage 恢复 cached（关键修复：刷新零延迟）
    const cached = loadElements(id)
    if (cached.length > 0) {
      useCanvasStore.getState().setElements(cached, false)
      const undoData = loadUndoStack(id)
      const redoData = loadRedoStack(id)
      if (undoData.length > 0 || redoData.length > 0) {
        console.log(
          `[WhiteboardPage] 从 localStorage 恢复 undo 栈（${undoData.length} 条）/ redo 栈（${redoData.length} 条）`
        )
        useCanvasStore.getState().restoreUndoStack(undoData, redoData)
      }
      preloadImages(cached)
    }

    // 第 3 步：订阅 store 变化，自动写 localStorage
    let prevElements = useCanvasStore.getState().elements
    let prevUndo = useCanvasStore.getState().undoStack
    let prevRedo = useCanvasStore.getState().redoStack
    saveElements(id, prevElements)
    saveUndoStack(
      id,
      useCanvasStore.getState().serializeUndoStack(),
      useCanvasStore.getState().serializeRedoStack()
    )
    const unsub = useCanvasStore.subscribe((s) => {
      if (s.elements !== prevElements) {
        prevElements = s.elements
        saveElements(id, s.elements)
      }
      if (s.undoStack !== prevUndo || s.redoStack !== prevRedo) {
        prevUndo = s.undoStack
        prevRedo = s.redoStack
        saveUndoStack(
          id,
          useCanvasStore.getState().serializeUndoStack(),
          useCanvasStore.getState().serializeRedoStack()
        )
      }
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

  // 关键修复（白板切换 / 名称残留 bug）：
  // 路由变化 (A → B) 时 React Router 复用 WhiteboardPage 不重新 mount：
  //   - currentWhiteboard 仍是 A 的数据 → Navbar 显示 "A" 的名称
  //   - cachedWhiteboardName useState lazy init 只在 mount 跑一次
  //   - fetchWhiteboardById(B) 几百 ms 后才返回 B 的数据
  //   - 中间阶段 Navbar 一直显示 "A" 的名称（残留 bug）
  //
  // 修复：id 变化时
  //   1) 立即清空 currentWhiteboard（Navbar 退到 cachedWhiteboardName 兜底）
  //   2) 同步重读 cachedWhiteboardName（用新 id 查 localStorage）
  //   3) 然后 fetchWhiteboardById（异步 HTTP GET，几百 ms 后用 currentWhiteboard.name 覆盖）
  useEffect(() => {
    if (!id) return
    useWhiteboardStore.setState({ currentWhiteboard: null })
    setCachedWhiteboardName(loadWhiteboardName(id))
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
        // 关键修复（白板名"未命名白板"bug）：
        // 优先 currentWhiteboard?.name（HTTP GET /api/whiteboards/:id 成功时），
        // 否则 cachedWhiteboardName（socket ack 缓存到 localStorage 的），
        // 最后才 "未命名白板"。
        // 之前有 shortId 兜底（6a2a6c55…），用户反馈短 ID 不好看，已移除。
        whiteboardName={
          currentWhiteboard?.name || cachedWhiteboardName || '未命名白板'
        }
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
