/**
 * 白板在线用户管理 (onlineUsers)
 *
 * 职责：
 * - 维护每个白板的在线用户集合（基于 Redis Set）
 * - 存储用户展示信息（name / color）作为 JSON 字符串
 * - 提供 join / leave / list / getUserInfo 接口
 *
 * 6.1 简化：使用 Redis Set + 单一 JSON 字符串存用户信息，
 * 不使用 Hash（InMemoryRedis mock 缺 hset/hgetall）。
 * 6.2 阶段如果有需要再升级为 Hash。
 */

import redisClient from '../config/redis'

/** 在线用户展示信息 */
export interface OnlineUserInfo {
  userId: string
  name: string
  /** 用于光标颜色：基于 userId 哈希出来的稳定颜色 */
  color: string
  /** socketId（用于 disconnect 时定位清理） */
  socketId: string
  joinedAt: number
}

const ONLINE_SET_KEY = (shortId: string) => `whiteboard:${shortId}:online`
const USERS_JSON_KEY = (shortId: string) => `whiteboard:${shortId}:users`

/** 为 userId 生成稳定的颜色（HSL 配色，按 userId 字符串 hash） */
export function getUserColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 70%, 55%)`
}

/** 读所有用户信息（解析 JSON） */
async function readUsersJson(shortId: string): Promise<OnlineUserInfo[]> {
  const raw = await redisClient.get(USERS_JSON_KEY(shortId))
  if (!raw) return []
  try {
    return JSON.parse(raw) as OnlineUserInfo[]
  } catch {
    return []
  }
}

/** 写所有用户信息（JSON 序列化） */
async function writeUsersJson(
  shortId: string,
  users: OnlineUserInfo[]
): Promise<void> {
  await redisClient.set(USERS_JSON_KEY(shortId), JSON.stringify(users))
}

/**
 * 用户加入白板
 * - SADD 到 online Set
 * - 在 users JSON 中添加 / 更新用户条目（如果已存在只更新 socketId）
 * - 返回更新后的完整在线列表
 */
export async function joinOnline(
  shortId: string,
  userId: string,
  name: string,
  socketId: string
): Promise<OnlineUserInfo[]> {
  await redisClient.sAdd(ONLINE_SET_KEY(shortId), userId)
  const users = await readUsersJson(shortId)
  const existing = users.find((u) => u.userId === userId)
  if (existing) {
    existing.socketId = socketId
    existing.name = name
  } else {
    users.push({
      userId,
      name,
      color: getUserColor(userId),
      socketId,
      joinedAt: Date.now(),
    })
  }
  await writeUsersJson(shortId, users)
  return users
}

/**
 * 用户离开白板（按 socketId 移除，避免误关其他标签页）
 * 返回更新后的列表；如果用户已不在 Set 中则返回当前列表
 */
export async function leaveOnline(
  shortId: string,
  socketId: string
): Promise<OnlineUserInfo[]> {
  const users = await readUsersJson(shortId)
  const idx = users.findIndex((u) => u.socketId === socketId)
  if (idx === -1) return users
  const removed = users.splice(idx, 1)[0]
  await writeUsersJson(shortId, users)
  await redisClient.sRem(ONLINE_SET_KEY(shortId), removed.userId)
  return users
}

/** 读当前在线列表 */
export async function listOnline(shortId: string): Promise<OnlineUserInfo[]> {
  return readUsersJson(shortId)
}

/** 清理白板（白板删除时使用） */
export async function clearOnline(shortId: string): Promise<void> {
  await redisClient.del(ONLINE_SET_KEY(shortId))
  await redisClient.del(USERS_JSON_KEY(shortId))
}
