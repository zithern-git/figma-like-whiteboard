import { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'

let io: Server

export const initializeSocket = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth.token

    if (!token) {
      return next(new Error('Authentication required'))
    }

    try {
      const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
      const decoded = jwt.verify(token, secret) as { userId: string; email: string }
      socket.data.userId = decoded.userId
      socket.data.email = decoded.email
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.data.userId}`)

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