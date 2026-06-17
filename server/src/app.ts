/**
 * Express 应用入口 (app)
 *
 * 关键修复（Phase 7）：
 * - 404 handler 走 notFoundHandler（通过 next(err) 触发 errorHandler）
 * - JSON 解析失败（payload too large / 格式错误）转 AppError
 * - 统一错误处理（errorHandler）挂载在所有路由之后
 */

import cors from 'cors'
import express, { NextFunction, Request, Response } from 'express'
import { createServer } from 'http'
import path from 'path'
import {
  AppError,
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler'
import authRoutes from './routes/authRoutes'
import whiteboardRoutes from './routes/whiteboardRoutes'
import snapshotRoutes from './routes/snapshotRoutes'
import uploadRoutes from './routes/uploadRoutes'
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

// 关键修复：body-parser 错误转 AppError（如 payload too large / JSON 格式错）
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
    return next(
      new AppError(
        'BAD_REQUEST',
        err.type === 'entity.too.large' ? 'Request body too large' : 'Invalid JSON body',
        err.status || 400
      )
    )
  }
  next(err)
})

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Server is running' })
})

app.use('/api/auth', authRoutes)
app.use('/api/whiteboards', whiteboardRoutes)
app.use('/api/whiteboards', snapshotRoutes)
app.use('/api/upload', uploadRoutes)

// 静态文件服务：上传的图片通过 /uploads/* 访问
// 路径在 server/public/uploads/，与 uploadRoutes.UPLOAD_DIR 对应
app.use(
  '/uploads',
  express.static(path.resolve(__dirname, '../public/uploads'), {
    maxAge: '7d', // 浏览器缓存 7 天
    setHeaders: (res) => {
      // 允许跨域读取（图片资源）
      res.setHeader('Access-Control-Allow-Origin', '*')
    },
  })
)

// 404 handler：所有路由未匹配时触发
app.use(notFoundHandler)

// 统一错误处理：必须放在最后，且是 4 参数签名
app.use(errorHandler)

export { app, httpServer }
