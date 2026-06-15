import dotenv from 'dotenv'
dotenv.config()

import { httpServer } from './app'
import connectDB from './config/db'
import { initRedis, closeRedis, setActiveRedisClient } from './config/redis'
import { startSnapshotService } from './services/snapshotService'

const PORT = process.env.PORT || 3001

const start = async (): Promise<void> => {
  try {
    await connectDB()
    // 初始化 Redis（多客户端：main / pub / sub，失败时降级为内存）
    const { main } = await initRedis()
    // 将可用的 Redis 客户端设为全局 active，供 onlineUsers 等模块使用
    setActiveRedisClient(main)

    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })

    // 启动定时快照服务（每 10 分钟生成一次白板快照）
    startSnapshotService()
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully')
  try {
    await closeRedis()
  } catch {
    // ignore
  }
  httpServer.close(() => {
    process.exit(0)
  })
})

