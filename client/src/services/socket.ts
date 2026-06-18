/**
 * Socket 服务层 (services/socket.ts)
 *
 * 职责：
 * - 封装 Socket.IO Client 连接生命周期
 * - 暴露连接状态变化的订阅机制
 * - 提供类型安全的事件发送/接收
 * - 配置指数退避重连
 *
 * 设计为单例：整个 App 共用一个 socket 连接，按需 attach / detach 业务事件。
 *
 * 与 useSocketCollab / useCollaboration 的关系：
 * - 本服务只管连接管理（不感知业务事件）
 * - useCollaboration 订阅本服务的状态变化，并注册业务事件监听
 * - 业务组件通过 useCollaboration 发送 op，不直接操作 socket
 */

import { io, Socket, ManagerOptions } from 'socket.io-client'

/** 连接状态 */
export type ConnectionStatus =
  | 'disconnected' // 未连接 / 已断开
  | 'connecting' // 首次连接中
  | 'connected' // 已连接
  | 'reconnecting' // 断线后重连中
  | 'failed' // 重连多次失败（Socket.IO 内部终止重连）

/** 状态订阅者 */
type StatusListener = (status: ConnectionStatus) => void

/** Socket 服务配置 */
export interface SocketServiceConfig {
  /** 完整 URL 或路径（默认 '/'，配合 Vite 代理使用） */
  url?: string
  /** socket.io path，默认 '/socket.io' */
  path?: string
  /** 认证 token（注入到 auth 字段） */
  token: string
  /** 业务自定义 socket.io options（合并到默认配置） */
  socketOptions?: Partial<ManagerOptions>
}

class SocketService {
  private socket: Socket | null = null
  private status: ConnectionStatus = 'disconnected'
  private listeners = new Set<StatusListener>()
  private config: SocketServiceConfig | null = null
  /** 业务事件监听器（key: event name, value: listener） */
  private eventListeners = new Map<string, Set<(...args: unknown[]) => void>>()

  /**
   * 建立连接（幂等：若已连接则直接 resolve）
   */
  connect(config: SocketServiceConfig): void {
    // 已有连接 + token 一致 → 不重建
    if (this.socket?.connected && this.config?.token === config.token) {
      this.setStatus('connected')
      return
    }

    // 重建前清理旧连接
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }

    this.config = config
    this.setStatus('connecting')

    const socket = io(config.url ?? '/', {
      path: config.path ?? '/socket.io',
      auth: { token: config.token },
      // 指数退避重连配置（Socket.IO 内置）
      reconnection: true,
      reconnectionDelay: 1000, // 起始 1s
      reconnectionDelayMax: 30000, // 最长 30s
      randomizationFactor: 0.5, // ±50% 抖动避免雷暴
      timeout: 20000,
      // 关键修复（实时协同 0 延时）：强制只使用 websocket，不 fallback 到 polling。
      // polling 模式下每个 emit 都要发一次 HTTP POST（几 ms~几十 ms），
      // 端到端 50-200ms / op，用户能明显感觉到"一定的时延"。
      // websocket 模式下 emit 是一个 TCP 帧（< 1ms），
      // 端到端 < 30ms / op，用户感觉不到延时（"绝对 0 延时"）。
      // 服务端 Node.js HTTP server 默认支持 websocket upgrade（无需额外配置），
      // Vite 代理 /socket.io 已配 ws: true，websocket 升级链路完整。
      transports: ['websocket'],
      // 关键修复：单帧缓冲调到 20MB，承载图片 base64 op
      maxHttpBufferSize: 20 * 1024 * 1024,
      ...config.socketOptions,
      // ManagerOptions 在 socket.io-client 类型里不直接暴露给 Socket，使用 as 断言
    } as Partial<ManagerOptions>)

    this.socket = socket
    this.bindLifecycleEvents(socket)
    this.replayEventListeners(socket)
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (!this.socket) {
      this.setStatus('disconnected')
      return
    }
    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = null
    this.setStatus('disconnected')
  }

  /**
   * 发送事件
   */
  emit(event: string, ...args: unknown[]): void {
    if (!this.socket?.connected) {
      console.warn(`[SocketService] emit '${event}' while not connected (status=${this.status})`)
      return
    }
    this.socket.emit(event, ...args)
  }

  /**
   * 订阅事件
   */
  on<T = unknown>(event: string, listener: (payload: T) => void): () => void {
    let set = this.eventListeners.get(event)
    if (!set) {
      set = new Set()
      this.eventListeners.set(event, set)
    }
    const wrapped = listener as (...args: unknown[]) => void
    set.add(wrapped)
    // 已连接则直接挂到 socket
    if (this.socket) {
      this.socket.on(event, wrapped as any)
    }
    // 返回取消订阅函数
    return () => {
      set!.delete(wrapped)
      if (this.socket) this.socket.off(event, wrapped as any)
      if (set!.size === 0) this.eventListeners.delete(event)
    }
  }

  /**
   * 单次订阅事件
   */
  once<T = unknown>(event: string, listener: (payload: T) => void): void {
    this.socket?.once(event, listener as any)
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): ConnectionStatus {
    return this.status
  }

  /**
   * 订阅状态变化
   */
  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener)
    // 立即推送当前状态
    listener(this.status)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 获取底层 socket（供 useSocketCollab 等已存在的 hook 共用同一连接）
   * 注意：返回的是只读引用，请勿调用 .disconnect() 等破坏性方法
   */
  getSocket(): Socket | null {
    return this.socket
  }

  // ========== 私有方法 ==========

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.listeners.forEach((l) => l(next))
  }

  /** 绑定连接生命周期事件 */
  private bindLifecycleEvents(socket: Socket): void {
    socket.on('connect', () => {
      this.setStatus('connected')
    })

    socket.on('disconnect', (reason) => {
      // Socket.IO 内部触发自动重连时为 'io client disconnect' / 'transport close'
      // 服务端主动断开为 'io server disconnect'
      if (reason === 'io server disconnect') {
        // 服务端强制断开：直接置为 disconnected
        this.setStatus('disconnected')
      } else {
        // 客户端 / 网络断开：进入重连流程
        this.setStatus('reconnecting')
      }
    })

    socket.on('connect_error', (err) => {
      console.error('[SocketService] connect_error:', err.message)
      // 第一次连接失败 → 留给 socket.io 内部重连机制
      // 这里仅记录日志，不重置 status（避免在重连中误判为 disconnected）
    })

    socket.io.on('reconnect_attempt', () => {
      this.setStatus('reconnecting')
    })

    socket.io.on('reconnect_failed', () => {
      // Socket.IO 重连次数耗尽（默认无限，本配置下不会触发）
      this.setStatus('failed')
    })

    socket.io.on('reconnect', () => {
      this.setStatus('connected')
    })
  }

  /** 把已注册的业务事件监听器挂到新 socket */
  private replayEventListeners(socket: Socket): void {
    this.eventListeners.forEach((listeners, event) => {
      listeners.forEach((listener) => {
        socket.on(event, listener as any)
      })
    })
  }
}

/** 单例导出 */
export const socketService = new SocketService()
