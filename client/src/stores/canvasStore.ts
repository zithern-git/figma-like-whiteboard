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
  Point,
} from '@/canvas/CanvasElement'

/**
 * 命令接口：用于撤销/重做系统
 * 每个操作都封装为命令对象，包含 execute() 和 undo() 方法
 */
export interface Command {
  /** 命令类型 */
  type: 'add' | 'delete' | 'update' | 'clear-all'
  /** 操作的元素 ID */
  elementId?: string
  /** 操作数据（新增/修改时） */
  data?: Partial<CanvasElement>
  /** 操作前的元素状态（用于撤销） */
  previousState?: CanvasElement
  /** 批量操作 ID（用于操作合并） */
  batchId?: string
}

interface CanvasState {
  /** 所有元素列表 */
  elements: CanvasElement[]
  /** 选中的元素 ID 集合 */
  selectedIds: Set<string>
  /** 当前活动工具 */
  activeTool: ToolType
  /** 视口状态 */
  viewport: Viewport
  /** 撤销栈（最大 50 步） */
  undoStack: Command[]
  /** 重做栈 */
  redoStack: Command[]
  /** 当前绘制颜色 */
  strokeColor: string
  /** 当前填充颜色 */
  fillColor: string
  /** 当前描边宽度 */
  strokeWidth: number
  /** 当前字体大小 */
  fontSize: number

  // ========== Actions ==========
  /** 添加元素 */
  addElement: (element: CanvasElement) => void
  /** 更新元素 */
  updateElement: (id: string, updates: Partial<CanvasElement>) => void
  /** 删除元素 */
  deleteElement: (id: string) => void
  /** 删除选中元素 */
  deleteSelectedElements: () => void
  /** 设置选中元素 */
  setSelectedIds: (ids: Set<string>) => void
  /** 切换元素选中状态 */
  toggleSelected: (id: string) => void
  /** 全选 */
  selectAll: () => void
  /** 清空选择 */
  clearSelection: () => void
  /** 设置工具 */
  setTool: (tool: ToolType) => void
  /** 设置视口 */
  setViewport: (viewport: Partial<Viewport>) => void
  /** 设置颜色 */
  setStrokeColor: (color: string) => void
  setFillColor: (color: string) => void
  /** 设置描边宽度 */
  setStrokeWidth: (width: number) => void
  /** 设置字号 */
  setFontSize: (size: number) => void
  /** 撤销 */
  undo: () => void
  /** 重做 */
  redo: () => void
  /** 清空画布 */
  clearAll: () => void
  /** 复制选中元素 */
  duplicateSelected: () => void
  /** 创建新元素（工具使用） */
  createElement: (type: CanvasElement['type'], data: Partial<CanvasElement>) => CanvasElement
}

/** 撤销栈最大深度 */
const MAX_UNDO_STEPS = 50

