/**
 * Canvas 状态管理 (canvasStore)
 *
 * 使用 Zustand 管理白板画布的核心状态，包括：
 * - 元素列表（elements）
 * - 选中元素（selectedIds）
 * - 当前活动工具（activeTool）
 * - 视口状态（viewport）
 * - 撤销/重做栈（undoStack / redoStack 快照）
 *
 * 所有元素变更操作都通过 Command 模式（utils/Command.ts）执行，
 * 由 UndoManager（utils/UndoManager.ts）管理历史栈。
 *
 * 公开 API 保持向后兼容：
 * - addElement / updateElement / deleteElement / clearAllElements 创建 Command 压栈
 * - undo / redo 由 UndoManager 提供
 * - undoStack / redoStack 字段作为只读快照供 React 订阅
 *
 * 内部 _raw 后缀方法：仅供 Command 重放使用，绕过 UndoManager
 * 防止 undo/redo 本身被记入历史栈。
 */

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { CanvasElement, ToolType, Viewport } from '@/canvas/CanvasElement'
import { AddElementCommand, ClearAllElementsCommand, Command, CommandStore, DeleteElementCommand, deserializeCommand, SerializedCommandData, UpdateElementCommand } from '@/utils/Command'
import { UndoManager } from '@/utils/UndoManager'
import { preloadImages } from '@/canvas/elementsStorage'

// ========== 协作 op 协议（与服务端协议对齐） ==========

/** 客户端上行 op（无 userId，userId 由 socket 认证注入） */
export interface ClientOp {
  /** 客户端生成的 UUID，用于服务端广播回传时去重 */
  clientOpId: string
  opType: 'add' | 'update' | 'delete' | 'clear-all'
  /** op 负载：add→{element}, update→{id, updates}, delete→{id}, clear-all→{} */
  payload: any
  timestamp: number
}

/** 服务端下行 op（带 userId）。关键修复：必须带 whiteboardId 以便客户端过滤 */
export interface ServerOp extends ClientOp {
  userId: string
  /** 关键修复：服务端广播时附带 whiteboardId，客户端按此过滤 op 所属白板 */
  whiteboardId: string
}

/**
 * Canvas 状态接口
 */
interface CanvasState {
  // ========== 核心状态 ==========
  /** 所有元素列表 */
  elements: CanvasElement[]
  /** 选中元素 ID 集合 */
  selectedIds: Set<string>
  /** 当前活动工具 */
  activeTool: ToolType
  /** 视口状态 */
  viewport: Viewport

  // ========== 撤销/重做栈（只读快照，由 UndoManager 同步） ==========
  /** 撤销栈快照 */
  undoStack: readonly Command[]
  /** 重做栈快照 */
  redoStack: readonly Command[]

  // ========== 样式状态 ==========
  /** 描边颜色 */
  strokeColor: string
  /** 填充颜色 */
  fillColor: string
  /** 描边宽度 */
  strokeWidth: number
  /** 字号 */
  fontSize: number
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  textAlign: 'left' | 'center' | 'right'
  textColor: string
  /** 默认矩形圆角半径 */
  cornerRadius: number

