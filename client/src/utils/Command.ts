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
 *
 * 关键设计：Command 的 execute / undo / redo 各自负责广播对应 op。
 * 这样撤销/重做也会同步到服务端（6.1 last-write-wins 下的协作一致性）。
 * - execute 广播"原 op"（add 元素 → 广播 'add'；delete → 'delete'；...）
 * - undo 广播"反向 op"（add 元素 → undo 广播 'delete'；delete → 'add'；...）
 * - redo 广播"原 op"（与 execute 一致）
 *
 * 每个 op 携带独立的 clientOpId（nanoid），保证服务端接收方能正常 apply
 * （socket.to() 已经排除发送方，clientOpId 仅用于未来可能的去重兜底）。
 */

import { CanvasElement } from '@/canvas/CanvasElement'
import { nanoid } from 'nanoid'

/** 客户端 op 类型（与 server 协议一致） */
export type ClientOpType = 'add' | 'update' | 'delete' | 'clear-all'

/** 广播回调签名 */
export type BroadcastFn = (op: {
  clientOpId: string
  opType: ClientOpType
  payload: any
  timestamp: number
}) => void

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
  /**
   * 广播上行 op（由 useSocketCollab 注入）。
   * 关键修复：Command 的 execute/undo/redo 都通过此回调把 op 发送到服务端，
   * 否则撤销只改本地、服务端状态不更新，刷新后会被 join-whiteboard-ack 覆盖。
   */
  _broadcastOp(op: {
    clientOpId: string
    opType: ClientOpType
    payload: any
    timestamp: number
  }): void
}

/** 元素快照类型 = CanvasElement 完整深拷贝（含可选 points） */
export type ElementSnapshot = CanvasElement

/** 深拷贝（仅 CanvasElement 自身的可枚举字段） */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

/** 工具：构造一个新的 op 对象（带新 clientOpId） */
function makeOp(
  opType: ClientOpType,
  payload: any
): {
  clientOpId: string
  opType: ClientOpType
  payload: any
  timestamp: number
} {
  return { clientOpId: nanoid(), opType, payload, timestamp: Date.now() }
}

/**
 * 添加元素命令
 * execute: 把元素加入 elements 列表 + 广播 'add'
 * undo:    从列表移除（按 id）+ 广播 'delete'
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
    // 关键修复：把广播移进 Command，保证 execute 总是把 'add' op 发到服务端
    this.store._broadcastOp(makeOp('add', { element: this.element }))
  }

  undo(): void {
    this.store._removeElementRaw(this.element.id)
    // 关键修复：撤销 add 也要广播对应 'delete' op
    this.store._broadcastOp(makeOp('delete', { id: this.element.id }))
  }
}

/**
 * 删除元素命令
 * 构造时拍下元素完整快照，undo 时把元素加回 + 广播 'add'。
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
    this.store._broadcastOp(makeOp('delete', { id: this.snapshot.id }))
  }

  undo(): void {
    // 防御：仅当元素当前不存在时才恢复（避免覆盖已有数据）
    if (this.store._getElementRaw(this.snapshot.id)) return
    this.store._addElementRaw(deepClone(this.snapshot))
    this.store._broadcastOp(makeOp('add', { element: this.snapshot }))
  }
}

/**
 * 更新元素命令
 * 构造时记录 oldSnapshot，updates 应用后得到 newSnapshot；
 * execute 应用新快照 + 广播 'update'（new - old 的差集），undo 恢复旧快照 + 广播 'update'。
 * 同 batchId 连续多次 update 会自动合并（见 UpdateElementCommand.mergeInto）。
 */
export class UpdateElementCommand implements Command {
  readonly type = 'update' as const
  batchId?: string
  private oldSnapshot: ElementSnapshot
  private newSnapshot: ElementSnapshot

