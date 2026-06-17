/**
 * OT 算法单元测试
 *
 * 覆盖场景：
 * - add vs add（去重）
 * - add vs update（无冲突）
 * - update vs update（相同属性 delta 补偿 / last-writer-wins）
 * - delete vs update（丢弃 update）
 * - clear-all（抹除一切）
 * - 操作乱序处理
 * - 边界情况
 */

import { describe, it, expect } from 'vitest'
import { transform } from '../../server/src/ot/transform'
import { compose } from '../../server/src/ot/compose'
import type { WhiteboardOperation } from '../../server/src/ot/types'

function makeOp(
  type: WhiteboardOperation['type'],
  overrides: Partial<WhiteboardOperation> = {}
): WhiteboardOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type,
    elementId: 'el-1',
    data: {},
    timestamp: Date.now(),
    userId: 'user-1',
    ...overrides,
  }
}

describe('OT transform', () => {
  // ========== add vs add ==========
  it('add vs add: same id should deduplicate', () => {
    const local = makeOp('add', { elementId: 'same-id', data: { x: 10 } })
    const remote = makeOp('add', { elementId: 'same-id', data: { x: 20 } })

    const result = transform(local, remote)
    expect(result.type).toBe('noop')
  })

  it('add vs add: different ids should not conflict', () => {
    const local = makeOp('add', { elementId: 'id-a', data: { x: 10 } })
    const remote = makeOp('add', { elementId: 'id-b', data: { x: 20 } })

    const result = transform(local, remote)
    expect(result.type).toBe('add')
    expect(result.elementId).toBe('id-a')
  })

  // ========== add vs update ==========
  it('add vs update: no conflict', () => {
    const local = makeOp('add', { elementId: 'new-id', data: { x: 10 } })
    const remote = makeOp('update', { elementId: 'existing-id', data: { x: 20 } })

    const result = transform(local, remote)
    expect(result.type).toBe('add')
  })

  // ========== update vs update ==========
  it('update vs update: same field (position) should delta compensate', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10, y: 0 },
    })
    const remote = makeOp('update', {
      elementId: 'el-1',
      data: { x: 20, y: 0 },
    })

    const result = transform(local, remote)
    expect(result.type).toBe('update')
    // Delta 反向补偿: local.x - remote.x = 10 - 20 = -10
    expect(result.data).toEqual({ x: -10, y: 0 })
  })

  it('update vs update: different fields should merge', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
    })
    const remote = makeOp('update', {
      elementId: 'el-1',
      data: { fill: '#FF0000' },
    })

    const result = transform(local, remote)
    expect(result.type).toBe('update')
    expect(result.data).toEqual({ x: 10 })
  })

  it('update vs update: same non-position field should last-writer-wins', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { fill: '#FF0000' },
      timestamp: 1000,
    })
    const remote = makeOp('update', {
      elementId: 'el-1',
      data: { fill: '#00FF00' },
      timestamp: 2000,
    })

    const result = transform(local, remote)
    // remote timestamp 更大，local 应该被丢弃或变为 noop
    expect(result.type).toBe('noop')
  })

  // ========== delete vs update ==========
  it('delete vs update: should drop update', () => {
    const local = makeOp('delete', { elementId: 'el-1' })
    const remote = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
    })

    const result = transform(local, remote)
    expect(result.type).toBe('delete')
  })

  it('update vs delete: should drop update', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
    })
    const remote = makeOp('delete', { elementId: 'el-1' })

    const result = transform(local, remote)
    expect(result.type).toBe('noop')
  })

  // ========== clear-all ==========
  it('clear-all vs any: should clear all', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
    })
    const remote = makeOp('clear-all')

    const result = transform(local, remote)
    expect(result.type).toBe('noop')
  })

  it('any vs clear-all: should clear all', () => {
    const local = makeOp('add', { elementId: 'el-1', data: { x: 10 } })
    const remote = makeOp('clear-all')

    const result = transform(local, remote)
    expect(result.type).toBe('noop')
  })

  // ========== 边界情况 ==========
  it('should handle empty data', () => {
    const local = makeOp('update', { elementId: 'el-1', data: {} })
    const remote = makeOp('update', { elementId: 'el-1', data: {} })

    const result = transform(local, remote)
    expect(result.type).toBe('noop')
  })

  it('should handle different elements', () => {
    const local = makeOp('update', { elementId: 'el-a', data: { x: 10 } })
    const remote = makeOp('update', { elementId: 'el-b', data: { x: 20 } })

    const result = transform(local, remote)
    expect(result.type).toBe('update')
    expect(result.elementId).toBe('el-a')
  })

  it('should handle multiple field updates', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10, y: 20, width: 100 },
    })
    const remote = makeOp('update', {
      elementId: 'el-1',
      data: { x: 5, height: 200 },
    })

    const result = transform(local, remote)
    expect(result.type).toBe('update')
    // x 冲突需要 delta 补偿，y 和 width 保留
    expect(result.data).toEqual({ x: 5, y: 20, width: 100 })
  })
})

describe('OT compose', () => {
  it('should compose two add operations', () => {
    const op1 = makeOp('add', { elementId: 'el-1', data: { x: 10 } })
    const op2 = makeOp('add', { elementId: 'el-2', data: { x: 20 } })

    const result = compose(op1, op2)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('should compose update operations on same element', () => {
    const op1 = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
    })
    const op2 = makeOp('update', {
      elementId: 'el-1',
      data: { y: 20 },
    })

    const result = compose(op1, op2)
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result[0].data).toEqual({ x: 10, y: 20 })
    }
  })

  it('should compose delete after update as delete', () => {
    const op1 = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
    })
    const op2 = makeOp('delete', { elementId: 'el-1' })

    const result = compose(op1, op2)
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result[result.length - 1].type).toBe('delete')
    }
  })
})

describe('OT stress tests', () => {
  it('should handle 1000 rapid operations', () => {
    const ops: WhiteboardOperation[] = []
    for (let i = 0; i < 1000; i++) {
      ops.push(
        makeOp('update', {
          elementId: `el-${i % 10}`,
          data: { x: i },
        })
      )
    }

    // 两两转换不应报错
    for (let i = 0; i < ops.length - 1; i++) {
      const result = transform(ops[i], ops[i + 1])
      expect(result).toBeDefined()
    }
  })

  it('should handle concurrent position updates', () => {
    const local = makeOp('update', {
      elementId: 'el-1',
      data: { x: 100, y: 50 },
    })
    const remote = makeOp('update', {
      elementId: 'el-1',
      data: { x: 80, y: 60 },
    })

    const result = transform(local, remote)
    expect(result.type).toBe('update')
    // Delta 补偿
    expect(result.data).toEqual({ x: 20, y: -10 })
  })

  it('should handle out-of-order operations', () => {
    const op1 = makeOp('update', {
      elementId: 'el-1',
      data: { x: 10 },
      timestamp: 1000,
    })
    const op2 = makeOp('update', {
      elementId: 'el-1',
      data: { x: 20 },
      timestamp: 500, // 更早的操作
    })

    const result = transform(op1, op2)
    expect(result.type).toBe('update')
    // 即使时间戳乱序，也应该正确计算 delta
  })
})