  // ========== 元素操作（走 UndoManager，自动入栈） ==========
  /** 添加元素 */
  addElement: (element: CanvasElement) => void
  /** 删除元素 */
  deleteElement: (id: string) => void
  /** 更新元素 */
  updateElement: (id: string, updates: Partial<CanvasElement>) => void
  /**
   * 关键修复（滑动条拖动卡顿 / 拖动失败）：
   * 拖动期间（例如调透明度、缩放、描边宽度）调用的"轻量更新"路径。
   *
   * 行为差异（与 updateElement 对比）：
   * - 跳过 UndoManager.execute：拖动 0.5s 可能触发 30+ 次 onChange，
   *   如果每个都入 undo 栈，用户按一次 Ctrl+Z 只能撤销 0.02 透明度，撤销体验崩溃
   * - 跳过 _broadcastOp：拖动期间持续发 socket 会导致：
   *   1) 每次都 JSON.stringify + 序列化（拖动 0.5s ≈ 30+ 次序列化，CPU 飙升）
   *   2) 服务端按 op 顺序持久化 + 广播给其他用户，其他用户的画布也会"发抖"
   *   3) 服务端可能被高频 op 拖垮
   *   正确做法（Figma 也是）：拖动期间只更新本地画布预览，**松开时才发一次 op**
   *
   * 不入栈 + 不广播 ≠ 静默丢失：调用方应该在用户完成拖动时（PointerUp）再调一次
   * updateElement 提交最终值，那次会入栈 + 广播。
   *
   * 命名（_live 后缀）：与 _raw 后缀保持一致风格（_raw 是 Command 重放专用），
   * _live 是 UI 拖动期间专用。
   */
  _updateElementLive: (id: string, updates: Partial<CanvasElement>) => void
  /**
   * 设置元素列表（用于初始化或全量替换，不入栈）
   * 关键修复（刷新后保留 undo 栈）：加 clearUndoStack 参数。
   * - true（默认）：清空 undo 栈（socket ack / 协作同步等"权威源"场景）
   * - false：保留 undo 栈（localStorage 恢复场景，保留用户的操作历史）
   */
  setElements: (elements: CanvasElement[], clearUndoStack?: boolean) => void
  /**
   * 关键修复（刷新后保留 undo 栈）：用序列化数据恢复 undo/redo 栈。
   * 用于刷新后从 localStorage 加载栈，立即生效。
   */
  restoreUndoStack: (undoData: SerializedCommandData[], redoData?: SerializedCommandData[]) => void
  /**
   * 关键修复（刷新后保留 undo 栈）：导出当前 undo/redo 栈的序列化数据。
   * 用于自动保存到 localStorage。
   */
  serializeUndoStack: () => SerializedCommandData[]
  serializeRedoStack: () => SerializedCommandData[]
  /** 清空所有元素 */
  clearAllElements: () => void

  // ========== 选择操作 ==========
  /** 设置选中元素 */
  setSelectedIds: (ids: Set<string>) => void
  /** 选中单个元素 */
  selectElement: (id: string) => void
  /** 取消选中 */
  deselectAll: () => void
  /** 切换选中状态 */
  toggleSelected: (id: string) => void
  /** 清空选择 */
  clearSelection: () => void
  /** 全选 */
  selectAll: () => void
  /** 删除选中元素（合并为单次 undo） */
  deleteSelectedElements: () => void
  /** 复制选中元素（合并为单次 undo） */
  duplicateSelected: () => void

  // ========== 工具与视口 ==========
  /** 设置活动工具 */
  setTool: (tool: ToolType) => void
  /** 设置视口 */
  setViewport: (viewport: Partial<Viewport>) => void

  // ========== 样式设置 ==========
  setStrokeColor: (color: string) => void
  setFillColor: (color: string) => void
  setStrokeWidth: (width: number) => void
  setFontSize: (size: number) => void
  setFontFamily: (family: string) => void
  setFontWeight: (weight: 'normal' | 'bold') => void
  setFontStyle: (style: 'normal' | 'italic') => void
  setTextAlign: (align: 'left' | 'center' | 'right') => void
  setTextColor: (color: string) => void
  setCornerRadius: (radius: number) => void

  // ========== 撤销/重做（公开 API） ==========
  /** 撤销 */
  undo: () => void
  /** 重做 */
  redo: () => void
  /** 开始一个 undo batch（后续 execute 同 batchId 的命令会合并） */
  beginUndoBatch: (id: string) => void
  /** 结束当前 undo batch */
  endUndoBatch: () => void
  /** 是否可撤销（供 UI 按钮 disabled 状态） */
  canUndo: () => boolean
  /** 是否可重做 */
  canRedo: () => boolean

  // ========== CommandStore 接口（_raw 后缀，仅供 Command 调用） ==========
  _getElementRaw: (id: string) => CanvasElement | undefined
  _addElementRaw: (element: CanvasElement) => void
  _removeElementRaw: (id: string) => void
  _replaceElementRaw: (element: CanvasElement) => void
  _setElementsRaw: (elements: CanvasElement[]) => void

