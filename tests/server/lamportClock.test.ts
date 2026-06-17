/**
 * Lamport 时钟单元测试
 */

import { describe, it, expect } from 'vitest'
import { LamportClock } from '../../server/src/ot/LamportClock'

describe('LamportClock', () => {
  it('should increment on tick', () => {
    const clock = new LamportClock()
    const t1 = clock.tick()
    const t2 = clock.tick()

    expect(t2).toBe(t1 + 1)
  })

  it('should update from remote timestamp', () => {
    const clock = new LamportClock()
    clock.tick() // 1
    clock.tick() // 2

    clock.update(5)
    expect(clock.getTime()).toBe(6)
  })

  it('should not decrease on smaller remote timestamp', () => {
    const clock = new LamportClock()
    clock.tick() // 1
    clock.tick() // 2
    clock.tick() // 3

    clock.update(1)
    expect(clock.getTime()).toBe(4) // max(3, 1) + 1
  })

  it('should handle concurrent clocks', () => {
    const clockA = new LamportClock()
    const clockB = new LamportClock()

    // A: 1, B: 1
    const tA1 = clockA.tick()
    const tB1 = clockB.tick()

    expect(tA1).toBe(1)
    expect(tB1).toBe(1)

    // A receives B's timestamp
    clockA.update(tB1)
    const tA2 = clockA.tick()

    expect(tA2).toBe(3) // max(1, 1) + 1 = 2, then tick = 3
  })

  it('should maintain monotonicity', () => {
    const clock = new LamportClock()
    let prev = 0

    for (let i = 0; i < 100; i++) {
      const t = clock.tick()
      expect(t).toBeGreaterThan(prev)
      prev = t
    }
  })
})
