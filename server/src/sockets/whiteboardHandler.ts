/**
 * 白板事件处理器 (whiteboardHandler)
 *
 * 注册到 Socket.IO connection 事件，处理白板相关的所有 socket 事件：
 * - join-whiteboard：用户加入，加入 Redis 在线集合，广播在线列表
 * - leave-whiteboard：用户主动离开
 * - element-op：操作同步（权限检查 + 持久化 + 广播）
 * - cursor-move：光标位置同步（节流由客户端处理）
 * - disconnect：socket 断开时清理该 socket 的在线状态
 *
 * 不在 whiteboardHandler 的：
 * - 元素 op 的具体应用逻辑（operationBroadcaster）
 * - 在线集合的存储（onlineUsers）
 * - Socket.IO server 初始化（sockets/index.ts）
 */

import { Server, Socket } from 'socket.io'
import mongoose from 'mongoose'
import Whiteboard from '../models/Whiteboard'
import {
  ElementOpPayload,
  handleElementOp,
} from './operationBroadcaster'
import {
  joinOnline,
  leaveOnline,
  listOnline,
  OnlineUserInfo,
} from './onlineUsers'

/** 客户端加入白板的 payload */
interface JoinPayload {
  whiteboardId: string
}

/** 光标位置 payload */
interface CursorPayload {
  x: number
  y: number
}

/** room 命名 */
const roomKey = (shortId: string) => `whiteboard:${shortId}`

/**
 * 关键修复（协作元素丢失 bug）：跨 socket 的 op 串行化。
 *
 * 之前每个 socket 内部用 opChain 串行化自己的 op，但**不同 socket 之间是并发执行
 * 持久化的**。当 A 的 add X 和 B 的 add X 几乎同时到达时：
 *   - A: pull X (无 X) → push X
 *   - B: pull X (无 X) → push X
 *   两个并发都执行，可能导致 A 的 add 被 B 的 pull 抹掉 → "少一个"元素
 *
 * 修复：维护一个 Map<roomKey, Promise>，每个 room 的 op 都 append 到该 room 的 chain 上。
 * 这样无论多少客户端并发发 op，同一 room 的 op 在服务端是**严格按到达顺序**持久化的。
 *
 * 关键设计：
 * - 串行化粒度是 room（不是 socket），保证不同用户协作时 op 有序
 * - 串行化只影响持久化顺序，广播仍然是 fire-and-forget
 * - Promise 异常隔离：单个 op 失败不影响后续 op
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roomOpChains: Map<string, Promise<any>> = new Map()

/**
 * 把 op 串行化到指定 room 的执行链上。
 * - 同一 room 的 op 严格按到达顺序执行 persistOp
 * - 不同 room 的 op 完全独立（不会因为 room A 慢而阻塞 room B）
 */
function serializeOpForRoom(
  shortId: string,
  op: ElementOpPayload,
  fn: (op: ElementOpPayload) => Promise<unknown>
): Promise<unknown> {
  const key = roomKey(shortId)
  const prev = roomOpChains.get(key) ?? Promise.resolve()
  const next = prev
    .catch(() => {
      // 关键修复：上一个 op 失败不应该阻断后续 op，重置 chain
      return
    })
    .then(() => fn(op))
  // 关键修复：保存新 chain（不 catch，让调用方处理错误）
  // 但为了避免 unhandled rejection 污染进程，再用 swallow 包装存到 Map 的版本
  const swallow = next.catch(() => {
    // 错误已被调用方处理（socket.on('error') 监听），
    // 这里只 swallow unhandled 警告
  })
  roomOpChains.set(key, swallow)
  return next
}

/**
 * 验证用户对白板的访问权限
 * - 必须是 owner / collaborator 才允许加入
 * - viewer 角色可加入（可读），但写 op 会被 operationBroadcaster 拒绝
 */
function canAccess(
  whiteboard: { ownerId: string; collaborators: { userId: string }[] } | null,
  userId: string
): boolean {
  if (!whiteboard) return false
  if (whiteboard.ownerId === userId) return true
  return whiteboard.collaborators.some((c) => c.userId === userId)
}

