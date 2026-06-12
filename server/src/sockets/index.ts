import { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import User from '../models/User'
import { registerWhiteboardHandlers } from './whiteboardHandler'

let io: Server

export const initializeSocket = (server: HttpServer): Server => {
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
