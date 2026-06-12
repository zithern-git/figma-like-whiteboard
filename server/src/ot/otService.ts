/**
 * OT 冲突解决服务 (otService)
 *
 * 核心职责：
 * 1. 维护 per-whiteboard 操作队列（按 Lamport 时钟 + userId 字典序排序）
 * 2. 乱序处理：缓冲 op 等到前序 op 到达（超时 200ms 后请求客户端重传）
 * 3. 冲突检测：比较 op.baseVersion 与白板当前 currentVersion，不一致则 transform
 * 4. 版本更新：op 成功应用后 currentVersion + 1
 * 5. 操作日志：成功应用时立即写入 MongoDB operations 集合
 *
 * 用法（被 operationBroadcaster 调用）：
 *   const ctx = await otService.applyOp(shortId, op)
 *   if (ctx.transformed) {
 *     // op 被 transform 过，需要广播给所有客户端（含发送者）
 *   }
 *
 * 设计要点：
 * - 服务端是单一权威：所有 op 都走服务端 apply
 * - 客户端 op 携带 baseVersion + lamportClock
 * - 若 op.baseVersion < currentVersion → 存在并发 op，必须 transform
 * - 若 op.baseVersion > currentVersion → 乱序到达，进入 buffer 等候
 * - 若 op.baseVersion === currentVersion → 直接应用
 */

import { Server, Socket } from 'socket.io'
import { nanoid } from 'nanoid'
import Whiteboard, { CanvasElementShape } from '../models/Whiteboard'
import { OperationLogModel } from '../models/OperationLog'
import {
  Operation,
  OpType,
  TransformResult,
  AddOpPayload,
  UpdateOpPayload,
  DeleteOpPayload,
} from './types'
import { createLamportClock, compareByLamport } from './LamportClock'
import type { LamportClock } from './types'
import { transform, transformChain, compose } from './transform'

/** 队列元素：等待被应用的 op */
interface QueuedOp {
  op: Operation
  enqueuedAt: number
  socket: Socket
  userName: string
}

/** 缓冲中的乱序 op（baseVersion > currentVersion） */
interface BufferedOp {
  op: Operation
  enqueuedAt: number
  socket: Socket
  userName: string
}

/** 应用结果 */
export interface ApplyResult {
  /** op 是否被应用（false = 被丢弃或 noop） */
  applied: boolean
  /** 是否退化为 noop */
  becameNoop: boolean
  /** 是否被 transform 改写 */
  transformed: boolean
  /** 是否乱序（被缓冲而非直接应用） */
  buffered: boolean
  /** 当前白板版本号 */
  currentVersion: number
  /** 当前白板 elements（应用后的最新状态） */
  elements: CanvasElementShape[]
  /** opId（服务端分配） */
  opId: string
  /** 广播给其他用户的 op（应用后或被丢弃时） */
  broadcastOp: Operation
}

/** 白板级 OT 上下文（懒加载） */
interface WhiteboardContext {
  shortId: string
  currentVersion: number
  lamportClock: LamportClock
  /** 等待处理的 op 队列（按 Lamport 全序） */
  queue: QueuedOp[]
  /** 乱序 op 缓冲（按 baseVersion 升序） */
  buffer: BufferedOp[]
  /** 定时器：缓冲超时后请求客户端重传 */
  bufferTimer: NodeJS.Timeout | null
  /** 元素状态（与 MongoDB 同步；这里缓存用于 transform 阶段的几何调整） */
  elements: CanvasElementShape[]
}

// 缓冲等待超时（200ms）
const BUFFER_TIMEOUT_MS = 200
// 队列最大长度（防止恶意积压）
const MAX_QUEUE_SIZE = 1000
// 缓冲最大长度
const MAX_BUFFER_SIZE = 500

class OTService {
  private io: Server | null = null
  private contexts = new Map<string, WhiteboardContext>()

  /** 初始化（由 sockets/index.ts 在启动时调用） */
  init(io: Server): void {
    this.io = io
  }

