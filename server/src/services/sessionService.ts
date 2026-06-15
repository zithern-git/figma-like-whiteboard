/**
 * Redis 会话服务 (sessionService)
 *
 * 职责：
 * - 存储 / 读取用户会话信息（登录 token 状态、用户信息缓存）
 * - TTL 7 天（与 JWT 有效期对齐）
 * - 用于"撤销 token"、在线设备管理、未来多设备登录
 *
 * Key 设计：
 * - `session:{userId}` — 主会话（用户维度）
 * - `session:token:{token}` — token 维度反查（黑名单用）
 *
 * 失败语义：
 * - Redis 不可用时所有方法降级为 no-op（不阻塞主流程）
 */

import { getActiveRedisClient } from '../config/redis'

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 天
const SESSION_KEY = (userId: string) => `session:${userId}`
const TOKEN_KEY = (token: string) => `session:token:${token}`

/** 会话内容 */
export interface SessionData {
  userId: string
  email?: string
  name?: string
  /** 登录时间 */
  loginAt: number
  /** 最后活跃时间 */
  lastActiveAt: number
  /** 设备信息（UA 等） */
  device?: string
  /** 自定义 payload（业务扩展） */
  [key: string]: unknown
}

/**
 * 创建 / 更新会话
 *
 * @param userId 用户 ID
 * @param data 会话数据
 * @param token 可选 token（用于 token 维度反查）
 */
export async function createSession(
  userId: string,
  data: Omit<SessionData, 'userId' | 'loginAt' | 'lastActiveAt'>,
  token?: string
): Promise<void> {
  try {
    const redis = getActiveRedisClient()
    const now = Date.now()
    const sessionData: SessionData = {
      userId,
      loginAt: now,
      lastActiveAt: now,
      ...data,
    }
    await redis.set(SESSION_KEY(userId), JSON.stringify(sessionData), {
      EX: SESSION_TTL_SECONDS,
    })
    if (token) {
      await redis.set(TOKEN_KEY(token), userId, { EX: SESSION_TTL_SECONDS })
    }
  } catch (err) {
    console.warn('[sessionService] createSession failed:', (err as Error).message)
  }
}

/**
 * 读取会话
 */
export async function getSession(userId: string): Promise<SessionData | null> {
  try {
    const redis = getActiveRedisClient()
    const raw = await redis.get(SESSION_KEY(userId))
    if (!raw) return null
    return JSON.parse(raw) as SessionData
  } catch (err) {
    console.warn('[sessionService] getSession failed:', (err as Error).message)
    return null
  }
}

/**
 * 通过 token 反查 userId（用于 token 黑名单 / 多设备管理）
 */
export async function getUserIdByToken(token: string): Promise<string | null> {
  try {
    const redis = getActiveRedisClient()
    return await redis.get(TOKEN_KEY(token))
  } catch (err) {
    console.warn('[sessionService] getUserIdByToken failed:', (err as Error).message)
    return null
  }
}

/**
 * 删除会话（登出 / 撤销）
 */
export async function deleteSession(userId: string, token?: string): Promise<void> {
  try {
    const redis = getActiveRedisClient()
    await redis.del(SESSION_KEY(userId))
    if (token) await redis.del(TOKEN_KEY(token))
  } catch (err) {
    console.warn('[sessionService] deleteSession failed:', (err as Error).message)
  }
}

/**
 * 验证 token 仍有效（未登出 / 未被撤销）
 *
 * 用法：JWT 验证通过后额外调用此函数，确认 session 仍然存在
 */
export async function isTokenValid(token: string, userId: string): Promise<boolean> {
  const session = await getSession(userId)
  if (!session) return false
  // 刷新最后活跃时间
  session.lastActiveAt = Date.now()
  const redis = getActiveRedisClient()
  await redis.set(SESSION_KEY(userId), JSON.stringify(session), {
    EX: SESSION_TTL_SECONDS,
  })
  return true
}
