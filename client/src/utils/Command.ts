/**
 * 命令模式 (Command Pattern)
 *
 * 把"对画布的修改"封装为可执行 / 可撤销的命令对象，由 UndoManager
 * 统一管理栈，实现撤销/重做以及 batch 合并。
 *
 * 约定：
 * - 构造命令时拍下"旧状态"快照（深拷贝），execute 应用"新状态"
 * - 公开 API 走 Command；_raw 后缀的低层方法仅供命令重放使用，
 *   避免 undo/redo 本身被记入历史栈
 */

import { CanvasElement } from '@/canvas/CanvasElement'

/** 命令对象接口：execute 实施正向操作，undo 实施反向操作 */
export interface Command {
  /** 命令类型（用于调试与外部识别） */
  readonly type: 'add' | 'delete' | 'update' | 'clear-all' | 'batch'
  /**
   * 批次 ID：可选。UndoManager 会把同 batchId 的连续命令合并为
   * 一个 undo 步骤（拖拽、缩放、旋转、绘制等连续交互常用）。
   */
  batchId?: string
  execute(): void
  undo(): void
}

/**
 * Command 所需的"低层 store 能力"接口
 *
 * 任何命令都通过这个接口读写画布状态，不直接依赖整个 Zustand store。
 * 由 canvasStore 自身实现这套方法（仅暴露给 Command 使用）。
 */
export interface CommandStore {
  _getElementRaw(id: string): CanvasElement | undefined
  _addElementRaw(element: CanvasElement): void
  _removeElementRaw(id: string): void
  _replaceElementRaw(element: CanvasElement): void
  _setElementsRaw(elements: CanvasElement[]): void
}

/** 元素快照类型 = CanvasElement 完整深拷贝（含可选 points） */
export type ElementSnapshot = CanvasElement

/** 深拷贝（仅 CanvasElement 自身的可枚举字段） */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 添加元素命令
 * execute: 把元素加入 elements 列表
 * undo:    从列表移除（按 id）
 */
export class AddElementCommand implements Command {
  readonly type = 'add' as const
  batchId?: string

  constructor(
    private readonly store: CommandStore,
    private readonly element: CanvasElement
  ) {}

  execute(): void {
    this.store._addElementRaw(this.element)
  }

  undo(): void {
    this.store._removeElementRaw(this.element.id)
  }
}

/**
 * 删除元素命令
 * 构造时拍下元素完整快照，undo 时把元素加回。
 * 若被删元素已不存在（连续 undo 后再次 redo 的边界情况），undo 安全跳过。
 */
export class DeleteElementCommand implements Command {
  readonly type = 'delete' as const
  batchId?: string
  private readonly snapshot: ElementSnapshot

  constructor(
    private readonly store: CommandStore,
    element: CanvasElement
  ) {
    this.snapshot = deepClone(element)
  }

  execute(): void {
    this.store._removeElementRaw(this.snapshot.id)
  }

  undo(): void {
    // 防御：仅当元素当前不存在时才恢复（避免覆盖已有数据）
    if (this.store._getElementRaw(this.snapshot.id)) return
    this.store._addElementRaw(deepClone(this.snapshot))
  }
}

/**
 * 更新元素命令
 * 构造时记录 oldSnapshot，updates 应用后得到 newSnapshot；
 * execute 应用新快照，undo 恢复旧快照。
 * 同 batchId 连续多次 update 会自动合并（见 UpdateElementCommand.mergeInto）。
 */
export class UpdateElementCommand implements Command {
  readonly type = 'update' as const
  batchId?: string
  private oldSnapshot: ElementSnapshot
  private newSnapshot: ElementSnapshot

  constructor(
    private readonly store: CommandStore,
    id: string,
    updates: Partial<CanvasElement>
  ) {
    const current = this.store._getElementRaw(id)
    if (!current) {
      // 元素不存在：构造一个空壳，execute/undo 不会真正生效
      this.oldSnapshot = { id, type: 'rect' } as CanvasElement
      this.newSnapshot = { id, type: 'rect' } as CanvasElement
      return
    }
    this.oldSnapshot = deepClone(current)
    this.newSnapshot = deepClone({ ...current, ...updates, updatedAt: Date.now() })
  }

  execute(): void {
    const current = this.store._getElementRaw(this.newSnapshot.id)
    if (!current) return
    this.store._replaceElementRaw(deepClone(this.newSnapshot))
  }

  undo(): void {
    const current = this.store._getElementRaw(this.oldSnapshot.id)
    if (!current) return
    this.store._replaceElementRaw(deepClone(this.oldSnapshot))
  }

  /**
   * 把"同元素的后续更新"合并到本命令：保留最初的 oldSnapshot，
   * 把 newSnapshot 替换为最新一次的新值。
   * 仅当 id 相同才允许合并（不同元素的 update 不应被合并）。
   */
  mergeInto(other: UpdateElementCommand): boolean {
    if (other.oldSnapshot.id !== this.oldSnapshot.id) return false
    this.newSnapshot = deepClone(other.newSnapshot)
    return true
  }
}

/**
 * 清空所有元素命令
 * 构造时拍下整张快照，undo 时整张还原。
 */
export class ClearAllElementsCommand implements Command {
  readonly type = 'clear-all' as const
  batchId?: string
  private readonly snapshot: ElementSnapshot[]

  constructor(
    private readonly store: CommandStore,
    currentElements: CanvasElement[]
  ) {
    this.snapshot = deepClone(currentElements)
  }

  execute(): void {
    this.store._setElementsRaw([])
  }

  undo(): void {
    this.store._setElementsRaw(deepClone(this.snapshot))
  }
}

/**
 * 内部：把一批命令封装为单条栈记录。
 * execute 按原顺序重放；undo 按逆序回放（确保依赖关系正确）。
 * UndoManager.finalizeBatch() 在 endBatch() 时构造此对象并压栈。
 */
export class BatchCommand implements Command {
  readonly type = 'batch' as const
  readonly batchId: string
  private readonly cmds: Command[]

  constructor(batchId: string, cmds: Command[]) {
    this.batchId = batchId
    // 防御性拷贝，避免外部后续修改影响已压栈的 batch
    this.cmds = cmds.slice()
  }

  execute(): void {
    for (const c of this.cmds) c.execute()
  }

  undo(): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) {
      this.cmds[i].undo()
    }
  }
}
