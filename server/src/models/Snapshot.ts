/**
 * Snapshot Mongoose Model
 *
 * 定时生成的白板完整快照，用于：
 * - 历史版本预览 / 回滚
 * - 加速白板首次加载（避免从第一个 op 重放）
 * - 增量恢复的起点
 *
 * 字段：
 * - _id: ObjectId（默认）
 * - whiteboardId: 白板 shortId
 * - serverVersion: 快照对应的 serverVersion
 * - elements: 元素数组（深拷贝）
 * - lamportClock: 快照对应的全局最大 Lamport 时钟
 * - createdAt: 快照生成时间
 *
 * 索引：
 * - (whiteboardId, createdAt desc): 列时间线
 * - TTL 30 天：兜底清理
 */

import mongoose, { Document, Schema } from 'mongoose'
import { CanvasElementShape } from './Whiteboard'

export interface ISnapshot extends Document {
  whiteboardId: string
  serverVersion: number
  lamportClock: number
  elements: CanvasElementShape[]
  /** 触发快照的 op 数（用于调试） */
  opCount: number
  /** 触发方式：'interval' | 'manual' | 'rollback' */
  trigger: 'interval' | 'manual' | 'rollback'
  createdAt: Date
}

const snapshotSchema = new Schema<ISnapshot>(
  {
    whiteboardId: { type: String, required: true, index: true },
    serverVersion: { type: Number, required: true },
    lamportClock: { type: Number, required: true },
    elements: { type: [Schema.Types.Mixed] as any, default: [] },
    opCount: { type: Number, default: 0 },
    trigger: {
      type: String,
      enum: ['interval', 'manual', 'rollback'],
      default: 'interval',
    },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    collection: 'snapshots',
  }
)

// 复合索引：白板 + 创建时间倒序（列时间线）
snapshotSchema.index({ whiteboardId: 1, createdAt: -1 })
// 复合索引：白板 + serverVersion（增量恢复定位）
snapshotSchema.index({ whiteboardId: 1, serverVersion: -1 })
// TTL 索引：30 天后自动删除（兜底）
snapshotSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
)

export const SnapshotModel = mongoose.model<ISnapshot>('Snapshot', snapshotSchema)
