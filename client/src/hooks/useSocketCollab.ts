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
 * 6.1 简化：
 * - 不做客户端操作队列（断线时丢失的 op 不会补发）
 * - 不做 lastOperationTimestamp 增量恢复（重连后全量拉取）
 * - 重连：Socket.IO 自带指数退避 + 自动重连成功后自动重新 join
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useCanvasStore, ClientOp, ServerOp } from '@/stores/canvasStore'
import { CanvasElement } from '@/canvas/CanvasElement'
import { useAuthStore } from '@/stores/authStore'

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

    // Socket.IO 客户端配置：指数退避重连
    const socket = io(import.meta.env.VITE_API_BASE || 'http://localhost:3000', {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 20000,
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    // ========== 注入上行 op 广播回调到 store ==========
    const canvasStore = useCanvasStore.getState()
    canvasStore.setBroadcastOp((op: ClientOp) => {
      pendingClientOpIds.current.add(op.clientOpId)
      socket.emit('element-op', op)
    })

    // ========== 连接事件 ==========
    socket.on('connect', () => {
      setConnectionStatus('connected')
      // 重新加入白板
      socket.emit('join-whiteboard', { whiteboardId })
    })

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected')
    })

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message)
      setConnectionStatus('disconnected')
    })

    // ========== 白板事件 ==========
    socket.on(
      'join-whiteboard-ack',
      (payload: { elements: CanvasElement[]; onlineUsers: OnlineUser[]; version: number }) => {
        // 初始化本地 store（setElements 会清空 undo 栈，避免与服务端不一致）
        canvasStore.setElements(payload.elements || [])
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
        // 6.5 阶段会在 Canvas 上叠加远端光标
      }
    )

    socket.on('error', (err: { code: string; message: string }) => {
      console.warn('Socket error:', err)
      // 6.1 范围内仅 console.warn；未来可触发 toast
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
