/**
 * 操作广播服务 (operationBroadcaster)
 *
 * 职责：
 * - 接收客户端提交的 element-op
 * - 权限检查（viewer 角色拒绝写）
 * - 应用 op 到 MongoDB（白板 elements 字段）
 * - 广播给同 room 内其他用户（不含发送者，由 Socket.IO room broadcast 实现）
 *
 * 6.1 简化（last-write-wins）：
 * - 不写操作日志（不写 operations 集合）
 * - 不做 OT 转换
 * - 直接应用并保存
 * 6.2 / 6.3 阶段升级为 OT + 操作日志。
 */

import { Server, Socket } from 'socket.io'
import Whiteboard, { CanvasElementShape } from '../models/Whiteboard'

/** 客户端 op 协议 */
export interface ElementOpPayload {
  /** 客户端生成的 UUID，用于去重（自己发的回传不重复应用） */
  clientOpId: string
  opType: 'add' | 'update' | 'delete' | 'clear-all'
  payload: any
  timestamp: number
}

/** 服务端 op（带 userId） */
export interface ServerElementOp extends ElementOpPayload {
  userId: string
}

/** 持久化 + 广播结果 */
export interface BroadcastResult {
  /** 权限检查通过？ */
  allowed: boolean
  /** 拒绝原因（如果 allowed=false） */
  rejectReason?: string
  /** 应用后的最新 elements（用于 join-whiteboard-ack） */
  elements?: CanvasElementShape[]
}

/** 查找用户在白板中的角色 */
function getUserRole(
  whiteboard: { collaborators: { userId: string; role: string }[]; ownerId: string },
  userId: string
): 'owner' | 'editor' | 'viewer' | null {
  if (whiteboard.ownerId === userId) return 'owner'
  const c = whiteboard.collaborators.find((c) => c.userId === userId)
  return (c?.role as 'editor' | 'viewer') ?? null
}

/** 应用 op 到 elements 数组（不持久化） */
function applyOpToElements(
  elements: CanvasElementShape[],
  op: ElementOpPayload
): CanvasElementShape[] {
  switch (op.opType) {
    case 'add': {
      const incoming = op.payload?.element as CanvasElementShape | undefined
      if (!incoming?.id) return elements
      // 防御：去重（按 id）
      if (elements.some((e) => e.id === incoming.id)) return elements
      return [...elements, incoming]
    }
    case 'update': {
      const { id, updates } = op.payload ?? {}
      if (!id) return elements
      return elements.map((e) =>
        e.id === id ? { ...e, ...updates, id } : e
      )
    }
    case 'delete': {
      const { id } = op.payload ?? {}
      if (!id) return elements
      return elements.filter((e) => e.id !== id)
    }
    case 'clear-all': {
      return []
    }
    default:
      return elements
  }
}

/**
 * 处理一个 element-op：权限检查 → 应用 → 持久化 → 广播
 *
 * @param io - Socket.IO server 实例
 * @param socket - 发送 op 的 socket（用于排除自己）
 * @param shortId - 白板 shortId
 * @param userId - 操作用户
 * @param op - 客户端 op
 * @returns BroadcastResult
 */
export async function handleElementOp(
  io: Server,
  socket: Socket,
  shortId: string,
  userId: string,
  op: ElementOpPayload
): Promise<BroadcastResult> {
  // 1. 查白板
  const whiteboard = await Whiteboard.findOne({ shortId })
  if (!whiteboard) {
    return { allowed: false, rejectReason: 'WHITEBOARD_NOT_FOUND' }
  }

  // 2. 权限检查
  const role = getUserRole(whiteboard, userId)
  if (!role) {
    return { allowed: false, rejectReason: 'NOT_A_MEMBER' }
  }
  if (role === 'viewer') {
    return { allowed: false, rejectReason: 'FORBIDDEN: viewer cannot write' }
  }

  // 3. 应用 op 到内存中的 elements
  const newElements = applyOpToElements(
    whiteboard.elements as CanvasElementShape[],
    op
  )

  // 4. 持久化（直接全量覆盖。6.2 改为操作日志 + 快照）
  whiteboard.elements = newElements as any
  await whiteboard.save()

  // 5. 广播给 room 内其他用户（socket.to() 排除自己）
  const serverOp: ServerElementOp = { ...op, userId }
  socket.to(`whiteboard:${shortId}`).emit('element-op', serverOp)

  return {
    allowed: true,
    elements: newElements,
  }
}

/**
 * 持久化初始 elements（join 时如果数据库为空，初始化为客户端推送的 elements）
 * 实际上 join-whiteboard-ack 直接读取数据库的 elements 即可，不需要这个函数。
 * 保留以备未来"客户端携带离线 op 主动同步"场景。
 */
export async function setElements(
  shortId: string,
  elements: CanvasElementShape[]
): Promise<void> {
  await Whiteboard.updateOne({ shortId }, { $set: { elements } })
}
