/**
 * OT 服务并发集成测试
 *
 * 模拟场景：
 * - 两个用户（user-A, user-B）并发编辑同一个白板
 * - 同时发送 add / update / delete op，验证：
 *   1. 服务端正确处理并发（不丢 op）
 *   2. version 严格单调递增
 *   3. 并发 update 走 transform 路径
 *   4. delete vs update 冲突时 update 被丢弃
 *   5. 乱序到达的 op 会被缓冲
 *
 * 实现：Mock mongoose 的 Whiteboard / OperationLog，避免对真实 MongoDB 的依赖
 *
 * 运行：cd server && npx ts-node --transpile-only tests/otService.integration.test.ts
 */

import mongoose from 'mongoose'

// ========== Mock mongoose 模型（用 Proxy 拦截） ==========

// 全局数据存储（每个 test 在 beforeEach 中清空，避免历史 op 污染后续测试的 transform 链）
const mockData: { operationLogs: any[] } = { operationLogs: [] }

/** 通用 Query 构造器（同时支持 findOne 和 find） */
function makeQuery(filter: any, mode: 'one' | 'many') {
  let sortSpec: any = null
  const q: any = {
    filter,
    sort(spec: any) {
      sortSpec = spec
      return q
    },
    limit(_n: number) {
      return q
    },
    async lean() {
      return runQuery(filter, sortSpec, mode)
    },
  }
  // mongoose Query 是 thenable（可 await）
  q.then = (resolve: any, reject?: any) => q.lean().then(resolve, reject)
  return q
}

function runQuery(filter: any, sortSpec: any, mode: 'one' | 'many'): any {
  let matches = mockData.operationLogs.filter((d) => matchFilter(d, filter))
  if (sortSpec) {
    const sortKey = Object.keys(sortSpec)[0]
    const sortDir = sortSpec[sortKey]
    matches = [...matches].sort((a, b) => {
      if (sortDir === -1) return b[sortKey] - a[sortKey]
      if (sortDir === 1) return a[sortKey] - b[sortKey]
      return 0
    })
  }
  return mode === 'one' ? matches[0] ?? null : matches
}

function matchFilter(doc: any, filter: any): boolean {
  for (const key of Object.keys(filter)) {
    const filterVal = filter[key]
    if (filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)) {
      for (const op of Object.keys(filterVal)) {
        const v = filterVal[op]
        switch (op) {
          case '$gt': if (!(doc[key] > v)) return false; break
          case '$lte': if (!(doc[key] <= v)) return false; break
          case '$gte': if (!(doc[key] >= v)) return false; break
          case '$ne': if (doc[key] === v) return false; break
          case '$in':
            if (!v.includes(doc[key])) return false
            break
        }
      }
    } else if (doc[key] !== filterVal) {
      return false
    }
  }
  return true
}

// 用 mongoose.model 替换为我们的 mock
const originalModel = mongoose.model.bind(mongoose)
;(mongoose as any).model = (name: string, _schema?: any): any => {
  if (name === 'OperationLog') {
    // mongoose 文档构造函数：new OperationLogModel(doc).save()
    function OperationLogMock(this: any, doc: any) {
      Object.assign(this, doc)
    }
    ;(OperationLogMock as any).findOne = (filter: any) => makeQuery(filter, 'one')
    ;(OperationLogMock as any).find = (filter: any) => makeQuery(filter, 'many')
    ;(OperationLogMock as any).create = async (doc: any) => {
      if (Array.isArray(doc)) {
        doc.forEach((d) => mockData.operationLogs.push({ ...d }))
        return doc
      }
      mockData.operationLogs.push({ ...doc })
      return doc
    }
    ;(OperationLogMock as any).bulkWrite = async (ops: any[]) => ({
      insertedCount: ops.length,
    })
    ;(OperationLogMock as any).prototype.save = async function (this: any) {
      mockData.operationLogs.push({ ...this })
      return this
    }
    return OperationLogMock
  }
  if (name === 'Whiteboard') {
    return {
      findOne: async (filter: any) => {
        // 接受任何 wb-test-* 的 shortId（每个测试一个独立白板）
        if (
          filter.shortId &&
          typeof filter.shortId === 'string' &&
          filter.shortId.startsWith('wb-test') &&
          filter.deleted === false
        ) {
          return {
            shortId: filter.shortId,
            elements: [],
            deleted: false,
          }
        }
        return null
      },
      updateOne: async () => ({ acknowledged: true, modifiedCount: 1 }),
    }
  }
  return originalModel(name, _schema)
}

// ========== 测试框架 ==========

let pass = 0
let fail = 0
const failures: Array<{ name: string; err: string }> = []
const allTests: Array<Promise<void>> = []
let beforeEachHook: (() => Promise<void> | void) | null = null

