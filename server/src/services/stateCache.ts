/**
 * Redis 白板状态缓存 (stateCache)
 *
 * 职责：
 * - 缓存白板的 elements 状态（避免每次 join 都查 MongoDB）
 * - TTL 5 分钟（写操作立即失效，单纯读则走缓存）
 * - 优先从 Redis 读取；miss 时回源 MongoDB 并回填
 *
 * Key 设计：
 * - `whiteboard:{shortId}:state` — JSON 序列化的 elements
 *
 * 写穿透：otService 写完 elements 后调用 setState() 同步缓存
 * 失效：clearState() 用于白板删除 / 强制重新加载
 */

import { getActiveRedisClient } from '../config/redis'
import Whiteboard, { CanvasElementShape } from '../models/Whiteboard'

const STATE_TTL_SECONDS = 5 * 60 // 5 分钟
const STATE_KEY = (shortId: string) => `whiteboard:${shortId}:state`

/**
 * 读取白板 state（优先 Redis）
 *
 * @returns { elements, version } | null
 */
export async function getState(
  shortId: string
): Promise<{ elements: CanvasElementShape[]; version: number } | null> {
  try {
    const redis = getActiveRedisClient()
    const raw = await redis.get(STATE_KEY(shortId))
    if (raw) {
      const parsed = JSON.parse(raw) as { elements: CanvasElementShape[]; version: number }
      return parsed
    }
  } catch (err) {
    console.warn('[stateCache] getState cache read failed:', (err as Error).message)
  }

  // miss：回源 MongoDB
  try {
    const whiteboard = await Whiteboard.findOne({ shortId, deleted: false }).lean()
    if (!whiteboard) return null
    const data = {
      elements: (whiteboard.elements as CanvasElementShape[]) ?? [],
      version: Date.now(),
    }
    // 回填缓存
    await setState(shortId, data.elements, data.version)
    return data
  } catch (err) {
    console.error('[stateCache] getState MongoDB fallback failed:', (err as Error).message)
    return null
  }
}

/**
 * 写入白板 state 缓存（写操作同步更新）
 */
export async function setState(
  shortId: string,
  elements: CanvasElementShape[],
  version?: number
): Promise<void> {
  try {
    const redis = getActiveRedisClient()
    const data = { elements, version: version ?? Date.now() }
    await redis.set(STATE_KEY(shortId), JSON.stringify(data), {
      EX: STATE_TTL_SECONDS,
    })
  } catch (err) {
    console.warn('[stateCache] setState failed:', (err as Error).message)
  }
}

/**
 * 清除白板 state 缓存（白板删除时使用）
 */
export async function clearState(shortId: string): Promise<void> {
  try {
    const redis = getActiveRedisClient()
    await redis.del(STATE_KEY(shortId))
  } catch (err) {
    console.warn('[stateCache] clearState failed:', (err as Error).message)
  }
}
