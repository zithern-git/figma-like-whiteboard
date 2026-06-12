/**
 * Redis 客户端配置
 *
 * 三个 Redis 客户端：
 * 1. `redisClient` — 主客户端，用于缓存 / 状态 / 会话 / 在线用户等常规 KV
 * 2. `pubClient` + `subClient` — Socket.IO Redis Adapter 专用（pub/sub 必须分开）
 *
 * 设计要点：
 * - 所有客户端都通过 REDIS_URL 同一个 Redis 实例
 * - 主客户端断线时自动降级为 InMemoryRedis（保证单实例 / 开发环境不挂）
 * - pub/sub 客户端断线时 Socket.IO Adapter 退化为单进程广播
 * - 6.2 阶段 InMemoryRedis 已被替换为真正的 Redis（修复 6.1 简化实现）
 */

import { createClient, RedisClientType } from 'redis'

// ========== 内存 mock（当真实 Redis 不可用时使用） ==========

export class InMemoryRedisAdapter {
  private store = new Map<string, unknown>()

  async connect(): Promise<void> { /* no-op */ }
  async quit(): Promise<void> { /* no-op */ }

  async get(key: string): Promise<string | null> {
    return (this.store.get(key) as string | null) ?? null
  }

  async set(key: string, value: unknown, opts?: { EX?: number }): Promise<string> {
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
    const set = (this.store.get(key) as Set<string>) || new Set<string>()
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

// ========== 创建真实 Redis 客户端 ==========

let realClientConnected = false
let realPubConnected = false
let realSubConnected = false

function createRedisClient(label: string): RedisClientType {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          console.warn(`[Redis:${label}] max reconnection attempts reached, falling back`)
          return false
        }
        return Math.min(retries * 100, 2000)
      },
    },
  })

  client.on('error', (err) => {
    console.warn(`[Redis:${label}] error (non-critical):`, err.message)
  })

  client.on('connect', () => {
    if (label === 'main') realClientConnected = true
    if (label === 'pub') realPubConnected = true
    if (label === 'sub') realSubConnected = true
    console.log(`[Redis:${label}] connected`)
  })

  return client
}

export const redisClient: RedisClientType = createRedisClient('main')
export const pubClient: RedisClientType = createRedisClient('pub')
export const subClient: RedisClientType = createRedisClient('sub')

/** 启动时尝试连接真实 Redis，失败降级为 InMemoryRedis */
export async function initRedis(): Promise<{
  main: RedisClientType | InMemoryRedisAdapter
  pub: RedisClientType | InMemoryRedisAdapter
  sub: RedisClientType | InMemoryRedisAdapter
}> {
  const tryConnect = async (
    client: RedisClientType,
    label: string
  ): Promise<RedisClientType | InMemoryRedisAdapter> => {
    try {
      await client.connect()
      return client
    } catch (err) {
      console.warn(
        `[Redis:${label}] real Redis unavailable, using in-memory fallback (multi-instance broadcast disabled)`,
        (err as Error).message
      )
      return new InMemoryRedisAdapter()
    }
  }

  const main = await tryConnect(redisClient, 'main')
  const pub = await tryConnect(pubClient, 'pub')
  const sub = await tryConnect(subClient, 'sub')
  return { main, pub, sub }
}

/** 关闭所有 Redis 连接（用于 graceful shutdown） */
export async function closeRedis(): Promise<void> {
  await Promise.allSettled([
    redisClient.isOpen ? redisClient.quit() : Promise.resolve(),
    pubClient.isOpen ? pubClient.quit() : Promise.resolve(),
    subClient.isOpen ? subClient.quit() : Promise.resolve(),
  ])
}

// 保留旧名导出（兼容 onlineUsers.ts 旧引用）
// 内部类已重命名为 InMemoryRedisAdapter（旧名 InMemoryRedis 类的方法在 6.2 升级为更完整的 InMemoryRedisAdapter）
export const InMemoryRedis = InMemoryRedisAdapter
export default redisClient
