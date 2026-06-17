/**
 * WebSocket 并发连接压力测试
 *
 * 测试目标：
 * - 100 个 WebSocket 并发连接
 * - CPU < 70%
 * - 内存 < 512MB
 * - 单操作端到端同步延迟 < 100ms (P95)
 * - 操作日志写入延迟 < 50ms (P95)
 */

import { io } from 'socket.io-client'
import { performance } from 'perf_hooks'
import os from 'os'

const API_URL = process.env.API_URL || 'http://localhost:3001'
const WS_URL = process.env.WS_URL || 'http://localhost:3001'
const CLIENT_COUNT = parseInt(process.env.CLIENT_COUNT || '100', 10)
const OPS_PER_CLIENT = parseInt(process.env.OPS_PER_CLIENT || '50', 10)
const TEST_DURATION = parseInt(process.env.TEST_DURATION || '30000', 10)

// 颜色输出
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`

// 获取初始资源使用
function getResourceUsage() {
  const mem = process.memoryUsage()
  return {
    cpuUsage: process.cpuUsage(),
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    external: mem.external,
  }
}

// 格式化字节
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function registerAndGetToken(index) {
  const email = `perf_${Date.now()}_${index}@test.com`
  const password = 'Test123456'
  const name = `PerfUser${index}`

  try {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    if (!res.ok) {
      throw new Error(`Register failed: ${res.status}`)
    }

    const data = await res.json()
    return data.token
  } catch (err) {
    console.error(red(`Client ${index} register failed:`), err.message)
    return null
  }
}

async function createWhiteboard(token) {
  try {
    const res = await fetch(`${API_URL}/api/whiteboards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: `PerfTest-${Date.now()}` }),
    })

    if (!res.ok) throw new Error(`Create whiteboard failed: ${res.status}`)
    const data = await res.json()
    return data.whiteboard?.shortId || data.shortId
  } catch (err) {
    console.error(red('Create whiteboard failed:'), err.message)
    return null
  }
}

