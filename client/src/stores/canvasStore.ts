/**
 * Canvas 状态管理 (canvasStore)
 *
 * 使用 Zustand 管理白板画布的核心状态，包括：
 * - 元素列表（elements）
 * - 选中元素（selectedIds）
 * - 当前活动工具（activeTool）
 * - 视口状态（viewport）
 * - 撤销/重做栈（undoStack / redoStack）
 *
 * 所有元素变更操作都通过此 store 统一管理，
 * 确保状态一致性和可预测性。
 */

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  CanvasElement,
  ToolType,
  Viewport,
} from '@/canvas/CanvasElement'

/**
 * 命令接口：用于撤销/重做系统
 * 每个操作都封装为命令对象，包含 execute() 和 undo() 方法
 */
export interface Command {
  /** 命令类型 */
  type: 'add' | 'delete' | 'update' | 'clear-all'
  /** 执行命令 */
  execute: () => void
  /** 撤销命令 */
  undo: () => void
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

  // ========== 撤销/重做栈 ==========
  /** 撤销栈 */
  undoStack: Command[]
  /** 重做栈 */
  redoStack: Command[]

  // ========== 样式状态 ==========
  /** 描边颜色 */
  strokeColor: string
  /** 填充颜色 */
  fillColor: string
  /** 描边宽度 */
  strokeWidth: number
  /** 字号 */
  fontSize: number

  // ========== 元素操作 ==========
  /** 添加元素 */
  addElement: (element: CanvasElement) => void
  /** 删除元素 */
  deleteElement: (id: string) => void
  /** 更新元素 */
  updateElement: (id: string, updates: Partial<CanvasElement>) => void
  /** 设置元素列表（用于初始化或全量替换） */
  setElements: (elements: CanvasElement[]) => void
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
  /** 删除选中元素 */
  deleteSelectedElements: () => void
  /** 复制选中元素 */
  duplicateSelected: () => void

  // ========== 工具与视口 ==========
  /** 设置活动工具 */
  setTool: (tool: ToolType) => void
  /** 设置视口 */
  setViewport: (viewport: Partial<Viewport>) => void

  // ========== 样式设置 ==========
  /** 设置描边颜色 */
  setStrokeColor: (color: string) => void
  /** 设置填充颜色 */
  setFillColor: (color: string) => void
  /** 设置描边宽度 */
  setStrokeWidth: (width: number) => void
  /** 设置字号 */
  setFontSize: (size: number) => void
  /** 设置字体 */
  setFontFamily: (family: string) => void
  /** 设置字重 */
  setFontWeight: (weight: 'normal' | 'bold') => void
  /** 设置斜体 */
  setFontStyle: (style: 'normal' | 'italic') => void
  /** 设置文字对齐 */
  setTextAlign: (align: 'left' | 'center' | 'right') => void
  /** 设置文字颜色 */
  setTextColor: (color: string) => void
  /** 设置默认矩形圆角半径 */
  setCornerRadius: (radius: number) => void

  // ========== 撤销/重做 ==========
  /** 撤销 */
  undo: () => void
  /** 重做 */
  redo: () => void

  // ========== 元素工厂 ==========
  /** 创建元素（不添加到列表，只返回元素对象） */
  createElement: (
    type: CanvasElement['type'],
    overrides?: Partial<CanvasElement>
  ) => CanvasElement
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
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

  // ========== 元素操作 ==========

  addElement: (element: CanvasElement) => {
    const command: Command = {
      type: 'add',
      execute: () => {
        set((state) => ({
          elements: [...state.elements, element],
          undoStack: [...state.undoStack, command],
          redoStack: [],
        }))
      },
      undo: () => {
        set((state) => ({
          elements: state.elements.filter((e) => e.id !== element.id),
        }))
      },
    }
    command.execute()
  },

  deleteElement: (id: string) => {
    const element = get().elements.find((e) => e.id === id)
    if (!element) return

    const command: Command = {
      type: 'delete',
      execute: () => {
        set((state) => ({
          elements: state.elements.filter((e) => e.id !== id),
          selectedIds: new Set(
            Array.from(state.selectedIds).filter((sid) => sid !== id)
          ),
          undoStack: [...state.undoStack, command],
          redoStack: [],
        }))
      },
      undo: () => {
        set((state) => ({
          elements: [...state.elements, element],
        }))
      },
    }
    command.execute()
  },

  updateElement: (id: string, updates: Partial<CanvasElement>) => {
    const oldElement = get().elements.find((e) => e.id === id)
    if (!oldElement) return

    const command: Command = {
      type: 'update',
      execute: () => {
        set((state) => ({
          elements: state.elements.map((e) =>
            e.id === id ? { ...e, ...updates, updatedAt: Date.now() } : e
          ),
          undoStack: [...state.undoStack, command],
          redoStack: [],
        }))
      },
      undo: () => {
        set((state) => ({
          elements: state.elements.map((e) =>
            e.id === id ? { ...e, ...oldElement } : e
          ),
        }))
      },
    }
    command.execute()
  },

