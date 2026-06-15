/**
 * Socket.IO 协作客户端 Hook (useSocketCollab)
 *
 * 职责：
 * - 连接 Socket.IO 服务端
 * - 把上行 op 广播函数注入到 canvasStore
 * - 把远端 op 转发到 canvasStore._applyRemoteOp
 * - 管理在线用户列表（提供 React 订阅）
 * - 提供 sendCursorMove 方法（由 Canvas 在 mousemove 时调用）
 * - 监听连接状态变化、断线重连
 *
 * 关键修复（Phase 7）：离线操作队列
 * - 断网时：op 缓存到本地队列（不丢失）
 * - 重连后：按顺序补发队列中的 op
 * - 补发成功后：清空队列，显示 toast 提示用户
 * - 队列上限：100 条，超限后丢弃最旧的（防止内存溢出）
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useCanvasStore, ClientOp, ServerOp } from '@/stores/canvasStore'
import { CanvasElement } from '@/canvas/CanvasElement'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'

/** 在线用户展示信息（与服务端协议对齐） */
export interface OnlineUser {
  userId: string
  name: string
  color: string
}

/** hook 返回值 */
export interface UseSocketCollabReturn {
  /** 当前 Socket.IO 连接状态 */
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  /** 在线用户列表 */
  onlineUsers: OnlineUser[]
  /** 发送光标位置（应 50ms 节流） */
  sendCursorMove: (x: number, y: number) => void
  /** 当前用户自己的 userId（从 authStore 读） */
  currentUserId: string
}

const CURSOR_THROTTLE_MS = 50
/** 离线队列最大长度，防止内存溢出 */
const MAX_OFFLINE_QUEUE = 100

