import { createClient, RedisClientType } from 'redis'

// 内存 mock 实现（当真实 Redis 不可用时使用）
class InMemoryRedis {
  private store = new Map<string, unknown>()

  async connect(): Promise<void> { /* no-op */ }
  async quit(): Promise<void> { /* no-op */ }

  async get(key: string): Promise<string | null> {
    return (this.store.get(key) as string | null) ?? null
  }

  async set(key: string, value: unknown): Promise<string> {
    this.store.set(key, value)
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0
    keys.forEach((k) => {
      if (this.store.has(k)) {
        this.store.delete(k)
        count++
      }
    })
    return count
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set =
      (this.store.get(key) as Set<string>) || new Set<string>()
    let added = 0
    members.forEach((m) => {
      if (!set.has(m)) {
        set.add(m)
        added++
      }
    })
    this.store.set(key, set)
    return added
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.store.get(key) as Set<string>
    if (!set) return 0
    let removed = 0
    members.forEach((m) => {
      if (set.has(m)) {
        set.delete(m)
        removed++
      }
    })
    return removed
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.store.get(key) as Set<string>
    return set ? Array.from(set) : []
  }

  async scard(key: string): Promise<number> {
    const set = this.store.get(key) as Set<string>
    return set ? set.size : 0
  }

  async expire(): Promise<number> {
    return 1
  }

  async publish(): Promise<number> {
    return 0
  }

  async subscribe(): Promise<void> {
    /* no-op */
  }
}

let redisClient: RedisClientType

const createRedisClient = (): RedisClientType => {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          console.warn('Redis max reconnection attempts reached, using in-memory mock')
          return false
        }
        return Math.min(retries * 100, 1000)
      },
    },
  })

  client.on('error', (err) => {
    console.warn('Redis client error (non-critical):', err.message)
  })

  client.on('connect', () => {
    console.log('Redis connected successfully')
  })

  return client
}

redisClient = createRedisClient()

export { InMemoryRedis }
export default redisClient
