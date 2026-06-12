/**
 * 定时快照服务 (snapshotService)
 *
 * Phase 6.3 — 历史版本 / 增量恢复基础设施
 *
 * 职责：
 * - 每 10 分钟为每个白板生成一次完整快照
 * - 保留最近 10 个快照，超出数量的旧快照自动删除
 * - TTL 30 天作为兜底清理策略
 * - 快照生成异步执行（setInterval），不阻塞操作处理
 * - 生成快照后更新 whiteboards 集合的 currentSnapshotId 字段
 *
 * 关键设计：
 * - 定时器全局唯一（不按白板分别定时）
 * - 每次 tick 扫描所有非删除白板，每个白板独立 try/catch（一个失败不影响其他）
 * - 异步生成：白板 > 1000 元素时可能耗时 100ms+，放在 microtask 中
 *
 * 不做的事（YAGNI）：
 * - ❌ 增量快照（delta）— 完整快照更可靠，恢复更简单
 * - ❌ 压缩存储 — 元素总量不大，简单 JSON 即可
 */

import { SnapshotModel } from '../models/Snapshot'
import Whiteboard, { CanvasElementShape } from '../models/Whiteboard'
import { OperationLogModel } from '../models/OperationLog'
import { setState, clearState } from './stateCache'

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000 // 10 分钟
const KEEP_RECENT = 10 // 保留最近 10 个

let intervalHandle: NodeJS.Timeout | null = null

/**
 * 为单个白板生成快照
 *
 * @param whiteboardId 白板 shortId
 * @param trigger 触发方式
 * @returns 快照 ID（生成失败时为 null）
 */
export async function snapshotWhiteboard(
  whiteboardId: string,
  trigger: 'interval' | 'manual' | 'rollback' = 'interval'
): Promise<string | null> {
  try {
    const whiteboard = await Whiteboard.findOne({ shortId: whiteboardId, deleted: false })
    if (!whiteboard) return null

    // 计算当前 serverVersion（最大 serverVersion）
    const lastOp = await OperationLogModel.findOne({ whiteboardId })
      .sort({ serverVersion: -1 })
      .lean()
    const serverVersion = lastOp?.serverVersion ?? 0

    // 计算当前 lamportClock（最大 lamportClock）
    const lastClock = await OperationLogModel.findOne({ whiteboardId })
      .sort({ lamportClock: -1 })
      .lean()
    const lamportClock = lastClock?.lamportClock ?? 0

    // 创建快照
    const snapshot = await SnapshotModel.create({
      whiteboardId,
      serverVersion,
      lamportClock,
      elements: whiteboard.elements as CanvasElementShape[],
      opCount: serverVersion,
      trigger,
      createdAt: new Date(),
    })

    // 更新白板的 currentSnapshotId
    await Whiteboard.updateOne(
      { shortId: whiteboardId, deleted: false },
      { $set: { currentSnapshotId: snapshot._id.toString() } }
    )

    // 清理超出数量的旧快照（仅保留最近 KEEP_RECENT 个）
    await pruneOldSnapshots(whiteboardId)

    // 同步更新 Redis 状态缓存
    await setState(whiteboardId, whiteboard.elements as CanvasElementShape[], serverVersion)

    console.log(
      `[snapshotService] snapshot created whiteboardId=${whiteboardId} version=${serverVersion} trigger=${trigger}`
    )
    return snapshot._id.toString()
  } catch (err) {
    console.error(
      `[snapshotService] snapshotWhiteboard ${whiteboardId} failed:`,
      (err as Error).message
    )
    return null
  }
}

/**
 * 清理超出保留数量的旧快照
 *
 * 保留策略：每个白板只留最近 KEEP_RECENT 个快照
 */
async function pruneOldSnapshots(whiteboardId: string): Promise<void> {
  try {
    // 取出所有快照按创建时间倒序
    const snapshots = await SnapshotModel.find({ whiteboardId })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean()
    if (snapshots.length <= KEEP_RECENT) return

    // 删除超出部分
    const toDelete = snapshots.slice(KEEP_RECENT).map((s) => s._id)
    await SnapshotModel.deleteMany({ _id: { $in: toDelete } })
  } catch (err) {
    console.warn(
      `[snapshotService] pruneOldSnapshots ${whiteboardId} failed:`,
      (err as Error).message
    )
  }
}

/**
 * 列出白板的所有快照（按时间倒序）
 */
