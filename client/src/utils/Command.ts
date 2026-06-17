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
  /**
   * 关键修复（刷新后保留 undo 栈）：序列化为纯 JSON 数据。
   * 用于把 undo 栈持久化到 localStorage，刷新后恢复。
   * 不含 store 引用 / 方法回调，仅含可还原状态的快照数据。
   */
  serialize(): SerializedCommandData
}

/**
 * 可序列化的命令数据（纯 JSON）。
 * 用于跨刷新持久化 undo 栈。
 */
export type SerializedCommandData =
  | { type: 'add'; batchId?: string; element: CanvasElement }
  | { type: 'delete'; batchId?: string; snapshot: CanvasElement }
  | { type: 'update'; batchId?: string; oldSnapshot: CanvasElement; newSnapshot: CanvasElement }
  | { type: 'clear-all'; batchId?: string; snapshot: CanvasElement[] }
  | { type: 'batch'; batchId?: string; cmds: SerializedCommandData[] }

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
export function deepClone<T>(value: T): T {
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

  serialize(): SerializedCommandData {
    return {
      type: 'add',
      batchId: this.batchId,
      element: deepClone(this.element),
    }
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

  serialize(): SerializedCommandData {
    return {
      type: 'delete',
      batchId: this.batchId,
      snapshot: deepClone(this.snapshot),
    }
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
   * 关键修复（协作透明 / 圆角丢失 bug）：用户显式传入的字段集合。
   *
   * 背景：拖动滑动条时，`_updateElementLive` 会持续改 store 并写 `updatedAt: Date.now()`。
   * 拖动结束时 PointerUp 调 `updateElement` 构造本命令，但此时：
   *   - `oldSnapshot` 从 store 读出的 current **已经是拖动最终值**
   *   - `newSnapshot` 又是基于 current + 同样的 updates + 新 updatedAt
   *   - `diffSnapshots` 算出 updates 只含 `updatedAt`，**不含用户实际改的字段**
   *   - 广播给 B 后，B 端 `_applyRemoteOp` 用 `{...current, ...updates}` merge，
   *     没拿到 opacity/cornerRadius，B 看不到 + 刷新也看不到
   *
   * 修复：记录构造时用户传入的字段名，execute/undo 广播时**强制带上**这些字段，
   * 不依赖 diffSnapshots 的结果。
   */
  private broadcastFields: Set<string>

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
    this.broadcastFields = new Set(Object.keys(updates))
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
        // 关键修复：广播差集 + 用户显式传入字段，接收方做 merge。
        // 强制带上 broadcastFields 解决滑动条拖动后字段丢失的问题。
        updates: this.computeBroadcastUpdates(this.oldSnapshot, this.newSnapshot),
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
        // 反向：撤销时回到 old，所以 updates 应是 old 的字段
        // 但 broadcastFields 是同一个集合（用户传入的字段名），
        // 撤销时也要把这些字段恢复到 old 端的值
        updates: this.computeBroadcastUpdates(this.newSnapshot, this.oldSnapshot),
      })
    )
  }

  /**
   * 关键修复：构造广播 updates。
   * - 基础：diffSnapshots(from, to) 节省带宽
   * - 强制覆盖：用户显式传入的字段（broadcastFields）从 to 端取值
   *   覆盖 diff 结果（解决 _updateElementLive 期间 store 已被改写导致 diff 丢失原字段的问题）
   */
  private computeBroadcastUpdates(
    from: ElementSnapshot,
    to: ElementSnapshot
  ): Partial<CanvasElement> {
    const updates: any = diffSnapshots(from, to)
    for (const k of this.broadcastFields) {
      if (k === 'id') continue
      // 强制用 to 端的值（execute 时 to=newSnapshot，undo 时 to=oldSnapshot）
      updates[k] = (to as any)[k]
    }
    return updates
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

  serialize(): SerializedCommandData {
    return {
      type: 'update',
      batchId: this.batchId,
      oldSnapshot: deepClone(this.oldSnapshot),
      newSnapshot: deepClone(this.newSnapshot),
    }
  }
}

/** 浅 diff：取 from 中与 to 不同的字段作为 updates（包含 to 端的最新值） */
function diffSnapshots(
  from: ElementSnapshot,
  to: ElementSnapshot
): Partial<CanvasElement> {
  const updates: any = {}
  for (const k of Object.keys(to) as (keyof CanvasElement)[]) {
    // 关键修复：忽略 id 和 updatedAt。
    // - id 不会变
    // - updatedAt 每次 _updateElementLive / 构造命令时都会重新写，对端不应该被覆盖
    if (k === 'id' || k === 'updatedAt') continue
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

  serialize(): SerializedCommandData {
    return {
      type: 'clear-all',
      batchId: this.batchId,
      snapshot: deepClone(this.snapshot),
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

  /**
   * 关键修复（刷新后保留 undo 栈）：批量命令的序列化。
   * 递归序列化每个子命令。
   * 注意：序列化时调用的是子命令的 serialize()，所以子命令的 store
   * 引用不会被保留。
   */
  serialize(): SerializedCommandData {
    return {
      type: 'batch',
      batchId: this.batchId,
      cmds: this.cmds.map((c) => c.serialize()),
    }
  }
}

/**
 * 关键修复（刷新后保留 undo 栈）：把序列化数据反序列化为 Command 对象。
 * 注意：必须传入 store 引用，因为 Command 的 execute/undo 需要操作 store。
 *
 * @param store - CommandStore 接口实现（通常是 canvasStore 暴露的 self）
 * @param data - 序列化数据
 * @returns 反序列化后的 Command 对象
 */
export function deserializeCommand(
  store: CommandStore,
  data: SerializedCommandData
): Command {
  switch (data.type) {
    case 'add': {
      const cmd = new AddElementCommand(store, deepClone(data.element))
      cmd.batchId = data.batchId
      return cmd
    }
    case 'delete': {
      // DeleteElementCommand 构造时从 element 拍快照，我们传 data.snapshot
      const cmd = Object.create(DeleteElementCommand.prototype) as DeleteElementCommand
      // 直接设置 snapshot 字段（绕过构造函数）
      ;(cmd as any).snapshot = deepClone(data.snapshot)
      ;(cmd as any).store = store
      cmd.batchId = data.batchId
      return cmd
    }
    case 'update': {
      const cmd = Object.create(UpdateElementCommand.prototype) as UpdateElementCommand
      ;(cmd as any).store = store
      ;(cmd as any).oldSnapshot = deepClone(data.oldSnapshot)
      ;(cmd as any).newSnapshot = deepClone(data.newSnapshot)
      cmd.batchId = data.batchId
      return cmd
    }
    case 'clear-all': {
      const cmd = Object.create(ClearAllElementsCommand.prototype) as ClearAllElementsCommand
      ;(cmd as any).snapshot = deepClone(data.snapshot)
      ;(cmd as any).store = store
      cmd.batchId = data.batchId
      return cmd
    }
    case 'batch': {
      // 递归反序列化子命令
      const subCmds = data.cmds.map((c) => deserializeCommand(store, c))
      const cmd = new BatchCommand(data.batchId || 'restored', subCmds)
      return cmd
    }
  }
}
