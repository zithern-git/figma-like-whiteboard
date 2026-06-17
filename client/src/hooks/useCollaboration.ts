/**
 * 协作 Hook (useCollaboration)
 *
 * Phase 6.3 — 实时协作客户端（OT 时代升级）
 *
 * 职责：
 * 1. 加入/离开白板：发送 join-whiteboard / leave-whiteboard
 * 2. 接收远程操作：调用 canvasStore 更新本地元素，触发脏矩形标记
 * 3. 发送本地操作：节流 16ms（rAF）批量发送，携带 baseVersion 和 lamportClock
 * 4. 节流光标位置发送（50ms throttle）
 * 5. 断线重连后自动同步增量操作（基于 lastOperationTimestamp）
 *
 * 协议字段扩展（相对 6.1）：
 * - 客户端 op 增加 baseVersion / lamportClock / prevOpId
 * - 服务端返回 serverVersion / transformed
 * - 重连时携带 lastServerVersion 请求增量回放
 *
 * 与 useSocketCollab 的关系：
 * - useSocketCollab 仍然负责底层 socket 连接和 6.1 简单广播
 * - useCollaboration 是更高级的封装（OT 感知），建议新代码使用
 * - 两个 hook 可以共存（同一连接）；后续可统一为 useCollaboration
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { socketService, ConnectionStatus } from '@/services/socket'
import { useCanvasStore, ClientOp, ServerOp } from '@/stores/canvasStore'
import { CanvasElement } from '@/canvas/CanvasElement'
import { useAuthStore } from '@/stores/authStore'
import { DirtyRectManager } from '@/canvas/DirtyRectManager'
import { nanoid } from 'nanoid'

// ========== 常量 ==========

/** 光标节流（50ms） */
const CURSOR_THROTTLE_MS = 50
/** 用户颜色调色板（与 OnlineUsers 共享） */
export const USER_COLOR_PALETTE = [
  '#EF4444', // red
  '#F59E0B', // amber
  '#10B981', // emerald
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#84CC16', // lime
]

/** 在线用户展示信息 */
export interface OnlineUser {
  userId: string
  name: string
  color: string
}

/** 远端光标位置 */
export interface RemoteCursor {
  userId: string
  name: string
  color: string
  x: number
  y: number
  /** 渲染时间戳（用于淡出） */
  lastUpdate: number
}

/** Hook 返回值 */
export interface UseCollaborationReturn {
  /** 当前连接状态 */
  connectionStatus: ConnectionStatus
  /** 在线用户列表 */
  onlineUsers: OnlineUser[]
  /** 远端光标列表（按 userId 索引） */
  remoteCursors: Map<string, RemoteCursor>
  /** 发送光标位置（50ms 节流） */
  sendCursorMove: (x: number, y: number) => void
  /** 发送本地 op（带 OT 字段，rAF 节流批量） */
  broadcastOp: (op: Omit<ClientOp, 'clientOpId' | 'timestamp'>) => void
  /** 当前白板 serverVersion（用于 baseVersion 计算） */
  baseVersion: number
  /** 当前 Lamport 时钟值（用于 op 携带） */
  lamportClock: number
  /** 当前用户 userId */
  currentUserId: string
}

// ========== 共享 Lamport 时钟（单 whiteboardId 一个） ==========

/** 全局 Lamport 时钟表（按 whiteboardId 维护） */
const lamportClocks = new Map<string, number>()
function tickLamportClock(whiteboardId: string, remote?: number): number {
  const current = lamportClocks.get(whiteboardId) ?? 0
  if (remote !== undefined && remote > current) {
    lamportClocks.set(whiteboardId, remote + 1)
    return remote + 1
  }
  lamportClocks.set(whiteboardId, current + 1)
  return current + 1
}

// ========== 给 userId 分配稳定颜色 ==========

