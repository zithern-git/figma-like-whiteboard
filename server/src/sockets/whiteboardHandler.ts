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

  // ========== join-whiteboard ==========
  socket.on('join-whiteboard', async (payload: JoinPayload) => {
    try {
      const { whiteboardId: shortId } = payload
      if (!shortId) {
        socket.emit('error', { code: 'BAD_REQUEST', message: 'whiteboardId required' })
        return
      }

      // 查白板
      const whiteboard = await Whiteboard.findOne({ shortId })
      if (!whiteboard || whiteboard.deleted) {
        socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Whiteboard not found',
        })
        return
      }

      // 权限
      if (!canAccess(whiteboard, userId)) {
        socket.emit('error', {
          code: 'FORBIDDEN',
          message: 'Not a member of this whiteboard',
        })
        return
      }

      // 加入 Socket.IO room
      socket.join(roomKey(shortId))
      joinedRooms.add(shortId)

      // 更新 Redis 在线集合
      const onlineUsers = await joinOnline(shortId, userId, userName, socket.id)

      // 广播在线列表给房间所有人（含自己，让 UI 立即同步）
      io.to(roomKey(shortId)).emit('online-users', onlineUsers)

      // 推送当前画布状态
      socket.emit('join-whiteboard-ack', {
        elements: whiteboard.elements,
        onlineUsers,
        version: Date.now(), // 6.1 用时间戳作 version
      })
    } catch (err) {
      console.error('join-whiteboard error:', err)
      socket.emit('error', {
        code: 'INTERNAL_ERROR',
        message: 'Failed to join whiteboard',
      })
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

  // ========== element-op ==========
  socket.on('element-op', async (op: ElementOpPayload) => {
    try {
      // 找到该 socket 关联的白板（只支持一个白板）
      const shortId = Array.from(joinedRooms)[0]
      if (!shortId) {
        socket.emit('error', {
          code: 'NOT_IN_WHITEBOARD',
          message: 'Join a whiteboard before sending ops',
        })
        return
      }

      const result = await handleElementOp(io, socket, shortId, userId, op)
      if (!result.allowed) {
        socket.emit('error', {
          code: result.rejectReason?.startsWith('FORBIDDEN') ? 'FORBIDDEN' : 'OP_REJECTED',
          message: result.rejectReason ?? 'Op rejected',
        })
      }
    } catch (err) {
      console.error('element-op error:', err)
      socket.emit('error', {
        code: 'INTERNAL_ERROR',
        message: 'Failed to process op',
      })
    }
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