/** 注册白板相关的所有事件到 socket */
export function registerWhiteboardHandlers(io: Server, socket: Socket): void {
  const userId: string = socket.data.userId
  const userName: string = socket.data.name || userId

  // 跟踪 socket 当前所在的白板 room（用于 disconnect 时清理）
  const joinedRooms = new Set<string>()

  // 关键修复：追踪当前 in-flight 的 join-whiteboard Promise。
  //
  // 问题背景：
  // - join-whiteboard 处理器是 async（要先 await DB 查白板）
  // - element-op 处理器是 async，**但 joinedRooms 检查是同步的**（没有 await 在前）
  // - 当客户端断网重连时，会在同一个 tick 内发出 join-whiteboard + 多个 element-op
  // - socket.io 按顺序处理：join-whiteboard handler 启动，await DB 时挂起
  // - 接着 element-op handler 启动，joinedRooms 还是空的（join 还没完成）→ 拒绝
  // - 结果：所有离线补发的 op 都被 NOT_IN_WHITEBOARD 拒绝，服务端状态没更新
  //
  // 修复：让 element-op handler 等最近的 join-whiteboard 完成后再检查 joinedRooms
  let pendingJoin: Promise<string | null> | null = null

  /**
   * 关键修复：op 序列化链。
   *
   * socket.io 不会 await async event handler 的 promise — 当 handler 遇到第一个 await
   * 就立刻返回，下一个事件立即开始处理。这意味着同一个 socket 发出的多个 op
   * 实际上是并发执行的。
   *
   * 问题：客户端重连补发时，会在 join-whiteboard 后立即发 N 个 element-op
   * （add A, update A, add B, update B）。这些 op 在服务端并发执行：
   *   - add A     启动 → 等待 DB findOneAndUpdate
   *   - update A  启动 → 等待 DB findOneAndUpdate，filter 要求 elements.id=A
   *     但 add A 的写入可能还没落库 → filter 不匹配 → PERSIST_FAILED
   *
   * 修复：把每个 op 包进 opChain.then()，让它们严格按到达顺序执行。
   */
  let opChain: Promise<void> = Promise.resolve()

  // ========== join-whiteboard ==========
  socket.on('join-whiteboard', async (payload: JoinPayload) => {
    // 关键修复：先同步设置 pendingJoin，让 element-op handler 能 await
    const joinPromise = (async (): Promise<string | null> => {
      try {
        // 客户端可能传 shortId（6位 nanoid）或 mongo _id（来自 URL /whiteboard/:id）
        // 两种都支持：用 $or 同时查
        const { whiteboardId: id } = payload
        if (!id) {
          socket.emit('error', { code: 'BAD_REQUEST', message: 'whiteboardId required' })
          return null
        }

        // 查白板：支持 shortId 或 mongo _id
        const orConditions: any[] = [{ shortId: id }]
        if (mongoose.isValidObjectId(id)) {
          orConditions.push({ _id: id })
        }
        const whiteboard = await Whiteboard.findOne({
          deleted: false,
          $or: orConditions,
        })
        if (!whiteboard) {
          socket.emit('error', {
            code: 'NOT_FOUND',
            message: 'Whiteboard not found',
          })
          return null
        }

        // 关键：用文档里实际的 shortId（标准化）作为 room key 和 joinedRooms
        // 这样不管客户端传 shortId 还是 _id，房间命名都一致
        const shortId = whiteboard.shortId

        // 权限
        if (!canAccess(whiteboard, userId)) {
          socket.emit('error', {
            code: 'FORBIDDEN',
            message: 'Not a member of this whiteboard',
          })
          return null
        }

        // 加入 Socket.IO room
        socket.join(roomKey(shortId))
        joinedRooms.add(shortId)

        // 更新 Redis 在线集合
        const onlineUsers = await joinOnline(shortId, userId, userName, socket.id)

        // 广播在线列表给房间所有人（含自己，让 UI 立即同步）
        io.to(roomKey(shortId)).emit('online-users', onlineUsers)

        // 关键修复（白板名"未命名白板"bug）：在 ack payload 中附带白板名。
        // 原因：客户端 HTTP GET /api/whiteboards/:id 需要 requireRole（owner/editor/viewer），
        // 某些用户可能不在 collaborators 列表中 → 403 → currentWhiteboard 永远 null
        // → Navbar 退到 "未命名白板" 兜底。
        // socket join 不要求角色（任何人能加入协作），所以用 socket ack 携带 name
        // 是最可靠的来源。客户端缓存到 localStorage 作为刷新后的兜底。
        socket.emit('join-whiteboard-ack', {
          elements: whiteboard.elements,
          onlineUsers,
          whiteboardName: whiteboard.name,
          whiteboardShortId: shortId,
          version: Date.now(), // 6.1 用时间戳作 version
        })
        return shortId
      } catch (err) {
        console.error('join-whiteboard error:', err)
        socket.emit('error', {
          code: 'INTERNAL_ERROR',
          message: 'Failed to join whiteboard',
        })
        return null
      }
    })()

    // 关键修复：把 Promise 暴露给 element-op handler
    pendingJoin = joinPromise
    try {
      await joinPromise
    } finally {
      // 清理 pendingJoin（但仅当它还是当前 promise 时）
      if (pendingJoin === joinPromise) {
        pendingJoin = null
      }
    }
  })

  // ========== leave-whiteboard ==========
  socket.on('leave-whiteboard', async (payload: JoinPayload) => {
    try {
      const { whiteboardId: shortId } = payload
      if (!shortId) return
      await handleLeave(io, socket, shortId, userId, joinedRooms)
    } catch (err) {
      console.error('leave-whiteboard error:', err)
    }
  })

  // ========== leave-all-rooms（关键修复：多白板切换串扰）==========
  // 客户端在 cleanup 时调用，让服务端把当前 socket 从所有 whiteboard room 移除
  socket.on('leave-all-rooms', async () => {
    try {
      for (const shortId of Array.from(joinedRooms)) {
        await handleLeave(io, socket, shortId, userId, joinedRooms)
      }
    } catch (err) {
      console.error('leave-all-rooms error:', err)
    }
  })

  // ========== element-op ==========
  socket.on('element-op', (op: ElementOpPayload) => {
    // 关键修复：用 opChain 串行化每个 op 的处理。
    // socket.io 不会 await async handler —— handler 遇到第一个 await 就立刻返回，
    // 下一个事件立即被处理。如果不串行化，重连补发的多个 op 会并发执行，
    // 后续 op 可能在前一个 op 落库前就执行（filter 不匹配 → PERSIST_FAILED）。
    //
    // 串行化后：
    // - 每个 op 在前一个 op 完全处理完（DB 持久化 + 广播）之后才开始
    // - op 顺序与客户端发送顺序严格一致
    // - 错误被 .catch 捕获，不影响后续 op
    opChain = opChain
      .then(async () => {
        // 关键修复：断网重连场景下，客户端会在同一个 tick 内连续 emit
        // join-whiteboard + 多个 element-op。join-whiteboard handler 启动后
        // 会 await DB，此时事件循环里接着处理 element-op，但 joinedRooms
        // 还是空集合（join 还没完成），导致所有离线补发的 op 被
        // NOT_IN_WHITEBOARD 拒绝。
        //
        // 修复：joinedRooms 为空但有 in-flight 的 join-whiteboard 时，
        // 先 await join 完成，再检查 joinedRooms。
        if (joinedRooms.size === 0 && pendingJoin) {
          await pendingJoin
        }

        // 找到该 socket 关联的白板（只支持一个白板）
        const shortId = Array.from(joinedRooms)[0]
        if (!shortId) {
          socket.emit('error', {
            code: 'NOT_IN_WHITEBOARD',
            message: 'Join a whiteboard before sending ops',
          })
          return
        }

        // 关键修复（协作元素丢失 bug）：跨 socket 串行化同一 room 的 op。
        // 这里把"持久化+广播"这一步放到 room 级别的 chain 上，
        // 保证无论多少客户端并发，op 都按到达顺序落库。
        // socket 内部 opChain 处理"同一 socket 的 op 串行"，
        // room chain 处理"不同 socket 的 op 串行"，两者结合做到完全有序。
        await serializeOpForRoom(shortId, op, async (opToProcess) => {
          const opSize = JSON.stringify(opToProcess).length
          const payloadKb = (opSize / 1024).toFixed(1)
          console.log(
            `[element-op] user=${userId} shortId=${shortId} opType=${opToProcess.opType} payload=${payloadKb}KB clientOpId=${opToProcess.clientOpId}`
          )
          const result = await handleElementOp(io, socket, shortId, userId, opToProcess)
          if (!result.allowed) {
            socket.emit('error', {
              code: result.rejectReason?.startsWith('FORBIDDEN') ? 'FORBIDDEN' : 'OP_REJECTED',
              message: result.rejectReason ?? 'Op rejected',
            })
          }
        })
      })
      .catch((err) => {
        console.error('element-op error:', err)
        socket.emit('error', {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process op',
        })
      })
  })

  // ========== cursor-move ==========
  socket.on('cursor-move', (payload: CursorPayload) => {
    const shortId = Array.from(joinedRooms)[0]
    if (!shortId) return
    // 服务端不做节流（每 socket 独立），仅转发
    socket.to(roomKey(shortId)).emit('cursor-move', {
      userId,
      x: payload.x,
      y: payload.y,
    })
  })

  // ========== disconnect ==========
  socket.on('disconnect', async () => {
    for (const shortId of Array.from(joinedRooms)) {
      await handleLeave(io, socket, shortId, userId, joinedRooms)
    }
  })
}

/** 用户离开的通用逻辑（leave-whiteboard / disconnect 共用） */
async function handleLeave(
  io: Server,
  socket: Socket,
  shortId: string,
  userId: string,
  joinedRooms: Set<string>
): Promise<void> {
  socket.leave(roomKey(shortId))
  joinedRooms.delete(shortId)

  const onlineUsers = await leaveOnline(shortId, socket.id)
  io.to(roomKey(shortId)).emit('online-users', onlineUsers)
}
