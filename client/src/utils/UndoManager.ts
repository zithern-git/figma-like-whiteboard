/**
 * 撤销/重做管理器 (UndoManager)
 *
 * 职责：
 * - 维护 undoStack / redoStack（最大 50 步）
 * - 提供 execute(cmd) 入口，执行命令并压栈
 * - 提供 beginBatch(id) / endBatch() 合并连续同 batchId 命令
 * - 提供 undo() / redo() 出栈并执行反向操作
 * - 提供 canUndo() / canRedo() 查询接口
 * - 每次栈变化通过 onChange 回调通知外部（用于同步 React 订阅）
 *
 * 与 canvasStore 的关系：
 * - UndoManager 不直接持有 store；它只持有 Command 对象
 * - Command 内部通过 CommandStore 接口（_raw 后缀方法）读写画布
 * - canvasStore 在 create 时构造 UndoManager 实例，并把 set() 包装
 *   成 onChange，从而让 React 组件能通过 store.undoStack / store.redoStack
 *   读取栈快照
 */

import { BatchCommand, Command, UpdateElementCommand } from './Command'

/** 栈容量上限：超出后丢弃最早的历史（破坏最早 50 步之外的历史） */
export const UNDO_STACK_LIMIT = 50

export class UndoManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  /** 当前激活的 batch ID（beginBatch 设置，endBatch 或 finalizeBatch 清空） */
  private currentBatchId: string | null = null
  /** 当前 batch 内累积的命令（按执行顺序） */
  private currentBatchCmds: Command[] = []
  /** 栈变化时回调，外部用于同步 React 状态 */
  private readonly onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  /**
   * 执行命令并压栈
   *
   * 决策：
   * 1. 若 cmd.batchId === currentBatchId：累加到当前 batch（拖拽中持续调用）
   * 2. 若 cmd.batchId 是新值（非空）：先 finalize 旧 batch，再开新 batch
   * 3. 若 cmd.batchId 为空：先 finalize 旧 batch，再单条压栈
   *
   * 任何情况下都清空 redoStack（undo 之后画新元素 → 历史分支切换）
   */
  execute(cmd: Command): void {
    // 1. 应用变更
    cmd.execute()

    // 2. 决定压栈位置
    if (cmd.batchId) {
      if (this.currentBatchId === cmd.batchId) {
        // 同 batch：尝试与最后一条 UpdateElementCommand 合并
        const last = this.currentBatchCmds[this.currentBatchCmds.length - 1]
        if (
          cmd instanceof UpdateElementCommand &&
          last instanceof UpdateElementCommand &&
          cmd.mergeInto(last)
        ) {
          // 合并成功：不追加新命令
        } else {
          this.currentBatchCmds.push(cmd)
        }
      } else {
        // 新 batch 启动：先提交上一个 batch
        this.finalizeBatch()
        this.currentBatchId = cmd.batchId
        this.currentBatchCmds = [cmd]
      }
    } else {
      // 非 batch 命令：先提交上一个 batch
      this.finalizeBatch()
      this.push(cmd)
    }

    // 3. 清空 redoStack
    if (this.redoStack.length > 0) {
      this.redoStack = []
    }

    // 4. 通知外部
    this.onChange()
  }

  /**
   * 开始一个 batch：之后 execute(cmd) 带相同 batchId 的命令会合并。
   * 若当前已有激活的 batch，会先 finalize 它（防止泄漏）。
   */
  beginBatch(batchId: string): void {
    this.finalizeBatch()
    this.currentBatchId = batchId
    this.currentBatchCmds = []
  }

  /**
   * 结束当前 batch：把累积的命令封装为 BatchCommand 压栈。
   * 若当前 batch 无命令（用户在 begin 之后没产生任何修改就 end），
   * 不压栈，避免空 undo 步骤。
   */
  endBatch(): void {
    this.finalizeBatch()
    this.onChange()
  }

  /**
   * 撤销：弹出一条命令并执行其 undo，然后推入 redoStack。
   * 若当前有未结束的 batch，会先 finalize（保证撤销语义清晰）。
   */
  undo(): void {
    this.finalizeBatch()
    if (this.undoStack.length === 0) return
    const cmd = this.undoStack.pop()!
    cmd.undo()
    this.redoStack.push(cmd)
    this.onChange()
  }

  /**
   * 重做：弹出一条命令并执行其 execute，然后推回 undoStack。
   */
  redo(): void {
    if (this.redoStack.length === 0) return
    const cmd = this.redoStack.pop()!
    cmd.execute()
    this.undoStack.push(cmd)
    this.onChange()
  }

  /** 查询：当前是否可以撤销（用于工具栏按钮 disabled 状态） */
  canUndo(): boolean {
    return this.undoStack.length > 0 || this.currentBatchCmds.length > 0
  }

  /** 查询：当前是否可以重做 */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 当前 undoStack 长度（仅用于测试 / 调试） */
  getUndoStackSize(): number {
    return this.undoStack.length
  }

  /** 当前 redoStack 长度 */
  getRedoStackSize(): number {
    return this.redoStack.length
  }

  /** 清空两个栈（白板切换时使用） */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.currentBatchId = null
    this.currentBatchCmds = []
    this.onChange()
  }

  /** 取栈快照（只读视图，供 React 订阅） */
  getUndoStackSnapshot(): readonly Command[] {
    return this.undoStack
  }

  getRedoStackSnapshot(): readonly Command[] {
    return this.redoStack
  }

  /**
   * 把当前 batch 内的命令封装为 BatchCommand 压栈（若非空）。
   * 任何"切换 batch"、"非 batch 命令 execute"、"undo/redo" 之前都要调用。
   */
  private finalizeBatch(): void {
    if (this.currentBatchId !== null && this.currentBatchCmds.length > 0) {
      this.push(new BatchCommand(this.currentBatchId, this.currentBatchCmds))
    }
    this.currentBatchId = null
    this.currentBatchCmds = []
  }

  /** 内部压栈：超过上限时丢弃最早记录 */
  private push(cmd: Command): void {
    this.undoStack.push(cmd)
    if (this.undoStack.length > UNDO_STACK_LIMIT) {
      this.undoStack.shift()
    }
  }
}