function beforeEach(fn: () => Promise<void> | void): void {
  beforeEachHook = fn
}

function test(name: string, fn: () => Promise<void> | void): void {
  // 串行执行：每个测试等待前一个完成（避免共享状态竞争）
  const prev = allTests.length > 0 ? allTests[allTests.length - 1] : Promise.resolve()
  const p = prev
    .then(async () => {
      if (beforeEachHook) await beforeEachHook()
      await fn()
    })
    .then(() => {
      pass++
      console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    })
    .catch((err) => {
      fail++
      failures.push({ name, err: (err as Error).message })
      console.log(`  \x1b[31m✗\x1b[0m ${name}`)
      console.log(`    \x1b[31m${(err as Error).message}\x1b[0m`)
    })
  allTests.push(p)
}

function describe(name: string, fn: () => Promise<void> | void): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
  const prev = allTests.length > 0 ? allTests[allTests.length - 1] : Promise.resolve()
  const p = prev
    .then(() => Promise.resolve(fn()))
    .catch((err) => {
      fail++
      failures.push({ name: 'describe', err: (err as Error).message })
    })
  allTests.push(p)
}

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${msg ?? 'assertEqual failed'}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
    )
  }
}
function assertTrue(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'assertTrue failed')
}
function assertFalse(cond: boolean, msg?: string): void {
  if (cond) throw new Error(msg ?? 'assertFalse failed')
}

// ========== 构造 op 的辅助函数 ==========

let opCounter = 0
let currentWbId = 'wb-test' // 由每个 test 在首行覆盖
function makeOp(opts: {
  opType: 'add' | 'update' | 'delete' | 'clear-all'
  whiteboardId?: string
  userId?: string
  baseVersion?: number
  lamportClock?: number
  payload?: any
}): any {
  opCounter++
  return {
    clientOpId: `client-${opCounter}`,
    whiteboardId: opts.whiteboardId ?? currentWbId,
    userId: opts.userId ?? 'user-A',
    opType: opts.opType,
    payload: opts.payload ?? {},
    baseVersion: opts.baseVersion ?? 0,
    lamportClock: opts.lamportClock ?? opCounter,
    timestamp: Date.now(),
  }
}

// ========== 启动 OT 服务 ==========

// 必须在 mongoose.model mock 之后导入
import { otService } from '../src/ot/otService'

// Mock Socket（otService 需要 socket 引用进行广播）
class MockSocket {
  emitted: Array<{ event: string; payload: any }> = []
  id = `sock-${Math.random()}`
  data = { userId: 'mock-user', name: 'Mock User' }
  emit(event: string, payload: any): void {
    this.emitted.push({ event, payload })
  }
}

// Mock io（otService 需要 io.to(room).emit 进行广播）
class MockIO {
  rooms: Map<string, Set<MockSocket>> = new Map()
  to(room: string): { emit: (event: string, payload: any) => void } {
    return {
      emit: (event, payload) => {
        const sockets = this.rooms.get(room) ?? new Set()
        sockets.forEach((s) => s.emit(event, payload))
      },
    }
  }
  joinRoom(socket: MockSocket, room: string): void {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set())
    this.rooms.get(room)!.add(socket)
  }
}

// 初始化 otService（注入 mock io）
const mockIO = new MockIO()
otService.init(mockIO as any)

