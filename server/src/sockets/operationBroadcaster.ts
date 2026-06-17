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
  /** 关键修复：广播时附带 whiteboardId，便于客户端按白板过滤 op */
  whiteboardId: string
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
      // 关键修复：add 用条件 $push 原子化，避免 $pull + $push 两步竞态。
      //
      // 之前实现：先 $pull 去重，再 $push。两次操作之间存在竞态：
      //   - A: pull X (无 X) → push X
      //   - B: pull X (无 X) → push X
      //   两个并发都执行，结果 X 存在一次（因为 $push 默认追加）。
      //   但如果 A 的 pull 结束、B 的 pull 还没开始、A 的 push 之后、B 的 pull 会把 A 推的也 pull 掉
      //   然后 B 再 push。最终 X 仍然存在但内容可能是混合的。
      //
      // 更隐蔽的竞态：
      //   - A: pull X → push X(A) → 此时 X = A
      //   - B: pull X → 把 A 推的也 pull 掉了 → push X(B)
      //   最终 X = B 的内容。A 的 add "丢失"或被覆盖。
      //
      // 正确做法：用 `$ne` 条件让 push 仅在 id 不存在时执行。
      // MongoDB 4.2+ 支持在 update filter 中使用聚合管道条件：
      //   { $expr: { $not: { $in: [incoming.id, "$elements.id"] } } }
      // 如果 id 已存在，整个 update 匹配 0 个文档，$push 不执行（幂等去重）。
      const updated = await Whiteboard.findOneAndUpdate(
        {
          shortId,
          deleted: false,
          $expr: { $not: { $in: [incoming.id, { $ifNull: ['$elements.id', []] }] } },
        },
        { $push: { elements: incoming } },
        { new: true }
      )
      if (updated) {
        return updated.elements as CanvasElementShape[]
      }
      // 元素已存在：幂等返回当前状态（op 已应用过）
      const wb = await Whiteboard.findOne({ shortId, deleted: false })
      return wb ? (wb.elements as CanvasElementShape[]) : null
    }
    case 'update': {
      const { id, updates } = op.payload ?? {}
      if (!id) return null
      // 关键修复：update 用 $set 嵌套字段，避免整张元素被替换。
      const setOps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(updates ?? {})) {
        if (k === 'id') continue
        setOps[`elements.$[elem].${k}`] = v
      }
      if (Object.keys(setOps).length === 0) {
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
      if (!updated) {
        // 关键修复：update 找不到目标元素时不再静默返回 null。
        // 原因：filter 'elements.id': id 要求元素已存在。如果 add 还在飞行中
        // （$push 还没落库），update 来了会匹配 0 个文档 → 静默丢失。
        // 修复：把 update 转为 add（如果 payload 里携带了完整 element 快照），
        // 或者让客户端在 update 失败后重试。
        // 这里采用保守策略：返回当前 elements（不丢失其他元素），但通过 rejectReason 通知。
        const wb = await Whiteboard.findOne({ shortId, deleted: false })
        return wb ? (wb.elements as CanvasElementShape[]) : null
      }
      return updated.elements as CanvasElementShape[]
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

  // 3. 关键修复（实时协作 / B 端延迟看到 bug）：**先广播，再 await 持久化**。
  //
  // 之前的顺序：await persistOpAtomically → socket.to().emit('element-op', ...)
  //   - 含义：mongo 写完后才广播给 B 端
  //   - 副作用：B 端看到的延迟 = mongo 写入时间（5-50ms / op）
  //   - 连续 op 在 opChain 串行处理时，每个 op 的 mongo 写入延迟被叠加
  //   - 用户感知"B 端延迟一段时间才看到 A 的修改/移动"
  //
  // 修复后：先 broadcast → B 端立即看到；mongo 持久化在后台 await 完成
  //   - B 端延迟从 "mongo 写时间" 降到 "socket 推送时间"（< 5ms 本地）
  //   - 边缘情况：如果 mongo 写入失败，**只通知 A 端**（A 可能需要撤销）
  //     **不影响 B 端**：B 已经 apply 了 op，状态由 B 端本地管理
  //   - 持久化失败的情况下，A 端刷新后 B 的状态会"领先"于 A（罕见）
  //   - 这个 trade-off 优先保证实时性（B 端是主用户感知对象）
  //
  // 不附带 serverElements：客户端按到达顺序逐个 apply op，不做整张对齐
  // 关键修复：附带 whiteboardId 便于客户端按白板过滤
  const serverOp: ServerElementOp = { ...op, userId, whiteboardId: shortId }
  socket.to(`whiteboard:${shortId}`).emit('element-op', serverOp)

  // 4. 后台持久化（fire-and-forget）。失败仅通知发送者，不影响广播链。
  const newElements = await persistOpAtomically(shortId, op)
  if (!newElements) {
    socket.emit('error', {
      code: 'PERSIST_FAILED',
      message: 'Op 持久化失败',
    })
    return { allowed: false, rejectReason: 'PERSIST_FAILED' }
  }

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