  // ========== 协作上行 / 下行（6.1 实时事件层） ==========
  /**
   * 上行 op 广播回调（由 useSocketCollab 注入）。
   * 未连接时是 no-op。
   */
  _broadcastOp: (op: ClientOp) => void
  /**
   * 应用远端 op：直接走 _raw 方法，不入 undo 栈、不再广播。
   * 用于 socket 收到 element-op 时调用。
   */
  _applyRemoteOp: (op: ServerOp) => void
  /**
   * 注入 / 清除广播回调。
   * useSocketCollab 在 connect 时注入，disconnect 时清除。
   */
  setBroadcastOp: (fn: ((op: ClientOp) => void) | null) => void

  // ========== 元素工厂 ==========
  /** 创建元素（不添加到列表，只返回元素对象） */
  createElement: (
    type: CanvasElement['type'],
    overrides?: Partial<CanvasElement>
  ) => CanvasElement
}

export const useCanvasStore = create<CanvasState>((set, get) => {
  // ========== 内部 UndoManager 实例 ==========
  // onChange 把栈快照同步到 React state，触发订阅
  // 关键：用 [...arr] 创建新数组引用，React 才能检测到引用变化并重新渲染
  const undoManager = new UndoManager(() => {
    set({
      undoStack: [...undoManager.getUndoStackSnapshot()],
      redoStack: [...undoManager.getRedoStackSnapshot()],
    })
  })

  /** 工具：把当前 state 当作 CommandStore 传给 Command */
  const self: CommandStore = {
    _getElementRaw: (id) => get().elements.find((e) => e.id === id),
    _addElementRaw: (element) =>
      set((s) => ({ elements: [...s.elements, element] })),
    _removeElementRaw: (id) =>
      set((s) => ({
        elements: s.elements.filter((e) => e.id !== id),
      })),
    _replaceElementRaw: (element) =>
      set((s) => ({
        elements: s.elements.map((e) => (e.id === element.id ? element : e)),
      })),
    _setElementsRaw: (elements) => set({ elements }),
    /**
     * 关键修复：Command 通过此回调把 op 广播到服务端。
     * execute / undo / redo 都会调用，保证撤销/重做也能同步给其他用户。
     */
    _broadcastOp: (op) => broadcastOp(op),
  }

  // ========== 协作 op 上行回调（由 useSocketCollab 注入） ==========
  // 默认 no-op。未连接 / 断开时调用不报错
  let broadcastOp: (op: ClientOp) => void = () => {}

  return {
    elements: [],
    selectedIds: new Set<string>(),
    activeTool: 'select',
    viewport: { translateX: 0, translateY: 0, zoom: 1 },
    undoStack: [],
    redoStack: [],
    strokeColor: '#000000',
    fillColor: '#FFFFFF',
    strokeWidth: 2,
    fontSize: 16,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAlign: 'left',
    textColor: '#000000',
    cornerRadius: 0,

    // ========== 元素操作（走 UndoManager + 上行广播） ==========
    // 关键修复：广播由 Command 的 execute/undo/redo 自己负责，调用方不再手写 broadcastOp。
    // 这样撤销/重做也能自动同步到服务端（修复"刷新后撤销失效"的 bug）。

    addElement: (element) => {
      undoManager.execute(new AddElementCommand(self, element))
    },

    deleteElement: (id) => {
      const element = get().elements.find((e) => e.id === id)
      if (!element) return
      undoManager.execute(new DeleteElementCommand(self, element))
    },

    updateElement: (id, updates) => {
      undoManager.execute(new UpdateElementCommand(self, id, updates))
    },

    /**
     * 关键修复（滑动条拖动卡顿 / 拖动失败）：
     * 拖动期间的"轻量更新"。跳过 UndoManager 和 _broadcastOp。
     *
     * 实现要点：
     * - 直接用 _replaceElementRaw 写状态（Command 内部也是用这个）
     * - 性能：避免每次深克隆 oldSnapshot（Command 构造时的 deepClone 也会执行）
     *
     * 重要：调用方在用户停止拖动时（PointerUp）必须再调一次 updateElement 提交最终值，
     * 否则用户的修改**不会**进入 undo 栈、不会广播给协作者、不会被 UndoManager 记录。
     */
    _updateElementLive: (id, updates) => {
      const current = self._getElementRaw(id)
      if (!current) return
      // 不做 deepClone：拖动期间频繁调用，深克隆一次 0.5-1ms（points 数组 / imageUrl 字符串），
      // 30+ fps 下累计 30ms+ 阻塞主线程。直接用 ...spread + updates 即可（与 Command 内
      // _replaceElementRaw 行为一致：replace 整张 snapshot，但更新字段少时性能更好）。
      self._replaceElementRaw({ ...current, ...updates, updatedAt: Date.now() })
    },

    /**
     * setElements：直接全量替换，不入 undo 栈，不上行广播。
     * 用于：白板加载、协作同步的快照恢复等场景。
     *
     * 关键修复（刷新后保留 undo 栈）：加 clearUndoStack 参数。
     * - 默认 true：清空 undo 栈（socket ack 覆盖、协作同步等"权威源"场景）
     * - false：保留 undo 栈（localStorage 恢复场景，保留用户的操作历史）
     *
     * 关键设计：清不清空 undo 栈由调用方决定，因为：
     * 1) localStorage 恢复 → 用户期望 Ctrl+Z 仍然有效 → 不清空
     * 2) socket ack 覆盖 → 权威源重置 → 清空 + 后续 restoreUndoStack 重建
     * 3) 协作同步（如其他人清空画布）→ 应该清空
     */
    setElements: (elements, clearUndoStack = true) => {
      if (clearUndoStack) {
        undoManager.clear()
      }
      set({ elements })
    },

    /**
     * 关键修复（刷新后保留 undo 栈）：用序列化数据恢复 undo/redo 栈。
     * 用于：刷新后从 localStorage 加载栈，立即生效。
     * 注意：必须先 setElements（让 store 有正确的 elements 状态），
     * 再 restoreUndoStack（让栈的 execute/undo 引用正确的 store 状态）。
     */
    restoreUndoStack: (undoData: SerializedCommandData[], redoData: SerializedCommandData[] = []) => {
      // 反序列化为 Command 对象（传入 store 引用）
      const undoCommands = undoData.map((d) => deserializeCommand(self, d))
      const redoCommands = redoData.map((d) => deserializeCommand(self, d))
      undoManager.restoreStacks(undoCommands, redoCommands)
    },

    /**
     * 关键修复（刷新后保留 undo 栈）：导出当前栈的序列化数据。
     * 用于：自动保存到 localStorage。
     */
    serializeUndoStack: (): SerializedCommandData[] => undoManager.serializeUndoStack(),
    serializeRedoStack: (): SerializedCommandData[] => undoManager.serializeRedoStack(),

    clearAllElements: () => {
      undoManager.execute(
        new ClearAllElementsCommand(self, get().elements)
      )
    },

    // ========== 选择操作 ==========

    setSelectedIds: (ids) => set({ selectedIds: ids }),

    selectElement: (id) => set({ selectedIds: new Set([id]) }),

    deselectAll: () => set({ selectedIds: new Set() }),

    toggleSelected: (id) =>
      set((state) => {
        const newSet = new Set(state.selectedIds)
        if (newSet.has(id)) {
          newSet.delete(id)
        } else {
          newSet.add(id)
        }
        return { selectedIds: newSet }
      }),

    clearSelection: () => set({ selectedIds: new Set() }),

    selectAll: () =>
      set((state) => ({
        selectedIds: new Set(state.elements.map((e) => e.id)),
      })),

    /**
     * 删除所有选中元素：合并为单次 undo（一步还原全部）。
     * 同时从 selectedIds 移除已删除项。
     * 每个删除操作由 Command 内部广播独立 op。
     */
    deleteSelectedElements: () => {
      const state = get()
      const ids = Array.from(state.selectedIds)
      if (ids.length === 0) return
      undoManager.beginBatch('delete-selected')
      for (const id of ids) {
        const el = state.elements.find((e) => e.id === id)
        if (!el) continue
        undoManager.execute(new DeleteElementCommand(self, el))
      }
      undoManager.endBatch()
      set({ selectedIds: new Set() })
    },

    /**
     * 复制选中元素：合并为单次 undo（Ctrl+Z 一次删除全部副本）。
     * 复制后选区替换为新副本。
     * 每个副本由 Command 内部广播独立 add op。
     */
    duplicateSelected: () => {
      const state = get()
      const selected = state.elements.filter((e) =>
        state.selectedIds.has(e.id)
      )
      if (selected.length === 0) return

      const newIds = new Set<string>()
      undoManager.beginBatch('duplicate-selected')
      selected.forEach((el) => {
        let newPoints = el.points
        if ((el.type === 'pen' || el.type === 'line') && el.points) {
          newPoints = el.points.map((p) => ({ x: p.x + 20, y: p.y + 20 }))
        }
        // 排除原 id，让 createElement 生成新 id
        const { id: _ignored, ...rest } = el
        const copy = state.createElement(el.type, {
          ...rest,
          x: el.x + 20,
          y: el.y + 20,
          points: newPoints,
        })
        undoManager.execute(new AddElementCommand(self, copy))
        newIds.add(copy.id)
      })
      undoManager.endBatch()
      set({ selectedIds: newIds })
    },

    // ========== 工具与视口 ==========

    setTool: (tool) => set({ activeTool: tool }),

    setViewport: (viewport) => {
      set((state) => ({ viewport: { ...state.viewport, ...viewport } }))
    },

    // ========== 样式设置 ==========

    setStrokeColor: (color) => set({ strokeColor: color }),
    setFillColor: (color) => set({ fillColor: color }),
    setStrokeWidth: (width) => set({ strokeWidth: width }),
    setFontSize: (size) => set({ fontSize: size }),
    setFontFamily: (family) => set({ fontFamily: family }),
    setFontWeight: (weight) => set({ fontWeight: weight }),
    setFontStyle: (style) => set({ fontStyle: style }),
    setTextAlign: (align) => set({ textAlign: align }),
    setTextColor: (color) => set({ textColor: color }),
    setCornerRadius: (radius) => set({ cornerRadius: Math.max(0, radius) }),

    // ========== 撤销/重做 ==========

    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    beginUndoBatch: (id) => undoManager.beginBatch(id),
    endUndoBatch: () => undoManager.endBatch(),
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),

    // ========== _raw 方法（CommandStore 接口） ==========

    _getElementRaw: self._getElementRaw,
    _addElementRaw: self._addElementRaw,
    _removeElementRaw: self._removeElementRaw,
    _replaceElementRaw: self._replaceElementRaw,
    _setElementsRaw: self._setElementsRaw,

    // ========== 协作 op 上行 / 下行 ==========

    /**
     * 上行 op 广播：直接调用注入的回调。空回调是 no-op。
     * 暴露为 store 字段（而非方法），保持调用方零成本。
     */
    _broadcastOp: (op) => broadcastOp(op),

    /**
     * 应用远端 op：直接走 _raw 方法（不入 undo 栈、不广播）。
     * - add:        _addElementRaw
     * - update:     _replaceElementRaw
     * - delete:     _removeElementRaw
     * - clear-all:  _setElementsRaw([])
     *
     * 关键设计：忽略 serverElements 字段（即使服务端传过来），只用 op 本身
     * 增量更新本地。原因：
     *   - 6.1 是 last-write-wins，服务端每次 op 都会带上 serverElements（最新持久化状态）
     *   - 如果客户端收到 op 就用 serverElements 整张替换本地，会**抹掉本地未提交的
     *     操作**。例：A 在画矩形的同时 B 在删除 A 已选中的元素，A 收到 B 的 delete
     *     op，serverElements 不含 A 正在画的矩形 → A 的矩形被抹掉 → 双方画布漂移。
     *   - 正确的同步语义是：本地操作按到达顺序逐个 apply，不需要整张对齐。
     *   - 整张对齐只在初次加入白板时用一次（join-whiteboard-ack → setElements）。
     *
     * 丢 op 防御：服务端原子写入后必定广播；Socket.IO 同一 room 内保证有序；
     * 丢 op 情况下允许短期漂移，由用户刷新页面（join-whiteboard-ack）重新对齐。
     */
    _applyRemoteOp: (op: ServerOp) => {
      switch (op.opType) {
        case 'add': {
          const el = op.payload?.element
          if (!el?.id) break
          // 关键修复（B 端图片延迟看到 bug）：
          // 在 add 元素到 store 之前，**立即预热图片**。
          // 背景：
          //   - A 上传图片后广播 add op，B 端收到 → _addElementRaw → store 改
          //     → React re-render → Canvas useEffect [elements] → setElements
          //     → markDirty('main') → 下一帧 renderMainLayer → loadImage
          //     → new Image().src = url → HTTP GET
          //   - 大图（几 MB）HTTP 下载需要几秒，期间 B 端看到"加载中..."占位符
          //   - 用户感知"B 延迟一段时间才看到 A 上传的图"
          // 修复：
          //   - 预热用 fetch + new Image() 启动 HTTP 下载，**与 React 状态更新并行**
          //   - 浏览器 image cache 基于 src URL 共享，CanvasRenderer.loadImage 后续
          //     创建的 new Image() 会命中缓存，毫秒级 readyState = complete
          //   - 移动/修改图片的 update op 不涉及 imageUrl，但仍调 preloadImages
          //     防御（万一 imageUrl 字段被改：例如新上传替换源图）
          if (el.type === 'image' && (el as { imageUrl?: string }).imageUrl) {
            preloadImages([el])
          }
          self._addElementRaw(el)
          break
        }
        case 'update': {
          const { id, updates } = op.payload ?? {}
          if (!id) return
          const current = self._getElementRaw(id)
          if (!current) return
          self._replaceElementRaw({ ...current, ...updates, id })
          break
        }
        case 'delete': {
          const { id } = op.payload ?? {}
          if (id) self._removeElementRaw(id)
          break
        }
        case 'clear-all': {
          self._setElementsRaw([])
          break
        }
      }
    },

    /**
     * 注入 / 清除上行 op 广播回调。
     * useSocketCollab 在 connect 时注入；disconnect 时清除。
     */
    setBroadcastOp: (fn) => {
      broadcastOp = fn ?? (() => {})
    },

    // ========== 元素工厂 ==========

    createElement: (type, overrides) => {
      const defaults: CanvasElement = {
        id: nanoid(),
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        // 透明度反向语义：默认 0 表示完全不透明
        opacity: 0,
        fill: get().fillColor,
        stroke: get().strokeColor,
        strokeWidth: get().strokeWidth,
        cornerRadius: type === 'rect' ? get().cornerRadius : undefined,
        fontSize: type === 'text' ? get().fontSize : undefined,
        fontFamily: type === 'text' ? get().fontFamily : undefined,
        fontWeight: type === 'text' ? get().fontWeight : undefined,
        fontStyle: type === 'text' ? get().fontStyle : undefined,
        textAlign: type === 'text' ? get().textAlign : undefined,
        textColor: type === 'text' ? get().textColor : undefined,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'current-user',
      }

      return { ...defaults, ...overrides }
    },
  }
})

// 关键修复：开发模式下把 store 暴露到 window，便于 E2E 测试和调试
// - 通过 page.evaluate(() => window.__canvasStore.getState()) 可读 elements 等
// - 生产环境不暴露（import.meta.env.PROD）
if (import.meta.env.DEV) {
  ;(window as unknown as { __canvasStore: typeof useCanvasStore }).__canvasStore = useCanvasStore
}
