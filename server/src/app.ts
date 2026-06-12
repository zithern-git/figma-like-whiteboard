import cors from 'cors'
import express from 'express'
import { createServer } from 'http'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/authRoutes'
import whiteboardRoutes from './routes/whiteboardRoutes'
import snapshotRoutes from './routes/snapshotRoutes'
import { initializeSocket } from './sockets'

const app = express()
const httpServer = createServer(app)

// 异步初始化 Socket.IO（挂载 Redis Adapter）
// 注意：initializeSocket 是 async，但这里不能 await（module 同步求值）
// 实际等待放在 index.ts 的 start() 流程里
initializeSocket(httpServer)
  .then(() => console.log('[Socket.IO] initialization completed'))
  .catch((err) =>
    console.error('[Socket.IO] initialization failed:', err)
  )

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
app.use('/api/whiteboards', snapshotRoutes)

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
  })
})

app.use(errorHandler)

export { app, httpServer }