async function runLoadTest() {
  console.log(cyan('\n========================================'))
  console.log(cyan('WebSocket 并发连接压力测试'))
  console.log(cyan('========================================'))
  console.log(`并发客户端: ${CLIENT_COUNT}`)
  console.log(`每客户端操作数: ${OPS_PER_CLIENT}`)
  console.log(`测试时长: ${TEST_DURATION}ms`)
  console.log(`目标: CPU<70% 内存<512MB P95延迟<100ms\n`)

  const initialUsage = getResourceUsage()
  const startTime = performance.now()

  // 1. 注册所有用户
  console.log('Step 1: 注册用户...')
  const tokens = []
  for (let i = 0; i < Math.min(CLIENT_COUNT, 10); i++) {
    const token = await registerAndGetToken(i)
    if (token) tokens.push(token)
  }

  if (tokens.length === 0) {
    console.log(red('没有成功注册的用户，测试终止'))
    process.exit(1)
  }

  // 复用 token（模拟同一用户多连接，或创建更多用户）
  while (tokens.length < CLIENT_COUNT) {
    tokens.push(tokens[tokens.length % tokens.length])
  }

  // 2. 创建白板
  console.log('Step 2: 创建测试白板...')
  const whiteboardId = await createWhiteboard(tokens[0])
  if (!whiteboardId) {
    console.log(red('创建白板失败，测试终止'))
    process.exit(1)
  }
  console.log(green(`白板创建成功: ${whiteboardId}`))

  // 3. 建立 WebSocket 连接
  console.log('Step 3: 建立 WebSocket 连接...')
  const clients = []
  const latencies = []
  const opLatencies = []
  const errors = []
  let connectedCount = 0

  for (let i = 0; i < CLIENT_COUNT; i++) {
    const socket = io(WS_URL, {
      auth: { token: tokens[i] },
      transports: ['websocket'],
      reconnection: false,
    })

    clients.push(socket)

    socket.on('connect', () => {
      connectedCount++
      socket.emit('join-whiteboard', { whiteboardId })
    })

    socket.on('connect_error', (err) => {
      errors.push({ client: i, error: err.message })
    })

    socket.on('element-op', (op) => {
      if (op._sentAt) {
        const latency = performance.now() - op._sentAt
        latencies.push(latency)
      }
    })

    socket.on('element-op-ack', (ack) => {
      if (ack._sentAt) {
        const latency = performance.now() - ack._sentAt
        opLatencies.push(latency)
      }
    })
  }

  // 等待所有连接建立
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (connectedCount >= CLIENT_COUNT * 0.9) {
        clearInterval(check)
        resolve()
      }
      if (performance.now() - startTime > 30000) {
        clearInterval(check)
        resolve()
      }
    }, 100)
  })

  console.log(green(`成功连接: ${connectedCount}/${CLIENT_COUNT}`))

  // 4. 发送操作
  console.log('Step 4: 发送操作...')
  const opStartTime = performance.now()

  const opPromises = clients.map((socket, idx) => {
    return new Promise((resolve) => {
      let sent = 0
      const sendOp = () => {
        if (sent >= OPS_PER_CLIENT || !socket.connected) {
          resolve()
          return
        }

        const op = {
          clientOpId: `perf-${idx}-${sent}-${Date.now()}`,
          opType: 'add',
          payload: {
            element: {
              id: `el-${idx}-${sent}`,
              type: 'rect',
              x: Math.random() * 800,
              y: Math.random() * 600,
              width: 50 + Math.random() * 100,
              height: 50 + Math.random() * 100,
              fill: '#FF6B6B',
              stroke: '#000000',
              strokeWidth: 2,
            },
          },
          timestamp: Date.now(),
          baseVersion: sent,
          lamportClock: sent + 1,
          _sentAt: performance.now(),
        }

        socket.emit('element-op', { whiteboardId, ...op })
        sent++

        // 随机间隔 10-100ms
        setTimeout(sendOp, 10 + Math.random() * 90)
      }

      sendOp()
    })
  })

  await Promise.all(opPromises)
  const opElapsed = performance.now() - opStartTime

  // 5. 等待同步完成
  console.log('Step 5: 等待同步...')
  await new Promise((r) => setTimeout(r, 2000))

  // 6. 收集资源使用
  const finalUsage = getResourceUsage()
  const cpuDiff = process.cpuUsage(initialUsage.cpuUsage)
  const cpuPercent = ((cpuDiff.user + cpuDiff.system) / 1000 / opElapsed) * 100
  const memDiff = finalUsage.rss - initialUsage.rss

  // 7. 计算延迟统计
  const sortedLatencies = [...latencies].sort((a, b) => a - b)
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0
  const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0
  const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0

  const sortedOpLatencies = [...opLatencies].sort((a, b) => a - b)
  const avgOpLatency = opLatencies.length > 0
    ? opLatencies.reduce((a, b) => a + b, 0) / opLatencies.length
    : 0
  const p95OpLatency = sortedOpLatencies[Math.floor(sortedOpLatencies.length * 0.95)] || 0

  // 8. 断开连接
  console.log('Step 6: 断开连接...')
  clients.forEach((s) => s.disconnect())

  // 9. 输出报告
  const totalOps = CLIENT_COUNT * OPS_PER_CLIENT
  const totalElapsed = performance.now() - startTime

  console.log(cyan('\n========================================'))
  console.log(cyan('测试结果报告'))
  console.log(cyan('========================================'))
  console.log(`总耗时: ${(totalElapsed / 1000).toFixed(2)}s`)
  console.log(`操作耗时: ${(opElapsed / 1000).toFixed(2)}s`)
  console.log(`总操作数: ${totalOps}`)
  console.log(`成功连接: ${connectedCount}/${CLIENT_COUNT}`)
  console.log(`错误数: ${errors.length}`)

  console.log('\n--- 资源使用 ---')
  console.log(`CPU 使用率: ${cpuPercent.toFixed(2)}% ${cpuPercent < 70 ? green('✓') : red('✗')}`)
  console.log(`内存增量: ${formatBytes(memDiff)}`)
  console.log(`最终 RSS: ${formatBytes(finalUsage.rss)} ${finalUsage.rss < 512 * 1024 * 1024 ? green('✓') : red('✗')}`)

  console.log('\n--- 端到端同步延迟 ---')
  console.log(`平均延迟: ${avgLatency.toFixed(2)}ms`)
  console.log(`P95 延迟: ${p95Latency.toFixed(2)}ms ${p95Latency < 100 ? green('✓') : red('✗')}`)
  console.log(`P99 延迟: ${p99Latency.toFixed(2)}ms`)
  console.log(`样本数: ${latencies.length}`)

  console.log('\n--- 操作日志写入延迟 ---')
  console.log(`平均延迟: ${avgOpLatency.toFixed(2)}ms`)
  console.log(`P95 延迟: ${p95OpLatency.toFixed(2)}ms ${p95OpLatency < 50 ? green('✓') : red('✗')}`)
  console.log(`样本数: ${opLatencies.length}`)

  console.log('\n--- 吞吐量 ---')
  console.log(`操作吞吐量: ${(totalOps / (opElapsed / 1000)).toFixed(2)} ops/s`)

  // 10. 判定是否通过
  const passed =
    cpuPercent < 70 &&
    finalUsage.rss < 512 * 1024 * 1024 &&
    p95Latency < 100 &&
    p95OpLatency < 50

  console.log(cyan('\n========================================'))
  if (passed) {
    console.log(green('🎉 所有性能指标通过！'))
  } else {
    console.log(yellow('⚠️ 部分性能指标未达标'))
  }
  console.log(cyan('========================================\n'))

  process.exit(passed ? 0 : 1)
}

runLoadTest().catch((err) => {
  console.error(red('测试失败:'), err)
  process.exit(1)
})
