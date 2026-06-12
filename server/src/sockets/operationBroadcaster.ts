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

/** 服务端下行 op（带 userId） */
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
 * 关键修复：用 MongoDB 原子操作持久化 op，绕开 Mongoose __v 乐观锁冲突。
 *
 * 之前用 load→modify→save 模式在并发场景下会抛 VersionError（"No matching document
 * found ... version N modifiedPaths elements"），导致部分 op 静默丢失。
 *
 * 现在按 opType 拆分为原子操作：
 * - add       → $push（同时在 arrayFilters 守卫中按 id 去重，避免重复添加）
 * - update    → $set 整张 elements 数组（用 arrayFilters 定位元素）
 * - delete    → $pull（按 id 精确匹配）
 * - clear-all → $set 整张 elements 为 []
 *
 * 副作用：保存后用 findOne 再读一次最新 elements（避免本地 in-memory 副本与 DB 不一致）
 */
async function persistOpAtomically(
  shortId: string,
  op: ElementOpPayload
): Promise<CanvasElementShape[] | null> {
  switch (op.opType) {
    case 'add': {
      const incoming = op.payload?.element as CanvasElementShape | undefined
      if (!incoming?.id) return null
      // 关键修复：用 $push + arrayFilters 的 nor + elemMatch 组合实现 "不存在则添加"。
      // Mongoose/Mongo 没有原子的 "push if not exists" 算子，最稳的写法是先
      // updateOne（$pull 先去掉同 id 的旧元素，避免 add 重复），再 $push 新元素。
      // 一次 round-trip 完成 add + 去重。
      const updated = await Whiteboard.findOneAndUpdate(
        { shortId, deleted: false, 'elements.id': { $ne: incoming.id } },
        { $push: { elements: incoming } },
        { new: true }
      )
      if (updated) return updated.elements as CanvasElementShape[]
      // 同 id 已存在（幂等），直接读最新 elements 返回
      const wb = await Whiteboard.findOne({ shortId, deleted: false })
      return wb ? (wb.elements as CanvasElementShape[]) : null
    }
    case 'update': {
      const { id, updates } = op.payload ?? {}
      if (!id) return null
      // 关键修复：用 $set 设置嵌套字段而不是替换整个 element。
      //   之前用 `'elements.$[elem]': { ...updates, id }` 会**把整个 element 替换为只剩 diff 字段**，
      //   导致 type/width/height/fill/stroke 等全部丢失，刷新后无法渲染（画布变空）。
      // 正确做法：把每个 update 字段映射到 `elements.$[elem].<field>` 的 $set 操作。
      const setOps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(updates ?? {})) {
        // id 是定位键，不应该被覆盖；如果 payload 里有 id 也忽略
        if (k === 'id') continue
        setOps[`elements.$[elem].${k}`] = v
      }
      if (Object.keys(setOps).length === 0) {
        // 没有字段要更新：直接读最新 elements 返回（幂等）
        const wb = await Whiteboard.findOne({ shortId, deleted: false })
        return wb ? (wb.elements as CanvasElementShape[]) : null
      }
      const updated = await Whiteboard.findOneAndUpdate(
        { shortId, deleted: false, 'elements.id': id },
        { $set: setOps },
        {
          new: true,
          arrayFilters: [{ 'elem.id': id }],
        }
      )
      return updated ? (updated.elements as CanvasElementShape[]) : null
    }
    case 'delete': {
      const { id } = op.payload ?? {}
      if (!id) return null
      const updated = await Whiteboard.findOneAndUpdate(
        { shortId, deleted: false },
        { $pull: { elements: { id } } },
        { new: true }
      )
      return updated ? (updated.elements as CanvasElementShape[]) : null
    }
    case 'clear-all': {
      const updated = await Whiteboard.findOneAndUpdate(
        { shortId, deleted: false },
        { $set: { elements: [] } },
        { new: true }
      )
      return updated ? (updated.elements as CanvasElementShape[]) : null
    }
    default:
      return null
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

  // 3. 关键修复：用原子操作持久化 op（取代 load→modify→save）
  //    之前用 whiteboard.save() 在并发场景下会抛 VersionError
  const newElements = await persistOpAtomically(shortId, op)
  if (!newElements) {
    return { allowed: false, rejectReason: 'PERSIST_FAILED' }
  }

  // 4. 广播给 room 内其他用户（socket.to() 排除自己）
  //    关键设计：广播只携带 op 本身（add/update/delete/clear-all 的 payload），
  //    **不**附带 serverElements。客户端按到达顺序逐个 apply op 即可，不需要
  //    整张对齐（整张对齐会在并发场景下抹掉对方未提交的本地操作）。
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