  /**
   * 暴露只读 id：UndoManager 在 batch 合并时需要按 id 匹配已有的同元素命令。
   * 不暴露完整 snapshot 以避免外部误改。
   */
  get targetId(): string {
    return this.oldSnapshot.id
  }

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
    this.store._broadcastOp(
      makeOp('update', {
        id: this.newSnapshot.id,
        // 关键修复：广播差集字段（new - old），接收方做 merge。
        // 增量字段越小越节省带宽
        updates: diffSnapshots(this.oldSnapshot, this.newSnapshot),
      })
    )
  }

  undo(): void {
    const current = this.store._getElementRaw(this.oldSnapshot.id)
    if (!current) return
    this.store._replaceElementRaw(deepClone(this.oldSnapshot))
    this.store._broadcastOp(
      makeOp('update', {
        id: this.oldSnapshot.id,
        // 反向差集：old - new（撤销时回到 old，所以 updates 应是 old 的字段）
        updates: diffSnapshots(this.newSnapshot, this.oldSnapshot),
      })
    )
  }

  /**
   * 把"同元素的后续更新"合并到本命令：保留最初的 oldSnapshot（拖拽开始的原始位置），
   * 把 newSnapshot 替换为最新一次的新值。
   * 仅当 id 相同才允许合并（不同元素的 update 不应被合并）。
   *
   * 调用语义：调用方执行 `newer.mergeInto(older)`：
   *   - this  = newer（刚到达，包含最新位置）
   *   - other = older（已存在于 batch，记录原始位置）
   * 实现：把 newer 的 newSnapshot 复制到 older，让 older 成为 "oldest→newest" 合并后的最终命令。
   * 撤销 older 时，oldSnapshot（原始位置）保持不变，newSnapshot 已经是最新值。
   *
   * 关键修复：之前是 `this.newSnapshot = deepClone(other.newSnapshot)`，
   * 方向反了，会把 newer 改成 older 的值，等于没合并、还把 newer 弄坏。
   */
  mergeInto(other: UpdateElementCommand): boolean {
    if (other.targetId !== this.targetId) return false
    // this = newer, other = older
    // 把 newer 的 newSnapshot 拷给 older 的 newSnapshot
    // 保留 older 的 oldSnapshot（最原始的状态）
    other.newSnapshot = deepClone(this.newSnapshot)
    return true
  }
}

/** 浅 diff：取 from 中与 to 不同的字段作为 updates（包含 to 端的最新值） */
function diffSnapshots(
  from: ElementSnapshot,
  to: ElementSnapshot
): Partial<CanvasElement> {
  const updates: any = {}
  for (const k of Object.keys(to) as (keyof CanvasElement)[]) {
    if (k === 'id') continue
    if (JSON.stringify((from as any)[k]) !== JSON.stringify((to as any)[k])) {
      updates[k] = (to as any)[k]
    }
  }
  return updates
}

/**
 * 清空所有元素命令
 * 构造时拍下整张快照，undo 时整张还原 + 广播多个 'add' op。
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
    this.store._broadcastOp(makeOp('clear-all', {}))
  }

  undo(): void {
    this.store._setElementsRaw(deepClone(this.snapshot))
    // 撤销 clear-all：逐元素广播 'add'（服务端按 add 处理，幂等去重）
    for (const el of this.snapshot) {
      this.store._broadcastOp(makeOp('add', { element: deepClone(el) }))
    }
  }
}

/**
 * 内部：把一批命令封装为单条栈记录。
 * execute 按原顺序重放；undo 按逆序回放（确保依赖关系正确）。
 * UndoManager.finalizeBatch() 在 endBatch() 时构造此对象并压栈。
 *
 * 关键修复：批量命令的 execute/undo 不直接重放子命令（那样会触发 N 次广播
 * 各自带 clientOpId），而是按"子命令的原始意图"整体重放一次：
 * - execute：按子命令顺序调用 execute()（每条子命令自己广播）
 * - undo：按子命令逆序调用 undo()（每条子命令自己广播）
 * 这样接收方拿到的还是一串独立 op，与"分别执行"等价。
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
