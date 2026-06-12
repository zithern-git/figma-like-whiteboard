/**
 * OperationLog Mongoose Model
 *
 * 持久化所有已成功应用 / 被丢弃的 op（白板级操作日志）。
 *
 * 用途：
 * - 增量恢复：新加入客户端从 lastOperationTimestamp 之后开始重放 op
 * - 历史回放：未来支持 timeline / 版本回溯
 * - 冲突分析：调试 transform 正确性
 * - 审计：被 transform 丢弃的 op 也写入（标记 dropped=true）方便回溯
 *
 * 字段与 types.ts 中的 OperationLog 对应，多 _id / createdAt（mongo 文档属性）。
 */

import mongoose, { Document, Schema } from 'mongoose'
import { OpType } from '../ot/types'

/** 持久化日志条目（不与 Document 交叉继承，避免 _id 类型冲突） */
export interface OperationLogFields {
  opId: string
  clientOpId: string
  whiteboardId: string
  userId: string
  opType: OpType
  payload: unknown
  baseVersion: number
  lamportClock: number
  timestamp: number
  prevOpId?: string
  /** 操作成功应用后白板达到的版本号（用于增量恢复） */
  serverVersion: number
  createdAt: Date
  /** 是否被 transform 丢弃（true = 未实际应用到 elements） */
  dropped?: boolean
  /** drop 原因：true = noop，false/undefined = conflict-dropped */
  becameNoop?: boolean
  /** op 应用前的 elements 快照（debug / 审计用，可能很大） */
  snapshotBefore?: unknown
  /** op 应用后的 elements 快照 */
  snapshotAfter?: unknown
}

export interface IOperationLog extends Document, OperationLogFields {}

const opTypeValues: OpType[] = ['add', 'update', 'delete', 'clear-all']

const operationLogSchema = new Schema<IOperationLog>(
  {
    opId: { type: String, required: true, unique: true, index: true },
    clientOpId: { type: String, required: true, index: true },
    whiteboardId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    opType: { type: String, enum: opTypeValues, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    baseVersion: { type: Number, required: true },
    lamportClock: { type: Number, required: true, index: true },
    timestamp: { type: Number, required: true },
    prevOpId: { type: String, required: false },
    serverVersion: { type: Number, required: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    dropped: { type: Boolean, default: false },
    becameNoop: { type: Boolean, default: false },
    snapshotBefore: { type: Schema.Types.Mixed, required: false },
    snapshotAfter: { type: Schema.Types.Mixed, required: false },
  },
  {
    timestamps: false,
    collection: 'operations',
  }
)

// 复合索引：白板 + 版本号（增量恢复用）
operationLogSchema.index({ whiteboardId: 1, serverVersion: 1 })
// 复合索引：白板 + Lamport 时钟（乱序到达去重 / 排序用）
operationLogSchema.index({ whiteboardId: 1, lamportClock: 1, userId: 1 })

export const OperationLogModel = mongoose.model<IOperationLog>(
  'OperationLog',
  operationLogSchema
)
