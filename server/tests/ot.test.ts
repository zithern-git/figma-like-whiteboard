/**
 * OT 算法单元测试
 *
 * 覆盖：
 * 1. LamportClock — tick / observe / peek
 * 2. transform() — op 矩阵（add/add, update/update, delete/update, clear-all 等）
 * 3. compose() — op 合并矩阵
 * 4. transformChain() — 链式 transform
 *
 * 运行：cd server && npx ts-node --transpile-only tests/ot.test.ts
 */

import {
  createLamportClock,
  compareByLamport,
  transform,
  transformChain,
  compose,
} from '../src/ot'

// ========== 简易测试框架 ==========

let passCount = 0
let failCount = 0
const failures: Array<{ name: string; err: string }> = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    passCount++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (err) {
    failCount++
    failures.push({ name, err: (err as Error).message })
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    \x1b[31m${(err as Error).message}\x1b[0m`)
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
  fn()
}

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  // 深比较：避免 JSON 序列化时 key 顺序差异导致的 false-negative
  const a = normalize(actual)
  const e = normalize(expected)
  if (a !== e) {
    throw new Error(`${msg ?? 'assertEqual failed'}\n  expected: ${e}\n  actual:   ${a}`)
  }
}

/** 标准化对象（按 key 排序后 JSON 序列化） */
function normalize(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(normalize).join(',') + ']'
  // 对象：按 key 排序
  const keys = Object.keys(v).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + normalize(v[k])).join(',') + '}'
}

function assertTrue(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'assertTrue failed')
}

function assertFalse(cond: boolean, msg?: string): void {
  if (cond) throw new Error(msg ?? 'assertFalse failed')
}

// ========== 工具：构造 op + 应用 op 到 elements 数组 ==========

/**
 * 把一组 op 依次应用，模拟 OT 客户端的白板状态
 *
 * 关键语义：position 字段（x/y/width/height）以 DELTA 方式累加
 * 其它字段直接覆盖（"set absolute value"）
 *
 * 这与 transform 的输出语义一致：
 *   - op1："set x = 50"（绝对值）
 *   - transformed op2："x: -50"（delta，应用时加到当前 x 上）
 *   - 最终：x = 50 + (-50) = 0
 *
 * 仅用于 OT 收敛性验证（不模拟完整白板状态，只关心被操作的目标元素）
 */
function applyAll(ops: any[]): Record<string, unknown> {
  // 初始状态：空对象（X 元素在第一个 add 或 update 时被创建）
  const state: Record<string, Record<string, unknown>> = {}
  const POSITION = new Set(['x', 'y', 'width', 'height'])
  for (const op of ops) {
    if (op.opType === 'update') {
      const id = op.payload.id
      const current = state[id] ?? { id }
      const next: Record<string, unknown> = { ...current }
      for (const [k, v] of Object.entries(op.payload.updates)) {
        if (POSITION.has(k) && typeof v === 'number' && typeof next[k] === 'number') {
          // position 字段：delta 累加
          next[k] = (next[k] as number) + v
        } else {
          // 非 position 字段：覆盖
          next[k] = v
        }
      }
      state[id] = next
    } else if (op.opType === 'add') {
      const el = op.payload.element
      state[el.id] = { ...el }
    } else if (op.opType === 'delete') {
      delete state[op.payload.id]
    }
  }
  return state['X'] ?? {}
}

let opCounter = 0
let lamportCounter = 0
function makeOp(opts: {
  opType: 'add' | 'update' | 'delete' | 'clear-all'
  whiteboardId?: string
  userId?: string
  baseVersion?: number
  /** 默认自动递增（保证冲突时有可比较的 lamport） */
  lamportClock?: number
  payload?: any
  clientOpId?: string
}): any {
  opCounter++
  if (opts.lamportClock === undefined) {
    lamportCounter++
    opts.lamportClock = lamportCounter
  }
  return {
    id: undefined,
    clientOpId: opts.clientOpId ?? `client-${opCounter}`,
    whiteboardId: opts.whiteboardId ?? 'wb-1',
    userId: opts.userId ?? 'user-A',
    opType: opts.opType,
    payload: opts.payload ?? (opts.opType === 'add' ? { element: { id: `el-${opCounter}`, x: 0, y: 0 } } : {}),
    baseVersion: opts.baseVersion ?? 0,
    lamportClock: opts.lamportClock,
    timestamp: Date.now(),
  }
}

// ========== LamportClock 测试 ==========

describe('LamportClock', () => {
  test('初始 counter 为 0', () => {
    const c = createLamportClock()
    assertEqual(c.peek(), 0)
  })

  test('tick 自增并返回新值', () => {
    const c = createLamportClock()
    assertEqual(c.tick(), 1)
    assertEqual(c.tick(), 2)
    assertEqual(c.tick(), 3)
    assertEqual(c.peek(), 3)
  })

  test('observe 远端比本地大时取 max+1', () => {
    const c = createLamportClock(2)
    const r = c.observe(5)
    assertEqual(r, 6)
    assertEqual(c.peek(), 6)
  })

  test('observe 远端比本地小时仍自增', () => {
    const c = createLamportClock(10)
    const r = c.observe(3)
    assertEqual(r, 11)
  })

  test('自定义初始值', () => {
    const c = createLamportClock(100)
    assertEqual(c.peek(), 100)
    assertEqual(c.tick(), 101)
  })

  test('无效初始值抛错', () => {
    let threw = false
    try {
      createLamportClock(-1)
    } catch {
      threw = true
    }
    assertTrue(threw, 'should throw on negative initial')
  })

  test('compareByLamport 按时钟排序', () => {
    const a = { lamportClock: 1, userId: 'user-A' }
    const b = { lamportClock: 2, userId: 'user-B' }
    const c = { lamportClock: 1, userId: 'user-C' }
    assertTrue(compareByLamport(a, b) < 0)
    assertTrue(compareByLamport(b, a) > 0)
    assertTrue(compareByLamport(a, c) < 0) // 字典序打破平局
  })
})

// ========== transform() 测试 ==========

describe('transform() — add 与其他', () => {
  test('add(X) vs add(Y)（不同 id）→ op2 不变', () => {
    const op1 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const op2 = makeOp({ opType: 'add', payload: { element: { id: 'Y' } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
    assertFalse(r.becameNoop)
    assertEqual((r.operation.payload as any).element.id, 'Y')
  })

  test('add(X) vs add(X)（同 id）→ op2 noop', () => {
    const op1 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const op2 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const r = transform(op1, op2)
    assertTrue(r.becameNoop, 'should be noop')
  })

  test('add(X) vs update(X) → op2 不变', () => {
    const op1 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
    assertFalse(r.becameNoop)
    assertEqual((r.operation.payload as any).updates.x, 50)
  })

  test('add(X) vs delete(X) → op2 不变（仍可删）', () => {
    const op1 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const op2 = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
  })

  test('update(X) vs add(Y)（不同 id）→ op2 不变', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const op2 = makeOp({ opType: 'add', payload: { element: { id: 'Y' } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
    assertEqual((r.operation.payload as any).element.id, 'Y')
  })
})

describe('transform() — update vs update', () => {
  test('update(X) vs update(Y)（不同元素）→ op2 不变', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'Y', updates: { y: 100 } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
    assertEqual((r.operation.payload as any).updates.y, 100)
  })

  test('update(X) vs update(X) 不同属性 → 转换后只含 op2 字段（op1 字段不重复）', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { y: 100 } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
    const u = (r.operation.payload as any).updates
    // 语义：transformed op2 只表达 op2 显式设置的字段
    // op2 没动 x，所以 x 不在 transformed payload
    assertEqual(u.x, undefined)
    assertEqual(u.y, 100)
    // 验证最终状态：apply(op1) → apply(transformed op2) 与 op1, op2 都生效一致
    assertEqual(applyAll([op1, r.operation]), { id: 'X', x: 50, y: 100 })
  })

  test('update(X) vs update(X) 相同属性（非位置）→ 字段级覆盖（无 delta 调整）', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { fill: 'red' } } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { fill: 'blue' } } })
    const r = transform(op1, op2)
    // 非位置字段：op2 直接覆盖（无需 delta 调整）
    assertEqual((r.operation.payload as any).updates.fill, 'blue')
  })

  test('update(X) 移动 x=50, op2 想把 x 设回 0 → x 调整为 -50（反向补偿）', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 0 } } })
    const r = transform(op1, op2)
    // op1 已把 x 从 0 改成 50；op2 想把 x 改成 0（在 op1 之后的状态下）
    // op2 期望的最终位置是 op2.updates.x = 0，但当前（op1 后）位置是 50
    // 为达到 0，op2 需要把 x 从 50 改成 0 → 调整后 updates.x = 0 - 50 = -50
    assertEqual((r.operation.payload as any).updates.x, -50)
    // 验证最终状态：op1 后 x=50，再 apply transformed op2 (-50) → x=0
    assertEqual(applyAll([op1, r.operation]), { id: 'X', x: 0 })
  })

  test('update(X) 不动位置，op2 移动 x=10 → op2 不变', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { fill: 'red' } } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 10 } } })
    const r = transform(op1, op2)
    assertEqual((r.operation.payload as any).updates.x, 10)
  })

  test('update 复合：op1 改 x=50, y=30, op2 想把 x 改 0, y 改 0 + fill=blue → 几何字段反向补偿，非几何不动', () => {
    const op1 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { x: 50, y: 30 } },
    })
    const op2 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { x: 0, y: 0, fill: 'blue' } },
    })
    const r = transform(op1, op2)
    const u = (r.operation.payload as any).updates
    assertEqual(u.x, -50) // 0 - 50
    assertEqual(u.y, -30) // 0 - 30
    assertEqual(u.fill, 'blue') // 非几何字段不动
    // 验证最终状态：apply(op1) → apply(transformed op2) 后 x=0, y=0, fill=blue
    assertEqual(applyAll([op1, r.operation]), { id: 'X', x: 0, y: 0, fill: 'blue' })
  })

  test('OT 收敛性：apply(op1, op2) === apply(op2, op1)（任意顺序结果一致）', () => {
    const op1 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { x: 100, fill: 'red' } },
    })
    const op2 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { x: 50, y: 200, stroke: 'blue' } },
    })
    // op2 晚到 → transform(op1, op2)
    const r = transform(op1, op2)
    // 应用顺序 1：op1 后 r.operation
    const state1 = applyAll([op1, r.operation])
    // 应用顺序 2：op2 后 transform(op2, op1)
    const r2 = transform(op2, op1)
    const state2 = applyAll([op2, r2.operation])
    // 两种顺序的最终状态应一致（convergence）
    assertEqual(state1, state2)
  })

  test('update 不动位置字段时，op2 的非几何字段保持不变（op1 的 x/y 不会被 op2 重写）', () => {
    const op1 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { x: 100, y: 200 } },
    })
    const op2 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { fill: 'red', stroke: 'blue' } },
    })
    const r = transform(op1, op2)
    const u = (r.operation.payload as any).updates
    // op2 不动位置字段，x/y 不应出现在 transformed payload
    assertEqual(u.x, undefined)
    assertEqual(u.y, undefined)
    // 非位置字段：op2 直接覆盖
    assertEqual(u.fill, 'red')
    assertEqual(u.stroke, 'blue')
  })
})

describe('transform() — delete vs 其他', () => {
  test('delete(X) vs update(X)（同元素）→ op2 被丢弃', () => {
    const op1 = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const r = transform(op1, op2)
    assertTrue(r.dropped || r.becameNoop, 'update after delete should be dropped')
  })

  test('delete(X) vs update(Y)（不同元素）→ op2 不变', () => {
    const op1 = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'Y', updates: { x: 50 } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
  })

  test('delete(X) vs delete(X)（同元素）→ op2 noop', () => {
    const op1 = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const op2 = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const r = transform(op1, op2)
    assertTrue(r.becameNoop)
  })

  test('delete(X) vs add(X) → op2 不变（X 被加回来）', () => {
    const op1 = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const op2 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const r = transform(op1, op2)
    assertFalse(r.dropped)
  })
})

describe('transform() — clear-all', () => {
  test('clear-all 任意 vs op2 → op2 noop', () => {
    const op1 = makeOp({ opType: 'clear-all' })
    const op2 = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const r = transform(op1, op2)
    assertTrue(r.becameNoop)
  })

  test('op1 任意 vs clear-all → op2 noop', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const op2 = makeOp({ opType: 'clear-all' })
    const r = transform(op1, op2)
    assertTrue(r.becameNoop)
  })
})

describe('transform() — 其他', () => {
  test('update 不动位置字段时，op2 的非几何字段保持不变', () => {
    const op1 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 100, y: 200 } } })
    const op2 = makeOp({
      opType: 'update',
      payload: { id: 'X', updates: { fill: 'red', stroke: 'blue' } },
    })
    const r = transform(op1, op2)
    const u = (r.operation.payload as any).updates
    assertEqual(u.fill, 'red')
    assertEqual(u.stroke, 'blue')
    // x/y 不在 op2 中，所以不会被加进 merged
    assertEqual(u.x, undefined)
  })
})

// ========== transformChain 测试 ==========

describe('transformChain()', () => {
  test('链式 transform 连续处理多个 op', () => {
    const op1a = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 10 } } })
    const op1b = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 20 } } })
    // op1a 之后 x=10；op1b 之后 x=10+20=30
    // op2 想把 x 设到 50，最终在 op1a+op1b 之后，x 应该是 50
    // 链式：先 transform(op1a, op2): x = 50 - 10 = 40
    //      再 transform(op1b, result): x = 40 - 20 = 20
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const r = transformChain([op1a, op1b], op2)
    assertEqual((r.operation.payload as any).updates.x, 20)
  })

  test('链式 transform 中途遇到 delete → 后续变 noop', () => {
    const op1a = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 10 } } })
    const op1b = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const r = transformChain([op1a, op1b], op2)
    assertTrue(r.becameNoop, 'should be dropped after delete')
  })

  test('空链 → op2 不变', () => {
    const op2 = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const r = transformChain([], op2)
    assertEqual((r.operation.payload as any).updates.x, 50)
  })
})

// ========== compose() 测试 ==========

describe('compose()', () => {
  test('add(X) + delete(X) → noop（取消）', () => {
    const opA = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const opB = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const r = compose(opA, opB)
    assertTrue(r.becameNoop)
  })

  test('delete(X) + add(X) → noop（保守处理）', () => {
    const opA = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const opB = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const r = compose(opA, opB)
    assertTrue(r.becameNoop)
  })

  test('update(X) + update(X) 相同属性 → opB 覆盖', () => {
    const opA = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const opB = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 999 } } })
    const r = compose(opA, opB)
    assertEqual((r.operation.payload as any).updates.x, 999)
  })

  test('update(X) + update(X) 不同属性 → 合并', () => {
    const opA = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const opB = makeOp({ opType: 'update', payload: { id: 'X', updates: { y: 100 } } })
    const r = compose(opA, opB)
    const u = (r.operation.payload as any).updates
    assertEqual(u.x, 50)
    assertEqual(u.y, 100)
  })

  test('update(X) + delete(X) → 退化为 delete(X)', () => {
    const opA = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const opB = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const r = compose(opA, opB)
    assertEqual(r.operation.opType, 'delete')
  })

  test('delete(X) + delete(X) → 单一 delete(X)', () => {
    const opA = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const opB = makeOp({ opType: 'delete', payload: { id: 'X' } })
    const r = compose(opA, opB)
    assertEqual(r.operation.opType, 'delete')
    assertFalse(r.becameNoop)
  })

  test('update(X) + update(Y) 不同元素 → 退化为 opB（不强行合并）', () => {
    const opA = makeOp({ opType: 'update', payload: { id: 'X', updates: { x: 50 } } })
    const opB = makeOp({ opType: 'update', payload: { id: 'Y', updates: { y: 100 } } })
    const r = compose(opA, opB)
    assertEqual(r.operation.opType, 'update')
    assertEqual((r.operation.payload as any).id, 'Y')
  })

  test('clear-all + 任意 → 退化为 opB', () => {
    const opA = makeOp({ opType: 'clear-all' })
    const opB = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const r = compose(opA, opB)
    assertEqual(r.operation.opType, 'add')
  })

  test('add(X) + add(Y) 不同元素 → opB', () => {
    const opA = makeOp({ opType: 'add', payload: { element: { id: 'X' } } })
    const opB = makeOp({ opType: 'add', payload: { element: { id: 'Y' } } })
    const r = compose(opA, opB)
    assertEqual(r.operation.opType, 'add')
  })
})

// ========== 总结 ==========

console.log(`\n\x1b[1m=========================\x1b[0m`)
console.log(`\x1b[1m  Total: ${passCount + failCount}\x1b[0m`)
console.log(`  \x1b[32mPassed: ${passCount}\x1b[0m`)
console.log(`  \x1b[31mFailed: ${failCount}\x1b[0m`)
if (failures.length > 0) {
  console.log(`\n\x1b[1m\x1b[31mFailures:\x1b[0m`)
  failures.forEach((f) => {
    console.log(`  - ${f.name}`)
    console.log(`    ${f.err}`)
  })
}
console.log(`\x1b[1m=========================\x1b[0m\n`)

if (failCount > 0) process.exit(1)