  /**
   * 应用 op 到指定白板（主入口）
   *
   * 流程：
   * 1. 获取/创建 WhiteboardContext
   * 2. 更新 Lamport 时钟（observe 远端 clock）
   * 3. 比较 op.baseVersion 与 currentVersion
   *    - 相等 → 直接应用
   *    - 小于 → transform 后应用
   *    - 大于 → 缓冲等候
   * 4. 应用成功 → 持久化日志 + 广播
   */
  async applyOp(
    shortId: string,
    rawOp: Operation,
    socket: Socket,
    userName: string
  ): Promise<ApplyResult> {
    const ctx = await this.getOrCreateContext(shortId)

    // 1. 更新 Lamport 时钟
    const newClock = ctx.lamportClock.observe(rawOp.lamportClock)
    const op: Operation = { ...rawOp, lamportClock: newClock }

    // 2. 冲突检测
    if (op.baseVersion === ctx.currentVersion) {
      return await this.applyAndAdvance(ctx, op, socket, userName, /* transformed */ false)
    }

    if (op.baseVersion < ctx.currentVersion) {
      // 落后：需要 transform
      const recentOps = await this.getRecentOps(shortId, op.baseVersion, ctx.currentVersion)
      const tr = transformChain(recentOps, op)
      if (tr.dropped || tr.becameNoop) {
        // 仍然写入日志（记录"被丢弃的 op"以供审计）
        return await this.recordDropped(ctx, tr.operation, socket, userName, tr.becameNoop)
      }
      return await this.applyAndAdvance(ctx, tr.operation, socket, userName, /* transformed */ true)
    }

    // op.baseVersion > ctx.currentVersion：乱序
    return this.bufferOutOfOrder(ctx, op, socket, userName)
  }

  /**
   * 缓冲乱序 op
   */
  private bufferOutOfOrder(
    ctx: WhiteboardContext,
    op: Operation,
    socket: Socket,
    userName: string
  ): ApplyResult {
    if (ctx.buffer.length >= MAX_BUFFER_SIZE) {
      // 缓冲满 → 拒绝
      socket.emit('error', {
        code: 'BUFFER_FULL',
        message: 'Server buffer is full, please retry later',
      })
      return {
        applied: false,
        becameNoop: false,
        transformed: false,
        buffered: false,
        currentVersion: ctx.currentVersion,
        elements: ctx.elements,
        opId: '',
        broadcastOp: op,
      }
    }

    // 插入缓冲（按 baseVersion 升序）
    const buffered: BufferedOp = { op, enqueuedAt: Date.now(), socket, userName }
    this.insertBuffered(ctx, buffered)
    this.scheduleBufferFlush(ctx)

    return {
      applied: false,
      becameNoop: false,
      transformed: false,
      buffered: true,
      currentVersion: ctx.currentVersion,
      elements: ctx.elements,
      opId: '',
      broadcastOp: op,
    }
  }

  /**
   * 把 buffered op 按 baseVersion 升序插入
   */
  private insertBuffered(ctx: WhiteboardContext, item: BufferedOp): void {
    const idx = ctx.buffer.findIndex((b) => b.op.baseVersion > item.op.baseVersion)
    if (idx === -1) ctx.buffer.push(item)
    else ctx.buffer.splice(idx, 0, item)
  }

  /**
   * 调度缓冲刷新定时器
   * - 200ms 后检查缓冲，若缓冲首项的 baseVersion 仍 > currentVersion → 请求重传
   */
  private scheduleBufferFlush(ctx: WhiteboardContext): void {
    if (ctx.bufferTimer) return
    ctx.bufferTimer = setTimeout(() => {
      ctx.bufferTimer = null
      this.flushBuffer(ctx).catch((err) => {
        console.error(`[OT] flushBuffer error for ${ctx.shortId}:`, err)
      })
    }, BUFFER_TIMEOUT_MS)
  }

  /**
   * 刷新缓冲：依次处理 baseVersion === currentVersion 的项
   * 若首项仍乱序 → 给所有涉及 socket 发"请重传 baseVersion = currentVersion 之后的 op"
   */
  private async flushBuffer(ctx: WhiteboardContext): Promise<void> {
    while (ctx.buffer.length > 0) {
      const head = ctx.buffer[0]
      if (head.op.baseVersion > ctx.currentVersion) {
        // 仍乱序：通知最早 socket 重传（避免无谓打扰所有用户）
        if (Date.now() - head.enqueuedAt >= BUFFER_TIMEOUT_MS) {
          head.socket.emit('op-resend-request', {
            fromVersion: ctx.currentVersion,
            reason: 'BUFFER_TIMEOUT',
          })
        }
        // 再等一段时间后重试
        this.scheduleBufferFlush(ctx)
        return
      }
      // 可以应用
      const item = ctx.buffer.shift()!
      try {
        if (head.op.baseVersion < ctx.currentVersion) {
          // 期间被其他 op 推进过 → transform
          const recentOps = await this.getRecentOps(
            ctx.shortId,
            item.op.baseVersion,
            ctx.currentVersion
          )
          const tr = transformChain(recentOps, item.op)
          if (tr.dropped || tr.becameNoop) {
            await this.recordDropped(ctx, tr.operation, item.socket, item.userName, tr.becameNoop)
            continue
          }
          await this.applyAndAdvance(ctx, tr.operation, item.socket, item.userName, true)
        } else {
          // baseVersion === currentVersion
          await this.applyAndAdvance(ctx, item.op, item.socket, item.userName, false)
        }
      } catch (err) {
        console.error(`[OT] failed to apply buffered op:`, err)
        item.socket.emit('error', {
          code: 'INTERNAL_ERROR',
          message: 'Failed to apply buffered op',
        })
      }
    }
  }

