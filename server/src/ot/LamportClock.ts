/**
 * Lamport 逻辑时钟
 *
 * 算法：
 * - 本地事件 → counter = counter + 1，返回 counter
 * - 收到远端消息带 clock=remote → counter = max(counter, remote) + 1，返回 counter
 *
 * 因果保证：若事件 A 严格早于事件 B（B 看到了 A 的结果），则 lamport(B) > lamport(A)。
 * 平局时用 (clock, userId) 字典序打破全序。
 *
 * 线程/进程安全：本实现是 in-memory counter，多 socket 并发时由 Node.js 单线程事件循环
 * 串行化，无需额外加锁。服务端的 "白板级" LamportClock 实例在 otService 中按
 * whiteboardId 维护。
 */

import type { LamportClock as ILamportClock } from './types'

/**
 * 创建 Lamport 时钟
 *
 * @param initial 初始 counter（默认 0）
 * @returns LamportClock 实例
 */
export function createLamportClock(initial: number = 0): ILamportClock {
  if (!Number.isInteger(initial) || initial < 0) {
    throw new Error(`createLamportClock: initial must be a non-negative integer, got ${initial}`)
  }
  let counter = initial
  return {
    get counter() {
      return counter
    },
    tick(): number {
      counter = counter + 1
      return counter
    },
    observe(remote: number): number {
      if (!Number.isInteger(remote) || remote < 0) {
        throw new Error(`LamportClock.observe: remote must be a non-negative integer, got ${remote}`)
      }
      counter = Math.max(counter, remote) + 1
      return counter
    },
    peek(): number {
      return counter
    },
  }
}

/**
 * 用 (lamportClock, userId) 字典序对两个 op 做全序比较
 *
 * 返回值：
 * - 负数：a 排在 b 之前
 * - 正数：a 排在 b 之后
 * - 0：完全相同（不应出现，因为 clientOpId 唯一）
 */
export function compareByLamport(
  a: { lamportClock: number; userId: string },
  b: { lamportClock: number; userId: string }
): number {
  if (a.lamportClock !== b.lamportClock) {
    return a.lamportClock - b.lamportClock
  }
  // 平局：用 userId 字典序打破（稳定 tiebreaker）
  if (a.userId < b.userId) return -1
  if (a.userId > b.userId) return 1
  return 0
}
