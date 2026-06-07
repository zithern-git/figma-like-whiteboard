import dotenv from 'dotenv'
dotenv.config()

import { httpServer } from './app'
import connectDB from './config/db'
import redisClient, { InMemoryRedis } from './config/redis'
import { RedisClientType } from 'redis'

const PORT = process.env.PORT || 3001

const start = async (): Promise<void> => {
  try {
    await connectDB()
    try {
      await redisClient.connect()
    } catch (redisErr) {
      console.warn('Redis connection failed, switching to in-memory mock')
      const mockClient = new InMemoryRedis() as unknown as RedisClientType
      Object.assign(redisClient, mockClient)
    }

    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully')
  try {
    await redisClient.quit()
  } catch {
    // ignore
  }
  httpServer.close(() => {
    process.exit(0)
  })
})