  /**
   * 应用 op 并推进 currentVersion + 持久化日志
   */
  private async applyAndAdvance(
    ctx: WhiteboardContext,
    op: Operation,
    socket: Socket,
    userName: string,
    transformed: boolean
  ): Promise<ApplyResult> {
    // 1. 写日志（先于 elements 持久化，确保日志与状态一致）
    const opId = nanoid(12)
    const newVersion = ctx.currentVersion + 1

    const logDoc = new OperationLogModel({
      opId,
      clientOpId: op.clientOpId,
      whiteboardId: op.whiteboardId,
      userId: op.userId,
      opType: op.opType,
      payload: op.payload,
      baseVersion: op.baseVersion,
      lamportClock: op.lamportClock,
      timestamp: op.timestamp,
      prevOpId: op.prevOpId,
      serverVersion: newVersion,
      createdAt: new Date(),
    })
    try {
      await logDoc.save()
    } catch (err) {
      console.error(`[OT] failed to persist op log:`, err)
      // 日志失败不应该阻塞 op 应用（容错），但要警告
    }

    // 2. 应用 op 到 elements（in-memory + 持久化）
    const newElements = this.applyOpToElements(ctx.elements, op)
    ctx.elements = newElements
    ctx.currentVersion = newVersion

    try {
      await Whiteboard.updateOne(
        { shortId: ctx.shortId, deleted: false },
        { $set: { elements: newElements } }
      )
    } catch (err) {
      console.error(`[OT] failed to persist elements:`, err)
      // 持久化失败也要广播（in-memory 已经更新），但要告警
    }

    // 3. 构造广播 op（带 serverVersion 和 opId）
    const broadcastOp: Operation = {
      ...op,
      id: opId,
      baseVersion: ctx.currentVersion,
    }

    // 4. 广播给 room 内所有用户（含发送者，由客户端按 clientOpId 去重）
    if (this.io) {
      this.io.to(`whiteboard:${ctx.shortId}`).emit('element-op', {
        ...broadcastOp,
        userName,
        serverVersion: ctx.currentVersion,
        transformed,
      })
    }

    return {
      applied: true,
      becameNoop: false,
      transformed,
      buffered: false,
      currentVersion: ctx.currentVersion,
      elements: newElements,
      opId,
      broadcastOp,
    }
  }

  /**
   * 记录被丢弃的 op（不应用、不推进版本，但仍写日志供审计）
   */
  private async recordDropped(
    ctx: WhiteboardContext,
    op: Operation,
    socket: Socket,
    userName: string,
    becameNoop: boolean
  ): Promise<ApplyResult> {
    const opId = nanoid(12)
    try {
      await OperationLogModel.create({
        opId,
        clientOpId: op.clientOpId,
        whiteboardId: op.whiteboardId,
        userId: op.userId,
        opType: op.opType,
        payload: op.payload,
        baseVersion: op.baseVersion,
        lamportClock: op.lamportClock,
        timestamp: op.timestamp,
        prevOpId: op.prevOpId,
        serverVersion: ctx.currentVersion, // 没推进
        createdAt: new Date(),
        dropped: true,
        becameNoop,
      })
    } catch (err) {
      console.error(`[OT] failed to persist dropped op log:`, err)
    }

    // 广播一个"op 被丢弃"的回执给所有客户端（含发送者），
    // 让客户端知道这个 opId 不需要再等待（避免"无应答"的 UI 卡顿）
    if (this.io) {
      this.io.to(`whiteboard:${ctx.shortId}`).emit('element-op-dropped', {
        opId,
        clientOpId: op.clientOpId,
        reason: becameNoop ? 'BECAME_NOOP' : 'CONFLICT_DROPPED',
        userId: op.userId,
        serverVersion: ctx.currentVersion,
      })
    }

    return {
      applied: false,
      becameNoop,
      transformed: true,
      buffered: false,
      currentVersion: ctx.currentVersion,
      elements: ctx.elements,
      opId,
      broadcastOp: op,
    }
  }