  setElements: (elements: CanvasElement[]) => set({ elements }),

  clearAllElements: () => {
    const oldElements = get().elements
    const command: Command = {
      type: 'clear-all',
      execute: () => {
        set((state) => ({
          elements: [],
          selectedIds: new Set(),
          undoStack: [...state.undoStack, command],
          redoStack: [],
        }))
      },
      undo: () => {
        set({ elements: oldElements })
      },
    }
    command.execute()
  },

  // ========== 选择操作 ==========

  setSelectedIds: (ids: Set<string>) => set({ selectedIds: ids }),

  selectElement: (id: string) =>
    set((state) => ({
      selectedIds: new Set([id]),
    })),

  deselectAll: () => set({ selectedIds: new Set() }),

  toggleSelected: (id: string) =>
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

  deleteSelectedElements: () => {
    const ids = Array.from(get().selectedIds)
    if (ids.length === 0) return
    ids.forEach((id) => get().deleteElement(id))
    set({ selectedIds: new Set() })
  },

  duplicateSelected: () => {
    const state = get()
    const selected = state.elements.filter((e) => state.selectedIds.has(e.id))
    // 关键修复：复制完成后，把新副本设为选中（替换原元素的选中状态）
    // 这样拖拽移动时只移动副本，原元素保持不动
    const newIds = new Set<string>()
    selected.forEach((el) => {
      // 关键修复：pen 和 line 元素的真实位置在 points 中（绝对坐标），
      // 只偏移 x/y 不偏移 points 会导致副本与原元素位置错乱
      let newPoints = el.points
      if ((el.type === 'pen' || el.type === 'line') && el.points) {
        newPoints = el.points.map((p) => ({ x: p.x + 20, y: p.y + 20 }))
      }
      // 关键修复：必须排除 el.id，让 createElement 使用新生成的 nanoid()，
      // 否则所有副本都会沿用原元素 id，拖拽时 updateElement 只会更新第一个匹配项，
      // 导致多个副本"塌缩"成一个
      const { id: _ignored, ...rest } = el
      const copy = state.createElement(el.type, {
        ...rest,
        x: el.x + 20,
        y: el.y + 20,
        points: newPoints,
      })
      state.addElement(copy)
      newIds.add(copy.id)
    })
    // 关键修复：把 selectedIds 改为只包含新副本
    set({ selectedIds: newIds })
  },

  // ========== 工具与视口 ==========

  setTool: (tool: ToolType) => set({ activeTool: tool }),

  setViewport: (viewport: Partial<Viewport>) => {
    set((state) => ({
      viewport: { ...state.viewport, ...viewport },
    }))
  },

  // ========== 样式设置 ==========

  setStrokeColor: (color: string) => set({ strokeColor: color }),
  setFillColor: (color: string) => set({ fillColor: color }),
  setStrokeWidth: (width: number) => set({ strokeWidth: width }),
  setFontSize: (size: number) => set({ fontSize: size }),
  setFontFamily: (family: string) => set({ fontFamily: family }),
  setFontWeight: (weight: 'normal' | 'bold') => set({ fontWeight: weight }),
  setFontStyle: (style: 'normal' | 'italic') => set({ fontStyle: style }),
  setTextAlign: (align: 'left' | 'center' | 'right') => set({ textAlign: align }),
  setTextColor: (color: string) => set({ textColor: color }),
  setCornerRadius: (radius: number) => set({ cornerRadius: Math.max(0, radius) }),

  // ========== 撤销/重做 ==========

  undo: () => {
    const { undoStack, redoStack } = get()
    if (undoStack.length === 0) return

    const command = undoStack[undoStack.length - 1]
    command.undo()

    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, command],
    })
  },

  redo: () => {
    const { undoStack, redoStack } = get()
    if (redoStack.length === 0) return

    const command = redoStack[redoStack.length - 1]
    command.execute()

    set({
      undoStack: [...undoStack, command],
      redoStack: redoStack.slice(0, -1),
    })
  },

  // ========== 元素工厂 ==========

  createElement: (
    type: CanvasElement['type'],
    overrides?: Partial<CanvasElement>
  ): CanvasElement => {
    const defaults: CanvasElement = {
      id: nanoid(),
      type,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      // 关键修复：透明度语义反转后，默认值改为 0（完全不透明），
      // 而不是旧的 1（在新语义下会变成完全透明）
      opacity: 0,
      fill: get().fillColor,
      stroke: get().strokeColor,
      strokeWidth: get().strokeWidth,
      // 矩形默认带当前 store 中的圆角半径；非矩形类型会被 overrides 覆盖或忽略
      cornerRadius: type === 'rect' ? get().cornerRadius : undefined,
      // 关键修复：文本元素默认带 store 中的文字样式
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
}))