describe('OTService 并发处理', () => {
  // 每个测试前：
  // 1. 清空 mockData.operationLogs（避免 clear-all 等历史 op 污染后续测试的 transform 链）
  // 2. 重置 OT 上下文
  beforeEach(() => {
    mockData.operationLogs.length = 0
    otService.resetContext(currentWbId)
  })

  test('单用户连续 add → version 严格递增', async () => {
    const socket = new MockSocket()
    mockIO.joinRoom(socket, 'whiteboard:wb-test')

    const r1 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'el-1' } } }),
      socket as any,
      'user-A'
    )
    const r2 = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'add',
        payload: { element: { id: 'el-2' } },
        baseVersion: r1.currentVersion,
        lamportClock: 10,
      }),
      socket as any,
      'user-A'
    )
    const r3 = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'add',
        payload: { element: { id: 'el-3' } },
        baseVersion: r2.currentVersion,
        lamportClock: 11,
      }),
      socket as any,
      'user-A'
    )

    assertTrue(r1.currentVersion < r2.currentVersion)
    assertTrue(r2.currentVersion < r3.currentVersion)
    assertEqual(r1.currentVersion + 2, r3.currentVersion)
  })

  test('两用户并发 update 同一元素 → 走 transform 路径', async () => {
    // 准备：先 add 一个元素
    const sock0 = new MockSocket()
    mockIO.joinRoom(sock0, 'whiteboard:wb-test')
    const r0 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'shared', x: 0, y: 0 } }, lamportClock: 1 }),
      sock0 as any,
      'A'
    )

    // user-A 和 user-B 同时基于 version 1 改 x
    const sockA = new MockSocket()
    const sockB = new MockSocket()
    mockIO.joinRoom(sockA, 'whiteboard:wb-test')
    mockIO.joinRoom(sockB, 'whiteboard:wb-test')

    // 顺序：A 先发送，B 后到（版本落后）
    const rA = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'update',
        userId: 'A',
        payload: { id: 'shared', updates: { x: 50 } },
        baseVersion: r0.currentVersion,
        lamportClock: 2,
      }),
      sockA as any,
      'A'
    )
    // B 仍引用 baseVersion=r0.currentVersion（不知道 A 已应用）
    const rB = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'update',
        userId: 'B',
        payload: { id: 'shared', updates: { x: 999 } },
        baseVersion: r0.currentVersion, // 落后！
        lamportClock: 3,
      }),
      sockB as any,
      'B'
    )
    // B 的 op 应该被 transform（lamport 3 > 2，B 胜出）
    assertTrue(rB.applied)
    assertTrue(rB.transformed, 'B op should be transformed (baseVersion lagged)')
    assertTrue(rB.currentVersion > rA.currentVersion)
  })

  test('delete 与 update 冲突 → update 被 transform 丢弃', async () => {
    const sock0 = new MockSocket()
    mockIO.joinRoom(sock0, 'whiteboard:wb-test')

    // 准备：加一个元素
    const r0 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'to-be-deleted', x: 0 } }, lamportClock: 1 }),
      sock0 as any,
      'A'
    )

    // user-A delete
    const sockA = new MockSocket()
    mockIO.joinRoom(sockA, 'whiteboard:wb-test')
    const rA = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'delete',
        userId: 'A',
        payload: { id: 'to-be-deleted' },
        baseVersion: r0.currentVersion,
        lamportClock: 2,
      }),
      sockA as any,
      'A'
    )
    assertTrue(rA.applied)

    // user-B 在 r0 版本上 update（应该被 transform 丢弃）
    const sockB = new MockSocket()
    mockIO.joinRoom(sockB, 'whiteboard:wb-test')
    const rB = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'update',
        userId: 'B',
        payload: { id: 'to-be-deleted', updates: { x: 100 } },
        baseVersion: r0.currentVersion, // 落后于 A 的 delete
        lamportClock: 3,
      }),
      sockB as any,
      'B'
    )
    assertFalse(rB.applied, 'update after delete should be dropped')
    assertTrue(rB.becameNoop, 'update should be marked noop')
  })

  test('乱序到达 → op 被缓冲', async () => {
    const sock0 = new MockSocket()
    mockIO.joinRoom(sock0, 'whiteboard:wb-test')

    // 准备：基线
    const r0 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'base', x: 0 } }, lamportClock: 1 }),
      sock0 as any,
      'A'
    )

    const sock1 = new MockSocket()
    mockIO.joinRoom(sock1, 'whiteboard:wb-test')

    // user-A 跳着发：baseVersion=10（比 currentVersion 大）→ 乱序
    const r1 = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'add',
        userId: 'A',
        payload: { element: { id: 'out-of-order', x: 0 } },
        baseVersion: r0.currentVersion + 10, // 乱序
        lamportClock: 2,
      }),
      sock1 as any,
      'A'
    )
    assertFalse(r1.applied, 'out-of-order op should be buffered, not applied')
    assertTrue(r1.buffered, 'should be marked as buffered')
  })

  test('Lamport 顺序：两个 op 不同 lamport 时，较高 lamport 的 op 胜出', async () => {
    const sock0 = new MockSocket()
    mockIO.joinRoom(sock0, 'whiteboard:wb-test')

    // 准备：加一个元素
    const r0 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'lamport-test', x: 0 } }, lamportClock: 1 }),
      sock0 as any,
      'A'
    )

    // user-A lamport=5 update fill
    const sockA = new MockSocket()
    mockIO.joinRoom(sockA, 'whiteboard:wb-test')
    await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'update',
        userId: 'A',
        payload: { id: 'lamport-test', updates: { fill: 'red' } },
        baseVersion: r0.currentVersion,
        lamportClock: 5,
      }),
      sockA as any,
      'A'
    )

    // user-B lamport=10 update fill (B 胜出)
    const sockB = new MockSocket()
    mockIO.joinRoom(sockB, 'whiteboard:wb-test')
    const rB = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'update',
        userId: 'B',
        payload: { id: 'lamport-test', updates: { fill: 'blue' } },
        baseVersion: r0.currentVersion, // 落后于 A
        lamportClock: 10,
      }),
      sockB as any,
      'B'
    )
    assertTrue(rB.applied)
    assertTrue(rB.transformed, 'B with higher lamport should win via transform')
  })

  test('clear-all 后所有 op → noop', async () => {
    const sock0 = new MockSocket()
    mockIO.joinRoom(sock0, 'whiteboard:wb-test')

    const r0 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'a', x: 0 } }, lamportClock: 1 }),
      sock0 as any,
      'A'
    )

    // clear-all
    await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'clear-all', baseVersion: r0.currentVersion, lamportClock: 2 }),
      sock0 as any,
      'A'
    )

    // 在 r0 版本上的 add 应该被 transform 丢弃
    const r1 = await otService.applyOp(
      'wb-test',
      makeOp({
        opType: 'add',
        payload: { element: { id: 'b', x: 0 } },
        baseVersion: r0.currentVersion, // 落后
        lamportClock: 3,
      }),
      sock0 as any,
      'A'
    )
    assertTrue(r1.becameNoop, 'add after clear-all should be noop')
  })

  test('广播：每次成功 op 后，room 内所有 socket 收到 element-op 事件', async () => {
    const sockA = new MockSocket()
    const sockB = new MockSocket()
    mockIO.joinRoom(sockA, 'whiteboard:wb-test')
    mockIO.joinRoom(sockB, 'whiteboard:wb-test')

    await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'broadcast-test', x: 0 } }, lamportClock: 1 }),
      sockA as any,
      'A'
    )

    // 两个 socket 都应收到广播
    const aEvents = sockA.emitted.filter((e) => e.event === 'element-op')
    const bEvents = sockB.emitted.filter((e) => e.event === 'element-op')
    assertTrue(aEvents.length >= 1, 'A should receive broadcast')
    assertTrue(bEvents.length >= 1, 'B should receive broadcast')
  })

  test('并发 add 同一 id → 后到者因重复被 dedup 但 version 仍递增', async () => {
    const sockA = new MockSocket()
    const sockB = new MockSocket()
    mockIO.joinRoom(sockA, 'whiteboard:wb-test')
    mockIO.joinRoom(sockB, 'whiteboard:wb-test')

    // user-A 先加
    const r1 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', userId: 'A', payload: { element: { id: 'dup', x: 0 } }, lamportClock: 1 }),
      sockA as any,
      'A'
    )
    // user-B 后加（同一 id）— applyOpToElements 会去重，version 仍递增
    const r2 = await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', userId: 'B', payload: { element: { id: 'dup', x: 0 } }, baseVersion: r1.currentVersion, lamportClock: 2 }),
      sockB as any,
      'B'
    )
    assertTrue(r2.applied, 'second add still applied (deduped by id)')
    assertTrue(r2.currentVersion > r1.currentVersion)
  })

  test('操作日志：每次成功 op 后写入 operationLogs', async () => {
    const before = mockData.operationLogs.length
    const sock = new MockSocket()
    mockIO.joinRoom(sock, 'whiteboard:wb-test')
    await otService.applyOp(
      'wb-test',
      makeOp({ opType: 'add', payload: { element: { id: 'log-test', x: 0 } }, lamportClock: 1 }),
      sock as any,
      'A'
    )
    const after = mockData.operationLogs.length
    assertTrue(after > before, 'log should be written')
    const log = mockData.operationLogs.find((l) => l.opType === 'add' && (l.payload as any)?.element?.id === 'log-test')
    assertTrue(log, 'log entry should exist with correct payload')
  })
})

// ========== 总结 ==========

// 等待所有测试完成（包括 200ms 缓冲刷新等异步副作用）后再打印结果
;(async () => {
  await Promise.all(allTests)
  // 给 buffer flush 定时器留出 250ms 触发窗口，避免未处理的 unhandledRejection
  await new Promise((r) => setTimeout(r, 250))

  console.log(`\n\x1b[1m=========================\x1b[0m`)
  console.log(`\x1b[1m  Total: ${pass + fail}\x1b[0m`)
  console.log(`  \x1b[32mPassed: ${pass}\x1b[0m`)
  console.log(`  \x1b[31mFailed: ${fail}\x1b[0m`)
  if (failures.length > 0) {
    console.log(`\n\x1b[1m\x1b[31mFailures:\x1b[0m`)
    failures.forEach((f) => {
      console.log(`  - ${f.name}`)
      console.log(`    ${f.err}`)
    })
  }
  console.log(`\x1b[1m=========================\x1b[0m\n`)
  if (fail > 0) process.exit(1)
  // 强制退出，避免 setTimeout 持有进程
  process.exit(0)
})()