  /**
   * 应用 op 到 elements 数组（不持久化）
   * 与 operationBroadcaster.applyOpToElements 保持一致
   */
  private applyOpToElements(
    elements: CanvasElementShape[],
    op: Operation
  ): CanvasElementShape[] {
    switch (op.opType) {
      case 'add': {
        const incoming = (op.payload as AddOpPayload)?.element as CanvasElementShape | undefined
        if (!incoming?.id) return elements
        if (elements.some((e) => e.id === incoming.id)) return elements
        return [...elements, incoming]
      }
      case 'update': {
        const { id, updates } = op.payload as UpdateOpPayload
        if (!id) return elements
        return elements.map((e) => (e.id === id ? { ...e, ...updates, id } : e))
      }
      case 'delete': {
        const { id } = op.payload as DeleteOpPayload
        if (!id) return elements
        return elements.filter((e) => e.id !== id)
      }
      case 'clear-all':
        return []
      default:
        return elements
    }
  }

  /**
   * 获取某白板 [fromVersion+1, toVersion] 区间内已应用的 op
   * 用于 transform 时构造"前序 op 链"
   */
  private async getRecentOps(
    shortId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<Operation[]> {
    try {
      const logs = await OperationLogModel.find({
        whiteboardId: shortId,
        serverVersion: { $gt: fromVersion, $lte: toVersion },
        dropped: { $ne: true },
      })
        .sort({ serverVersion: 1 })
        .lean()
      return logs.map((log) => ({
        id: log.opId,
        clientOpId: log.clientOpId,
        whiteboardId: log.whiteboardId,
        userId: log.userId,
        opType: log.opType,
        payload: log.payload as Operation['payload'],
        baseVersion: log.baseVersion,
        lamportClock: log.lamportClock,
        timestamp: log.timestamp,
        prevOpId: log.prevOpId,
      }))
    } catch (err) {
      console.error(`[OT] getRecentOps failed:`, err)
      return []
    }
  }

  /**
   * 获取或创建白板 OT 上下文
   */
  private async getOrCreateContext(shortId: string): Promise<WhiteboardContext> {
    let ctx = this.contexts.get(shortId)
    if (ctx) return ctx

    // 从 MongoDB 加载白板状态
    const whiteboard = await Whiteboard.findOne({ shortId, deleted: false })
    if (!whiteboard) {
      throw new Error(`Whiteboard ${shortId} not found`)
    }

    // 计算 currentVersion = 当前最大 serverVersion
    const lastLog = await OperationLogModel.findOne({ whiteboardId: shortId })
      .sort({ serverVersion: -1 })
      .lean()
    const currentVersion = lastLog?.serverVersion ?? 0

    // 初始化 Lamport 时钟：从已记录的最大 lamportClock + 1 开始
    const lastClock = await OperationLogModel.findOne({ whiteboardId: shortId })
      .sort({ lamportClock: -1 })
      .lean()
    const lamportClock = createLamportClock(lastClock?.lamportClock ?? 0)

    ctx = {
      shortId,
      currentVersion,
      lamportClock,
      queue: [],
      buffer: [],
      bufferTimer: null,
      elements: (whiteboard.elements as CanvasElementShape[]) ?? [],
    }
    this.contexts.set(shortId, ctx)
    return ctx
  }

  /**
   * 调试/测试用：清空白板 OT 上下文
   */
  resetContext(shortId: string): void {
    const ctx = this.contexts.get(shortId)
    if (ctx?.bufferTimer) clearTimeout(ctx.bufferTimer)
    this.contexts.delete(shortId)
  }

  /**
   * 获取白板当前状态（调试/测试用）
   */
  getState(shortId: string): { currentVersion: number; elements: CanvasElementShape[] } | null {
    const ctx = this.contexts.get(shortId)
    if (!ctx) return null
    return { currentVersion: ctx.currentVersion, elements: ctx.elements }
  }
}

export const otService = new OTService()

// 导出工具函数（便于单元测试）
export { transform, transformChain, compose, createLamportClock, compareByLamport }
export type { Operation, TransformResult, OpType }