export const useCanvasStore = create<CanvasState>((set, get) => ({
  elements: [],
  selectedIds: new Set<string>(),
  activeTool: 'select',
  viewport: { x: 0, y: 0, zoom: 1 },
  undoStack: [],
  redoStack: [],
  strokeColor: '#000000',
  fillColor: '#FFFFFF',
  strokeWidth: 2,
  fontSize: 16,

  // ========== 元素操作 ==========

  addElement: (element: CanvasElement) => {
    const state = get()
    // 记录操作到撤销栈
    const command: Command = {
      type: 'add',
      elementId: element.id,
      data: element,
    }
    set({
      elements: [...state.elements, element],
      undoStack: [...state.undoStack.slice(-(MAX_UNDO_STEPS - 1)), command],
      redoStack: [],
    })
  },

  updateElement: (id: string, updates: Partial<CanvasElement>) => {
    const state = get()
    const index = state.elements.findIndex((e) => e.id === id)
    if (index === -1) return

    const oldElement = state.elements[index]
    const updatedElement = { ...oldElement, ...updates, updatedAt: Date.now() }

    const command: Command = {
      type: 'update',
      elementId: id,
      data: updates,
      previousState: oldElement,
    }

    const newElements = [...state.elements]
    newElements[index] = updatedElement

    set({
      elements: newElements,
      undoStack: [...state.undoStack.slice(-(MAX_UNDO_STEPS - 1)), command],
      redoStack: [],
    })
  },

  deleteElement: (id: string) => {
    const state = get()
    const element = state.elements.find((e) => e.id === id)
    if (!element) return

    const command: Command = {
      type: 'delete',
      elementId: id,
      previousState: element,
    }

    const newSelectedIds = new Set(state.selectedIds)
    newSelectedIds.delete(id)

    set({
      elements: state.elements.filter((e) => e.id !== id),
      selectedIds: newSelectedIds,
      undoStack: [...state.undoStack.slice(-(MAX_UNDO_STEPS - 1)), command],
      redoStack: [],
    })
  },

  deleteSelectedElements: () => {
    const state = get()
    if (state.selectedIds.size === 0) return

    // 批量删除：将多个删除操作合并为一个命令
    const deletedElements = state.elements.filter((e) =>
      state.selectedIds.has(e.id)
    )

    const command: Command = {
      type: 'delete',
      batchId: 'batch-' + Date.now(),
      previousState: deletedElements[0], // 简化处理
    }

    set({
      elements: state.elements.filter((e) => !state.selectedIds.has(e.id)),
      selectedIds: new Set<string>(),
      undoStack: [...state.undoStack.slice(-(MAX_UNDO_STEPS - 1)), command],
      redoStack: [],
    })
  },

  // ========== 选择操作 ==========

  setSelectedIds: (ids: Set<string>) => set({ selectedIds: ids }),

  toggleSelected: (id: string) => {
    const state = get()
    const newIds = new Set(state.selectedIds)
    if (newIds.has(id)) {
      newIds.delete(id)
    } else {
      newIds.add(id)
    }
    set({ selectedIds: newIds })
  },

  selectAll: () => {
    const state = get()
    set({ selectedIds: new Set(state.elements.map((e) => e.id)) })
  },

  clearSelection: () => {
    set({ selectedIds: new Set<string>() })
  },

  // ========== 工具与视口 ==========

  setTool: (tool: ToolType) => set({ activeTool: tool }),

  setViewport: (viewport: Partial<Viewport>) => {
    set((state) => ({
      viewport: { ...state.viewport, ...viewport },
    }))
  },

  setStrokeColor: (color: string) => set({ strokeColor: color }),
  setFillColor: (color: string) => set({ fillColor: color }),
  setStrokeWidth: (width: number) => set({ strokeWidth: width }),
  setFontSize: (size: number) => set({ fontSize: size }),

  // ========== 撤销/重做 ==========

  undo: () => {
    const state = get()
    if (state.undoStack.length === 0) return

    const command = state.undoStack[state.undoStack.length - 1]
    const newUndoStack = state.undoStack.slice(0, -1)

    switch (command.type) {
      case 'add': {
        // 撤销添加 = 删除元素
        if (command.elementId) {
          set({
            elements: state.elements.filter((e) => e.id !== command.elementId),
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, command],
          })
        }
        break
      }
      case 'delete': {
        // 撤销删除 = 恢复元素
        if (command.previousState) {
          set({
            elements: [...state.elements, command.previousState],
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, command],
          })
        }
        break
      }
      case 'update': {
        // 撤销更新 = 恢复旧状态
        if (command.elementId && command.previousState) {
          const index = state.elements.findIndex((e) => e.id === command.elementId)
          if (index !== -1) {
            const newElements = [...state.elements]
            newElements[index] = command.previousState
            set({
              elements: newElements,
              undoStack: newUndoStack,
              redoStack: [...state.redoStack, command],
            })
          }
        }
        break
      }
    }
  },

  redo: () => {
    const state = get()
    if (state.redoStack.length === 0) return

    const command = state.redoStack[state.redoStack.length - 1]
    const newRedoStack = state.redoStack.slice(0, -1)

    switch (command.type) {
      case 'add': {
        if (command.data) {
          set({
            elements: [...state.elements, command.data as CanvasElement],
            redoStack: newRedoStack,
            undoStack: [...state.undoStack, command],
          })
        }
        break
      }
      case 'delete': {
        if (command.elementId) {
          set({
            elements: state.elements.filter((e) => e.id !== command.elementId),
            redoStack: newRedoStack,
            undoStack: [...state.undoStack, command],
          })
        }
        break
      }
      case 'update': {
        if (command.elementId && command.data) {
          const index = state.elements.findIndex((e) => e.id === command.elementId)
          if (index !== -1) {
            const newElements = [...state.elements]
            newElements[index] = { ...newElements[index], ...command.data, updatedAt: Date.now() }
            set({
              elements: newElements,
              redoStack: newRedoStack,
              undoStack: [...state.undoStack, command],
            })
          }
        }
        break
      }
    }
  },

  clearAll: () => {
    const state = get()
    const command: Command = {
      type: 'clear-all',
      data: { elements: state.elements } as unknown as Partial<CanvasElement>,
    }
    set({
      elements: [],
      selectedIds: new Set<string>(),
      undoStack: [...state.undoStack.slice(-(MAX_UNDO_STEPS - 1)), command],
      redoStack: [],
    })
  },

  duplicateSelected: () => {
    const state = get()
    const newElements: CanvasElement[] = []

    for (const id of state.selectedIds) {
      const element = state.elements.find((e) => e.id === id)
      if (element) {
        const newElement: CanvasElement = {
          ...element,
          id: nanoid(),
          x: element.x + 20, // 偏移 20px 避免完全重叠
          y: element.y + 20,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        }
        newElements.push(newElement)
      }
    }

    if (newElements.length > 0) {
      set({
        elements: [...state.elements, ...newElements],
        selectedIds: new Set(newElements.map((e) => e.id)),
      })
    }
  },

  /**
   * 创建新元素（工具使用）
   *
   * 根据类型和部分数据创建完整的 CanvasElement 对象。
   * 使用 nanoid 生成唯一 ID，设置默认样式属性。
   *
   * @param type - 元素类型
   * @param data - 部分元素数据
   * @returns 完整的 CanvasElement 对象
   */
  createElement: (
    type: CanvasElement['type'],
    data: Partial<CanvasElement>
  ): CanvasElement => {
    const state = get()
    const now = Date.now()

    return {
      id: nanoid(),
      type,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      opacity: 1,
      fill: state.fillColor,
      stroke: state.strokeColor,
      strokeWidth: state.strokeWidth,
      fontSize: state.fontSize,
      fontFamily: 'Arial',
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: 'current-user', // TODO: 从 authStore 获取
      ...data,
    }
  },
}))