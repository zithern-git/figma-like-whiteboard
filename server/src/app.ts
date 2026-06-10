import cors from 'cors'
import express from 'express'
import { createServer } from 'http'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/authRoutes'
import whiteboardRoutes from './routes/whiteboardRoutes'
import { initializeSocket } from './sockets'

const app = express()
const httpServer = createServer(app)

// 初始化 Socket.IO（统一在 sockets 模块中创建 + 注册 handler）
initializeSocket(httpServer)

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Server is running' })
})

app.use('/api/auth', authRoutes)
app.use('/api/whiteboards', whiteboardRoutes)

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
  })
})

app.use(errorHandler)

export { app, httpServer }
