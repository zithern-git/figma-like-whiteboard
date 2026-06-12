/**
 * 操作日志实时写入服务 (operationLogService)
 *
 * Phase 6.3 — 后端持久化升级
 *
 * 职责：
 * - 每个 op 写入 operations 集合（含 snapshotBefore / snapshotAfter）
 * - 写入延迟 P95 < 50ms（单条 insert 即可满足；批量场景用 bulkWrite）
 * - 暴露批量写入接口（snapshot 生成时使用）
 *
 * 优化点：
 * - 单条写入：直接 insertOne，~5ms
 * - 批量写入：bulkWrite（writeBulk=100），用于 op 积压场景
 * - 失败重试：3 次指数退避
 *
 * 与 otService.ts 的关系：
 * - otService 同步写日志（本服务 insertOne）
 * - snapshotService 异步批量回填（writeBulk）
 */

import { OperationLogModel } from '../models/OperationLog'
import { CanvasElementShape } from '../models/Whiteboard'

/** 写日志入参（不带 _id / createdAt / serverVersion） */
export interface LogEntry {
  opId: string
  clientOpId: string
  whiteboardId: string
  userId: string
  opType: 'add' | 'update' | 'delete' | 'clear-all'
  payload: unknown
  baseVersion: number
  lamportClock: number
  timestamp: number
  prevOpId?: string
}

/**
 * 单条写入
 *
 * @returns 写入耗时（ms），调用方可统计 P95
 */
export async function writeOne(
  entry: LogEntry,
  serverVersion: number,
  snapshotBefore?: CanvasElementShape[],
  snapshotAfter?: CanvasElementShape[]
): Promise<number> {
  const start = Date.now()
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await OperationLogModel.create({
        ...entry,
        serverVersion,
        createdAt: new Date(),
        snapshotBefore: snapshotBefore ?? null,
        snapshotAfter: snapshotAfter ?? null,
      })
      return Date.now() - start
    } catch (err) {
      lastErr = err as Error
      // 退避：50ms / 150ms / 450ms
      await new Promise((r) => setTimeout(r, 50 * Math.pow(3, attempt)))
    }
  }
  console.error(`[operationLogService] writeOne failed after 3 attempts:`, lastErr)
  throw lastErr
}

/** 批量日志条目（带 serverVersion 和快照） */
export interface BulkLogEntry extends LogEntry {
  serverVersion: number
  snapshotBefore?: CanvasElementShape[]
  snapshotAfter?: CanvasElementShape[]
}

/**
 * 批量写入（使用 Mongoose bulkWrite 优化）
 *
 * 用法：snapshotService 回填历史 op 时用
 */
export async function writeBulk(entries: BulkLogEntry[]): Promise<number> {
  if (entries.length === 0) return 0
  const start = Date.now()
  try {
    const ops = entries.map((e) => ({
      insertOne: {
        document: {
          ...e,
          createdAt: new Date(),
        },
      },
    }))
    const result = await OperationLogModel.bulkWrite(ops, { ordered: false })
    const elapsed = Date.now() - start
    console.log(
      `[operationLogService] writeBulk inserted=${result.insertedCount} elapsed=${elapsed}ms`
    )
    return elapsed
  } catch (err) {
    console.error(`[operationLogService] writeBulk failed:`, (err as Error).message)
    throw err
  }
}

/** 获取某白板 [fromVersion, toVersion] 区间的 op（按 serverVersion 升序） */
export async function getOpsInRange(
  whiteboardId: string,
  fromVersion: number,
  toVersion: number
): Promise<BulkLogEntry[]> {
  const logs = await OperationLogModel.find({
    whiteboardId,
    serverVersion: { $gte: fromVersion, $lte: toVersion },
  })
    .sort({ serverVersion: 1 })
    .lean()
  return logs.map((log) => ({
    opId: log.opId,
    clientOpId: log.clientOpId,
    whiteboardId: log.whiteboardId,
    userId: log.userId,
    opType: log.opType,
    payload: log.payload,
    baseVersion: log.baseVersion,
    lamportClock: log.lamportClock,
    timestamp: log.timestamp,
    prevOpId: log.prevOpId,
    serverVersion: log.serverVersion,
    snapshotBefore: log.snapshotBefore as CanvasElementShape[] | undefined,
    snapshotAfter: log.snapshotAfter as CanvasElementShape[] | undefined,
  }))
}
