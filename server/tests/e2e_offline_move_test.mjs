/**
 * E2E 测试：模拟"离线移动元素"场景
 *
 * 复现用户报告的问题：
 * - 矩形在 (200, 200)
 * - 断网（disconnect）
 * - 离线状态下拖动到 (650, 240) - 多个 move op
 * - 重连（connect）
 * - 验证：服务器和客户端都应该看到 (650, 240)
 *
 * 用户报告看到 (658, 235) - 与目标位置偏差 (+8, -5)
 */

import { io } from '../../client/node_modules/socket.io-client/build/esm/index.js'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env.test') })

const SERVER_URL = 'http://localhost:3002'
const MONGODB_URI = process.env.MONGODB_URI

async function main() {
  // 1. 注册 + 登录
  const testEmail = `move_${Date.now()}@example.com`
  const testPassword = 'Test123456'
  const testName = 'MoveTest'

  const regRes = await fetch(`${SERVER_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
  })
  const regJson = await regRes.json()
  const token = regJson.data.token
  const userId = regJson.data.user.id
  console.log(`[1] registered userId=${userId}`)

  // 2. 创建白板
  const wbRes = await fetch(`${SERVER_URL}/api/whiteboards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Move Test Board' }),
  })
  const wbJson = await wbRes.json()
  const shortId = wbJson.data.shortId
  console.log(`[2] created whiteboard shortId=${shortId}`)

  // 3. 连接到 socket
  const socket = io(SERVER_URL, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  })

  let opErrors = []
  let serverStateSnapshot = null

  socket.on('connect', () => {
    console.log(`[3] socket connected id=${socket.id}`)
  })

  socket.on('join-whiteboard-ack', (payload) => {
    serverStateSnapshot = payload.elements
    console.log(`[ACK] received with ${payload.elements?.length || 0} elements:`,
      JSON.stringify(payload.elements))
  })

  socket.on('error', (err) => {
    opErrors.push(err)
    console.log(`[ERROR] code=${err.code} message=${err.message}`)
  })

  // 4. 加入白板
  await new Promise((resolve) => {
    socket.once('connect', () => {
      socket.emit('join-whiteboard', { whiteboardId: shortId })
    })
    socket.once('join-whiteboard-ack', () => resolve())
  })
  console.log(`[4] joined whiteboard, server has ${serverStateSnapshot?.length} elements`)

  // 5. 模拟"在线时已经添加了一个矩形"
  await new Promise((resolve) => {
    socket.emit('element-op', {
      clientOpId: `op-add-${Date.now()}`,
      opType: 'add',
      payload: {
        element: {
          id: 'rect-1',
          type: 'rect',
          x: 200,
          y: 200,
          width: 80,
          height: 60,
          fill: '#0000ff',
        },
      },
      timestamp: Date.now(),
    })
    setTimeout(resolve, 500)
  })
  console.log(`[5] added rect-1 at (200, 200)`)

  // 6. 模拟"断网"
  socket.disconnect()
  console.log(`[6] socket disconnected (offline)`)

  // 7. 模拟"离线移动矩形" - 客户端本地状态更新，但 op 会被加到 offlineQueue
  // 模拟拖动过程中产生的多个 mousemove：每个 op 包含绝对的 x, y 值
  // 注意：在客户端实现中，每个 UpdateElementCommand 的 newSnapshot 是
  // { ...current, ...updates, updatedAt: Date.now() }
  // 所以 diff 是绝对的 x, y 值
  const offlineOps = [
    // 第 1 个 mousemove
    {
      clientOpId: `op-move-1-${Date.now()}`,
      opType: 'update',
      payload: { id: 'rect-1', updates: { x: 250, y: 220, updatedAt: Date.now() } },
      timestamp: Date.now(),
    },
    // 第 2 个 mousemove
    {
      clientOpId: `op-move-2-${Date.now() + 1}`,
      opType: 'update',
      payload: { id: 'rect-1', updates: { x: 300, y: 225, updatedAt: Date.now() + 1 } },
      timestamp: Date.now() + 1,
    },
    // 第 3 个 mousemove
    {
      clientOpId: `op-move-3-${Date.now() + 2}`,
      opType: 'update',
      payload: { id: 'rect-1', updates: { x: 400, y: 230, updatedAt: Date.now() + 2 } },
      timestamp: Date.now() + 2,
    },
    // ...更多 mousemove
    {
      clientOpId: `op-move-4-${Date.now() + 3}`,
      opType: 'update',
      payload: { id: 'rect-1', updates: { x: 500, y: 235, updatedAt: Date.now() + 3 } },
      timestamp: Date.now() + 3,
    },
    {
      clientOpId: `op-move-5-${Date.now() + 4}`,
      opType: 'update',
      payload: { id: 'rect-1', updates: { x: 600, y: 238, updatedAt: Date.now() + 4 } },
      timestamp: Date.now() + 4,
    },
    // 最后的 mousemove
    {
      clientOpId: `op-move-final-${Date.now() + 5}`,
      opType: 'update',
      payload: { id: 'rect-1', updates: { x: 650, y: 240, updatedAt: Date.now() + 5 } },
      timestamp: Date.now() + 5,
    },
  ]
  console.log(`[7] generated ${offlineOps.length} offline move ops, final target: (650, 240)`)

  // 8. 模拟"重连"
  await new Promise((resolve) => setTimeout(resolve, 1000))
  socket.connect()
  console.log(`[8] socket reconnected`)

  // 9. 等重连成功，然后发 join-whiteboard + 所有离线 op
  await new Promise((resolve) => {
    socket.once('connect', () => {
      console.log(`[9] connected, emitting join + ${offlineOps.length} offline ops`)
      socket.emit('join-whiteboard', { whiteboardId: shortId })

      // 关键：同一 tick 内发 join + 多个 op
      for (const op of offlineOps) {
        socket.emit('element-op', op)
      }
    })
    socket.once('join-whiteboard-ack', () => resolve())
  })

  // 10. 等够时间让所有 op 处理完
  await new Promise((r) => setTimeout(r, 2000))

  // 11. 直接查 DB
  await mongoose.connect(MONGODB_URI)
  const WhiteboardModel = mongoose.model(
    'Whiteboard',
    new mongoose.Schema({}, { strict: false }),
    'whiteboards'
  )
  const wb = await WhiteboardModel.findOne({ shortId })
  const rect1 = wb?.elements.find((e) => e.id === 'rect-1')
  console.log(`\n[11] DB state for rect-1: ${JSON.stringify(rect1)}`)

  // 12. 验证
  console.log('\n=== 验证 ===')
  let allPass = true

  if (!rect1) {
    console.log('❌ rect-1 missing')
    allPass = false
  } else {
    if (rect1.x === 650 && rect1.y === 240) {
      console.log(`✅ rect-1 at correct position (${rect1.x}, ${rect1.y})`)
    } else {
      console.log(`❌ rect-1 wrong position (${rect1.x}, ${rect1.y}), expected (650, 240)`)
      console.log(`   Deviation: (${rect1.x - 650}, ${rect1.y - 240})`)
      allPass = false
    }
  }

  const notInWbErrors = opErrors.filter((e) => e.code === 'NOT_IN_WHITEBOARD')
  const persistFailed = opErrors.filter((e) => e.code === 'OP_REJECTED')
  if (notInWbErrors.length > 0) {
    console.log(`❌ Got ${notInWbErrors.length} NOT_IN_WHITEBOARD errors`)
    allPass = false
  } else {
    console.log('✅ No NOT_IN_WHITEBOARD errors')
  }
  if (persistFailed.length > 0) {
    console.log(`❌ Got ${persistFailed.length} OP_REJECTED errors: ${JSON.stringify(persistFailed)}`)
    allPass = false
  } else {
    console.log('✅ No OP_REJECTED errors')
  }

  console.log(`\n${allPass ? '🎉 测试通过！' : '⚠️ 测试失败'}`)

  await mongoose.disconnect()
  socket.disconnect()
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('test error:', err)
  process.exit(1)
})