export function useSocketCollab(
  whiteboardId: string | null
): UseSocketCollabReturn {
  const token = useAuthStore((s) => s.token)
  const currentUserId = useAuthStore((s) => s.user?.id || '')

  const [connectionStatus, setConnectionStatus] =
    useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])

  const socketRef = useRef<Socket | null>(null)
  /** 待去重集合：自己发的 clientOpId 集合；收到回传时移除 */
  const pendingClientOpIds = useRef<Set<string>>(new Set())

  /**
   * 关键修复：离线操作队列。
   * 断网时 op 不发 socket，而是 push 到 offlineQueue。
   * 重连后按 FIFO 顺序补发。
   */
  const offlineQueue = useRef<ClientOp[]>([])

  /**
   * 关键修复（位置错乱 bug）：待合并 op 列表。
   *
   * 重连时，connect 事件把 offlineQueue 的 op 转交给这个列表。
   * - 这些 op 已经发往服务端，服务端会持久化
   * - 服务端不广播给发送者（socket.to() 排除自己）
   * - 但 join-whiteboard-ack 会带服务端当前状态（断网前的旧状态）到达
   * - 如果直接 setElements(serverState)，本地会被回退到老位置！
   *
   * 修复：ack 到达时，先把 serverState 与这个列表里的 op 合并，再 setElements
   * - 服务端状态 = 其他人离线期间做的改动
   * - 这个列表 = 自己离线期间做的改动（应该覆盖服务端状态）
   * - 合并 = 取并集，自己后写优先
   *
   * 关键修复 v2（快速重连 bug）：在 join-whiteboard 等待 ack 的窗口内，
   * 如果用户继续产生新 op（持续拖动、未松手时网络恢复），这些 op
   * 走"在线"分支被直接 emit，不会进入 opsToMergeOnAck。但 ack 到达
   * 时 merge 只用 opsToMergeOnAck，导致"窗口期"的新 op 在 merge 中
   * 丢失。修复：用 isWaitingForAck 标志位让 broadcastOp 在等待窗口
   * 内把所有 op 追加进 opsToMergeOnAck。
   */
  const opsToMergeOnAck = useRef<ClientOp[]>([])

  /**
   * 关键修复 v2：join-whiteboard 已发出但 ack 尚未到达的窗口期。
   *
   * 这个窗口期内产生的 op 必须合并到 opsToMergeOnAck，否则会在
   * "快速重连"场景下丢失（用户正在拖动 → 网络恢复 → 用户继续拖动 →
   * 后半段 op 在线发出但不在 merge 队列里）。
   */
  const isWaitingForAck = useRef(false)

  // ========== cursor-move 节流 ==========
  const lastCursorSendRef = useRef<number>(0)
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null)
  const cursorTimerRef = useRef<number | null>(null)

  const flushCursor = useCallback(() => {
    const socket = socketRef.current
    if (!socket || !pendingCursorRef.current) return
    socket.emit('cursor-move', pendingCursorRef.current)
    pendingCursorRef.current = null
    cursorTimerRef.current = null
  }, [])

  const sendCursorMove = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      const elapsed = now - lastCursorSendRef.current
      if (elapsed >= CURSOR_THROTTLE_MS) {
        lastCursorSendRef.current = now
        socketRef.current?.emit('cursor-move', { x, y })
      } else {
        // 未到发送节流：暂存 + 定时器补发
        pendingCursorRef.current = { x, y }
        if (cursorTimerRef.current === null) {
          cursorTimerRef.current = window.setTimeout(
            flushCursor,
            CURSOR_THROTTLE_MS - elapsed
          )
        }
      }
    },
    [flushCursor]
  )

  // ========== 主连接 effect ==========
  useEffect(() => {
    if (!whiteboardId || !token) {
      setConnectionStatus('disconnected')
      return
    }

    setConnectionStatus('connecting')

    const socket = io('/', {
      path: '/socket.io',
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      maxHttpBufferSize: 20 * 1024 * 1024,
    } as any)
    socketRef.current = socket
    // 调试用：把 socket 暴露到 window，便于 E2E 测试模拟断网
    if (import.meta.env.DEV) {
      ;(window as unknown as { __socket: Socket }).__socket = socket
      ;(window as unknown as { __offlineQueue: ClientOp[] }).__offlineQueue = offlineQueue.current
    }

    // ========== 注入上行 op 广播回调到 store ==========
    const canvasStore = useCanvasStore.getState()
    canvasStore.setBroadcastOp((op: ClientOp) => {
      // 关键修复 v2（快速重连 bug）：在 join-whiteboard 等待 ack 的窗口内，
      // 任何新 op 都必须追加进 opsToMergeOnAck，否则在 ack 到达时这些 op
      // 不会进入 merge，本地状态会丢失它们。
      if (isWaitingForAck.current) {
        opsToMergeOnAck.current.push(op)
      }

      // 关键修复：判断当前是否在线
      if (socket.connected) {
        // 在线：直接 emit
        pendingClientOpIds.current.add(op.clientOpId)
        socket.emit('element-op', op)
      } else {
        // 离线：缓存到队列
        offlineQueue.current.push(op)
        // 超限丢弃最旧的
        if (offlineQueue.current.length > MAX_OFFLINE_QUEUE) {
          offlineQueue.current.shift()
        }
      }
    })

    // ========== 连接事件 ==========
    socket.on('connect', () => {
      setConnectionStatus('connected')
      // 关键修复 v2：进入"等待 ack"窗口
      // 之后任何新 op 都会进 opsToMergeOnAck，避免在快速重连场景下丢失
      isWaitingForAck.current = true
      // 重新加入白板
      socket.emit('join-whiteboard', { whiteboardId })

      // 关键修复：重连后补发离线队列中的 op
      if (offlineQueue.current.length > 0) {
        // 关键修复：把 offlineQueue 的 op 追加到 opsToMergeOnAck
        // 服务端处理 op 后不广播回发送者
        // 但 join-whiteboard-ack 会带老的服务端状态到达
        // ack 处理器用这个列表把"自己的离线改动"叠加到服务端状态上
        // 这样本地不会回退到断网前的老位置
        // 关键修复 v2：用 push 而不是赋值，保留之前未消费的 op（极端情况：
        // 上一次重连 ack 未到达就再次断网，本次重连的 opsToMergeOnAck
        // 应当累积而不是覆盖）
        opsToMergeOnAck.current.push(...offlineQueue.current)
        const queue = [...offlineQueue.current]
        offlineQueue.current = []
        console.log(`[useSocketCollab] 重连后补发 ${queue.length} 条离线 op`)
        for (const op of queue) {
          pendingClientOpIds.current.add(op.clientOpId)
          socket.emit('element-op', op)
        }
        toast.success(`已同步 ${queue.length} 条离线操作`)
      }
      // 注意：这里不清空 opsToMergeOnAck。
      // 之前如果 isWaitingForAck 已经是 true（例如上一次重连 ack 没来就又断网），
      // opsToMergeOnAck 里可能还有未消费的 op，保留它们以便本次 ack 一起合并。
    })

    socket.on('disconnect', (reason: string) => {
      setConnectionStatus('disconnected')
      // 关键修复 v2：断开时清空"等待 ack"标志
      // 防止下次连接时残留错误状态
      isWaitingForAck.current = false
      // 关键修复：断开时给用户提示（仅非主动断开）
      if (reason !== 'io client disconnect') {
        toast.warning('网络已断开，操作将在恢复后自动同步')
      }
    })

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message)
      setConnectionStatus('disconnected')
    })

    // ========== 白板事件 ==========
    socket.on(
      'join-whiteboard-ack',
      (payload: { elements: CanvasElement[]; onlineUsers: OnlineUser[]; version: number }) => {
        // 关键修复 v2：退出"等待 ack"窗口
        isWaitingForAck.current = false
        // 关键修复（位置错乱 bug）：如果当前有离线 op 待合并，
        // 不能直接用 serverState 覆盖本地，否则会丢失自己的离线改动。
        // 正确做法：先在 serverState 基础上应用 opsToMergeOnAck 中的 op，
        // 再 setElements。
        let elements = payload.elements || []
        if (opsToMergeOnAck.current.length > 0) {
          const ops = [...opsToMergeOnAck.current]
          opsToMergeOnAck.current = []
          console.log(`[useSocketCollab] 合并 ${ops.length} 条离线 op 到服务端状态`)
          elements = mergeOpsIntoElements(elements, ops)
        }
        canvasStore.setElements(elements)
        setOnlineUsers(payload.onlineUsers || [])
      }
    )

    socket.on('online-users', (users: OnlineUser[]) => {
      setOnlineUsers(users)
    })

    socket.on('element-op', (op: ServerOp) => {
      // 去重：如果是我们自己发的（被服务端回传），不重复应用
      if (op.clientOpId && pendingClientOpIds.current.has(op.clientOpId)) {
        pendingClientOpIds.current.delete(op.clientOpId)
        return
      }
      // 远端 op：应用到本地 store
      useCanvasStore.getState()._applyRemoteOp(op)
    })

    socket.on(
      'cursor-move',
      (_payload: { userId: string; x: number; y: number }) => {
        // 6.1 范围内仅占位（不实现光标渲染，但保留接口）
      }
    )

    socket.on('error', (err: { code: string; message: string }) => {
      console.warn('Socket error:', err)
    })

    // ========== 清理 ==========
    return () => {
      // 主动离开白板 + 断开 socket
      if (socket.connected) {
        socket.emit('leave-whiteboard', { whiteboardId })
      }
      socket.disconnect()
      socketRef.current = null

      // 清除上行 op 广播回调（避免下次 mount 之前 store 仍持有旧引用）
      useCanvasStore.getState().setBroadcastOp(null)

      // 清理节流定时器
      if (cursorTimerRef.current !== null) {
        clearTimeout(cursorTimerRef.current)
        cursorTimerRef.current = null
      }
      pendingCursorRef.current = null
      pendingClientOpIds.current.clear()
      // 关键修复：清理合并队列，防止下次 mount 时把上次未消费的 op 误合并
      opsToMergeOnAck.current = []
      setOnlineUsers([])
    }
  }, [whiteboardId, token])

  return {
    connectionStatus,
    onlineUsers,
    sendCursorMove,
    currentUserId,
  }
}

