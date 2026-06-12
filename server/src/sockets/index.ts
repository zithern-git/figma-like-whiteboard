/**
 * Socket.IO 服务初始化 (sockets/index.ts)
 *
 * 职责：
 * - 创建 Socket.IO Server（绑定 HTTP server）
 * - 配置 CORS / buffer / 传输方式
 * - 注册 JWT 认证中间件（auth.ts）
 * - 注册白板协作事件（whiteboardHandler）
 * - **挂载 Redis Adapter**（多实例广播）
 * - 暴露 getIO() 单例访问
 *
 * 6.2 升级：
 * - @socket.io/redis-adapter 允许多个 server 实例共享房间广播
 * - 真实 Redis 不可用时降级为单进程广播（仅 fallback）
 */

import { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import jwt from 'jsonwebtoken'
import User from '../models/User'
import { pubClient, subClient } from '../config/redis'
import { registerWhiteboardHandlers } from './whiteboardHandler'

let io: Server

export const initializeSocket = async (server: HttpServer): Promise<Server> => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // 关键修复：图片以 base64 dataURL 存储在 element 中，单张图可能 1~5MB，
    // 默认 1MB 缓冲区会被 Socket.IO 静默丢弃。调到 20MB 兜底。
    maxHttpBufferSize: 20 * 1024 * 1024,
  })

  // ========== 挂载 Redis Adapter（多实例广播） ==========
  // pubClient 用于发布，subClient 用于订阅（必须分开）
  // 真实 Redis 不可用时跳过（fallback 到单进程广播）
  try {
    if (pubClient.isOpen && subClient.isOpen) {
      io.adapter(createAdapter(pubClient, subClient))
      console.log('[Socket.IO] Redis adapter attached — multi-instance broadcast enabled')
    } else {
      console.warn(
        '[Socket.IO] Redis pub/sub clients not connected, skipping Redis adapter (single-process mode)'
      )
    }
  } catch (err) {
    console.warn(
      '[Socket.IO] Failed to attach Redis adapter, falling back to single-process:',
      (err as Error).message
    )
  }

  // ========== JWT 认证中间件 ==========
  // 验证 token + 查询用户信息（name）一并写入 socket.data
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) {
        return next(new Error('Authentication required'))
      }

      const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
      const decoded = jwt.verify(token, secret) as { userId: string; email: string }

      // 查用户信息（用于显示用户名）
      const user = await User.findById(decoded.userId).select('name email').lean()
      socket.data.userId = decoded.userId
      socket.data.email = decoded.email
      socket.data.name = user?.name || decoded.email.split('@')[0] || 'Anonymous'
      next()
    } catch (err) {
      next(new Error('Invalid token'))
    }
  })

  // ========== connection 事件：注册所有 handler ==========
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.data.userId} (${socket.data.name})`)

    // 注册白板协作事件
    registerWhiteboardHandlers(io, socket)

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.data.userId}`)
    })
  })

  return io
}

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO not initialized')
  }
  return io
}