export async function listSnapshots(whiteboardId: string): Promise<
  Array<{
    id: string
    serverVersion: number
    opCount: number
    trigger: string
    createdAt: Date
  }>
> {
  const snapshots = await SnapshotModel.find({ whiteboardId })
    .sort({ createdAt: -1 })
    .select('_id serverVersion opCount trigger createdAt')
    .lean()
  return snapshots.map((s) => ({
    id: s._id.toString(),
    serverVersion: s.serverVersion,
    opCount: s.opCount,
    trigger: s.trigger,
    createdAt: s.createdAt,
  }))
}

/**
 * 读取指定快照的完整内容
 */
export async function getSnapshot(
  whiteboardId: string,
  snapshotId: string
): Promise<{
  id: string
  whiteboardId: string
  serverVersion: number
  elements: CanvasElementShape[]
  createdAt: Date
} | null> {
  try {
    const snap = await SnapshotModel.findOne({ _id: snapshotId, whiteboardId }).lean()
    if (!snap) return null
    return {
      id: snap._id.toString(),
      whiteboardId: snap.whiteboardId,
      serverVersion: snap.serverVersion,
      elements: snap.elements as CanvasElementShape[],
      createdAt: snap.createdAt,
    }
  } catch {
    return null
  }
}

/**
 * 回滚到指定快照
 *
 * 流程：
 * 1. 读取快照
 * 2. 写入新 op（opType=clear-all + add 全量）— 通过 otService 走 OT 流程
 * 3. 生成一个"rollback"类型的快照（作为新的里程碑）
 * 4. 清空 Redis 状态缓存
 *
 * 注意：实际生产中 rollback 走 op 流更安全（不破坏 OT 一致性）。
 * 这里为简化直接覆盖 Whiteboard.elements 字段。
 */
export async function rollbackToSnapshot(
  whiteboardId: string,
  snapshotId: string,
  userId: string
): Promise<boolean> {
  const snap = await getSnapshot(whiteboardId, snapshotId)
  if (!snap) return false

  // 直接覆盖 elements（admin/owner 操作，跳过 OT）
  await Whiteboard.updateOne(
    { shortId: whiteboardId, deleted: false },
    { $set: { elements: snap.elements, currentSnapshotId: snap.id } }
  )

  // 失效 Redis 缓存
  await clearState(whiteboardId)

  // 生成一个 rollback 类型的快照（标记这是回滚点）
  await SnapshotModel.create({
    whiteboardId,
    serverVersion: snap.serverVersion,
    lamportClock: 0,
    elements: snap.elements,
    opCount: 0,
    trigger: 'rollback',
    createdAt: new Date(),
  })
  await pruneOldSnapshots(whiteboardId)

  console.log(
    `[snapshotService] rollback whiteboardId=${whiteboardId} snapshotId=${snapshotId} by=${userId}`
  )
  return true
}

/**
 * 启动定时快照服务（全局 setInterval）
 *
 * 注意：
 * - 进程级单例
 * - tick 间隔固定 10 分钟
 * - 每个白板独立 try/catch
 * - 异步执行：不阻塞 setInterval 回调
 */
export function startSnapshotService(): void {
  if (intervalHandle) {
    console.warn('[snapshotService] already started')
    return
  }
  console.log(
    `[snapshotService] started (interval=${SNAPSHOT_INTERVAL_MS / 1000}s, keep=${KEEP_RECENT})`
  )
  intervalHandle = setInterval(() => {
    void runSnapshotTick()
  }, SNAPSHOT_INTERVAL_MS)
  // 进程退出时清理
  if (typeof process !== 'undefined') {
    process.on('SIGTERM', stopSnapshotService)
    process.on('SIGINT', stopSnapshotService)
  }
}

/** 停止定时快照服务 */
export function stopSnapshotService(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('[snapshotService] stopped')
  }
}

/** 立即执行一次 tick（用于测试 / 手动触发） */
export async function runSnapshotTick(): Promise<void> {
  try {
    const whiteboards = await Whiteboard.find({ deleted: false }).select('shortId').lean()
    for (const wb of whiteboards) {
      try {
        await snapshotWhiteboard(wb.shortId, 'interval')
      } catch (err) {
        console.error(
          `[snapshotService] tick whiteboardId=${wb.shortId} failed:`,
          (err as Error).message
        )
      }
    }
  } catch (err) {
    console.error('[snapshotService] tick failed:', (err as Error).message)
  }
}