/**
 * 关键修复：把离线 op 应用到服务端状态上
 *
 * 重连时 join-whiteboard-ack 带的服务端状态不包含我们的离线改动（因为 op 还在
 * 服务端持久化或正在持久化中，但未进入 ack 的 snapshot）。直接 setElements
 * 会丢失我们的离线改动，导致本地状态回退到断网前。
 *
 * 正确做法：把离线 op 按 opType 应用到服务端 elements 上。
 * 顺序：op 数组已按 FIFO 排列（因为 offlineQueue 是顺序 push 的）
 *
 * 与服务端 applyOpToElements 保持一致：
 * - add:  按 id 去重后追加
 * - update: 按 id 合并字段
 * - delete: 按 id 过滤
 * - clear-all: 清空
 */
function mergeOpsIntoElements(
  serverElements: CanvasElement[],
  ops: ClientOp[]
): CanvasElement[] {
  let elements = [...serverElements]

  for (const op of ops) {
    switch (op.opType) {
      case 'add': {
        const incoming = (op.payload as { element?: CanvasElement })?.element
        if (!incoming?.id) break
        // 防御：去重（按 id）
        if (elements.some((e) => e.id === incoming.id)) break
        elements = [...elements, incoming]
        break
      }
      case 'update': {
        const { id, updates } = (op.payload as { id?: string; updates?: Partial<CanvasElement> }) ?? {}
        if (!id) break
        elements = elements.map((e) =>
          e.id === id ? { ...e, ...(updates ?? {}), id } : e
        )
        break
      }
      case 'delete': {
        const { id } = (op.payload as { id?: string }) ?? {}
        if (!id) break
        elements = elements.filter((e) => e.id !== id)
        break
      }
      case 'clear-all': {
        elements = []
        break
      }
    }
  }

  return elements
}