const colorByUserId = new Map<string, string>()
export function getUserColor(userId: string): string {
  let c = colorByUserId.get(userId)
  if (!c) {
    // 用 userId 哈希取调色板下标（保证同一用户颜色稳定）
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) | 0
    }
    const idx = Math.abs(hash) % USER_COLOR_PALETTE.length
    c = USER_COLOR_PALETTE[idx]
    colorByUserId.set(userId, c)
  }
  return c
}

// ========== Hook 主实现 ==========

export function useCollaboration(whiteboardId: string | null): UseCollaborationReturn {
  const token = useAuthStore((s) => s.token)
  const currentUserId = useAuthStore((s) => s.user?.id || '')

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    socketService.getStatus()
  )
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map())

  /** 已知白板 serverVersion（用于 baseVersion 计算） */
  const baseVersionRef = useRef<number>(0)
  /** 已知白板 Lamport 时钟 */
  const lamportClockRef = useRef<number>(0)
  /** 待去重 clientOpId 集合（自己发的 op，服务端广播回传时去除） */
  const pendingClientOpIds = useRef<Set<string>>(new Set())

  /** 待发送 op 队列（rAF 节流批量） */
  const pendingOpsRef = useRef<ClientOp[]>([])
  const rafIdRef = useRef<number | null>(null)

  /** 光标节流相关 */
  const lastCursorSendRef = useRef<number>(0)
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null)
  const cursorTimerRef = useRef<number | null>(null)

  /** 远端光标过期清理定时器 */
  const cursorCleanupTimerRef = useRef<number | null>(null)

  /** 暴露给外部的脏矩形管理器引用（由 Canvas 组件注入） */
  const dirtyRectManagerRef = useRef<DirtyRectManager | null>(null)

  // ========== 脏矩形标记辅助 ==========

  const markElementDirty = useCallback((element: CanvasElement | undefined) => {
    if (!element) return
    const mgr = dirtyRectManagerRef.current
    if (!mgr) return
    mgr.markDirty({
      x: (element.x ?? 0) - 5,
      y: (element.y ?? 0) - 5,
      width: (element.width ?? 0) + 10,
      height: (element.height ?? 0) + 10,
    })
  }, [])

  /** 注入脏矩形管理器（由 Canvas 组件在 mount 后调用） */
  const setDirtyRectManager = useCallback((mgr: DirtyRectManager | null) => {
    dirtyRectManagerRef.current = mgr
  }, [])

  // ========== op 发送（rAF 节流批量） ==========

  /**
   * 实际发送函数：从队列中取所有 op 一次性发出
   */
  const flushOps = useCallback(() => {
    rafIdRef.current = null
    if (pendingOpsRef.current.length === 0) return
    const ops = pendingOpsRef.current
    pendingOpsRef.current = []
    // 一次性发出（Socket.IO 单帧多个事件）
    for (const op of ops) {
      socketService.emit('element-op', op)
    }
  }, [])

  /**
   * 公开 API：广播本地 op
   *
   * 内部会：
   * 1. 补充 clientOpId / timestamp
   * 2. 携带 baseVersion / lamportClock
   * 3. 加入待发队列（rAF 批量）
   */
  const broadcastOp = useCallback(
    (op: Omit<ClientOp, 'clientOpId' | 'timestamp'>) => {
      if (!whiteboardId) return
      const clientOpId = nanoid()
      pendingClientOpIds.current.add(clientOpId)
      const fullOp: ClientOp = {
        ...op,
        clientOpId,
        timestamp: Date.now(),
        // OT 字段：携带当前 baseVersion 和 Lamport 时钟
        baseVersion: baseVersionRef.current,
        lamportClock: tickLamportClock(whiteboardId),
        whiteboardId,
      } as ClientOp
      pendingOpsRef.current.push(fullOp)
      // rAF 批量发送
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushOps)
      }
    },
    [whiteboardId, flushOps]
  )

  // ========== 光标发送（50ms 节流） ==========

  const flushCursor = useCallback(() => {
    cursorTimerRef.current = null
    if (!pendingCursorRef.current) return
    socketService.emit('cursor-move', pendingCursorRef.current)
    pendingCursorRef.current = null
  }, [])

  const sendCursorMove = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      const elapsed = now - lastCursorSendRef.current
      if (elapsed >= CURSOR_THROTTLE_MS) {
        lastCursorSendRef.current = now
        socketService.emit('cursor-move', { x, y })
      } else {
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

  // ========== 远端光标过期清理 ==========

  useEffect(() => {
    cursorCleanupTimerRef.current = window.setInterval(() => {
      const now = Date.now()
      setRemoteCursors((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [userId, cursor] of next) {
          if (now - cursor.lastUpdate > 5000) {
            // 5s 没更新则移除
            next.delete(userId)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => {
      if (cursorCleanupTimerRef.current !== null) {
        clearInterval(cursorCleanupTimerRef.current)
      }
    }
  }, [])

  // ========== 主连接 + 事件订阅 effect ==========

  useEffect(() => {
    if (!whiteboardId || !token) {
      setConnectionStatus('disconnected')
      return
    }

    // 1. 确保 socket 已连接
    socketService.connect({ token })
    setConnectionStatus(socketService.getStatus())

    // 2. 订阅状态变化
    const offStatus = socketService.onStatusChange((status) => {
      setConnectionStatus(status)
      if (status === 'connected') {
        // 重连成功：发送 join（带 lastServerVersion 触发增量同步）
        socketService.emit('join-whiteboard', {
          whiteboardId,
          lastServerVersion: baseVersionRef.current,
        })
      }
    })

    // 3. 注入 broadcastOp 到 canvasStore
    const canvasStore = useCanvasStore.getState()
    canvasStore.setBroadcastOp((op: ClientOp) => {
      broadcastOp(op)
    })

    // 4. 业务事件订阅
    const unsubs: Array<() => void> = []

    unsubs.push(
      socketService.on<{
        elements: CanvasElement[]
        onlineUsers: OnlineUser[]
        version: number
        lamportClock?: number
        isIncremental?: boolean
      }>('join-whiteboard-ack', (payload) => {
        if (payload.isIncremental) {
          // 增量恢复：payload.elements 是 lastServerVersion 之后新增/修改的元素
          // 直接 apply 到本地 store（合并而非替换）
          for (const el of payload.elements || []) {
            canvasStore._applyRemoteOp({
              clientOpId: `incremental-${el.id}-${Date.now()}`,
              opType: 'add',
              payload: { element: el },
              timestamp: Date.now(),
              userId: 'server',
              // 关键修复：补全我之前加的 whiteboardId 必填字段。
              // 这个 useCollaboration 路径在代码里没被实际使用（useSocketCollab 是主路径），
              // 但 TS 类型要求必须传。
              whiteboardId: whiteboardId ?? '',
            })
          }
        } else {
          // 全量初始化
          canvasStore.setElements(payload.elements || [])
        }
        setOnlineUsers(payload.onlineUsers || [])
        baseVersionRef.current = payload.version ?? 0
        if (payload.lamportClock !== undefined) {
          lamportClockRef.current = payload.lamportClock
        }
      })
    )

    unsubs.push(
      socketService.on<OnlineUser[]>('online-users', (users) => {
        setOnlineUsers(users)
      })
    )

    unsubs.push(
      socketService.on<ServerOp & { transformed?: boolean }>('element-op', (op) => {
        // 去重自己发的 op 回传
        if (op.clientOpId && pendingClientOpIds.current.has(op.clientOpId)) {
          pendingClientOpIds.current.delete(op.clientOpId)
          // 同步 serverVersion（如果服务端在 op 中带）
          if ((op as any).serverVersion !== undefined) {
            baseVersionRef.current = (op as any).serverVersion
          }
          // 同步 Lamport 时钟
          if ((op as any).lamportClock !== undefined && whiteboardId) {
            tickLamportClock(whiteboardId, (op as any).lamportClock)
          }
          return
        }
        // 同步服务端版本号
        if ((op as any).serverVersion !== undefined) {
          baseVersionRef.current = (op as any).serverVersion
        }
        // 同步 Lamport 时钟
        if ((op as any).lamportClock !== undefined && whiteboardId) {
          tickLamportClock(whiteboardId, (op as any).lamportClock)
        }
        // 远端 op：取变更前/后的 element 标记脏矩形
        const before = useCanvasStore.getState()._getElementRaw(op.payload?.id ?? '')
        if (op.opType === 'update' && before) {
          markElementDirty(before)
        }
        // 应用 op 到本地 store
        useCanvasStore.getState()._applyRemoteOp(op)
        // 应用后再次标记
        if (op.opType === 'update') {
          const after = useCanvasStore.getState()._getElementRaw(op.payload?.id ?? '')
          markElementDirty(after)
        } else if (op.opType === 'add') {
          const el = op.payload?.element
          if (el) markElementDirty(el)
        } else if (op.opType === 'delete' && before) {
          markElementDirty(before)
        }
      })
    )

    unsubs.push(
      socketService.on<{
        userId: string
        x: number
        y: number
        name?: string
        color?: string
      }>('cursor-move', (payload) => {
        if (payload.userId === currentUserId) return
        setRemoteCursors((prev) => {
          const next = new Map(prev)
          const existing = next.get(payload.userId)
          next.set(payload.userId, {
            userId: payload.userId,
            name: existing?.name || payload.name || 'User',
            color: existing?.color || payload.color || getUserColor(payload.userId),
            x: payload.x,
            y: payload.y,
            lastUpdate: Date.now(),
          })
          return next
        })
      })
    )

    unsubs.push(
      socketService.on<{ code: string; message: string }>('error', (err) => {
        console.warn('[useCollaboration] socket error:', err)
      })
    )

    // 服务端 op 丢弃通知（OT 阶段扩展）
    unsubs.push(
      socketService.on<{
        opId: string
        clientOpId: string
        reason: string
      }>('element-op-dropped', (payload) => {
        // 移除自己的 pending clientOpId
        if (pendingClientOpIds.current.has(payload.clientOpId)) {
          pendingClientOpIds.current.delete(payload.clientOpId)
        }
        console.info('[useCollaboration] op dropped:', payload)
      })
    )

    // 5. 首次进入主动 join
    if (socketService.getStatus() === 'connected') {
      socketService.emit('join-whiteboard', {
        whiteboardId,
        lastServerVersion: 0, // 首次进入：0 → 全量
      })
    }

    // ========== 清理 ==========
    return () => {
      offStatus()
      unsubs.forEach((u) => u())
      if (socketService.getStatus() === 'connected') {
        socketService.emit('leave-whiteboard', { whiteboardId })
      }
      useCanvasStore.getState().setBroadcastOp(null)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      if (cursorTimerRef.current !== null) {
        clearTimeout(cursorTimerRef.current)
        cursorTimerRef.current = null
      }
      pendingClientOpIds.current.clear()
      pendingOpsRef.current = []
      setRemoteCursors(new Map())
      setOnlineUsers([])
    }
  }, [whiteboardId, token, currentUserId, broadcastOp, markElementDirty])

  return useMemo(
    () => ({
      connectionStatus,
      onlineUsers,
      remoteCursors,
      sendCursorMove,
      broadcastOp,
      baseVersion: baseVersionRef.current,
      lamportClock: lamportClockRef.current,
      currentUserId,
      setDirtyRectManager,
    }),
    [
      connectionStatus,
      onlineUsers,
      remoteCursors,
      sendCursorMove,
      broadcastOp,
      currentUserId,
      setDirtyRectManager,
    ]
  )
}
