/**
 * E2E 测试：直接用 socket.io-client 模拟客户端验证服务器修复
 *
 * 复现场景：
 * 1. 客户端连接 → join-whiteboard
 * 2. 模拟"重连补发"时序：join 还在 await DB，op 就已经到服务端了
 * 3. 验证：所有 op 都被服务端持久化（不是被 NOT_IN_WHITEBOARD 拒绝）
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
  // 1. 注册 + 登录拿 token
  const testEmail = `race_${Date.now()}@example.com`
  const testPassword = 'Test123456'
  const testName = 'RaceTest'

  const regRes = await fetch(`${SERVER_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
  })
  if (!regRes.ok) {
    throw new Error(`register failed: ${regRes.status}`)
  }
  const regJson = await regRes.json()
  const token = regJson.data.token
  const userId = regJson.data.user.id
  console.log(`[1] registered userId=${userId}`)

  // 2. 创建白板
  const wbRes = await fetch(`${SERVER_URL}/api/whiteboards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'Race Test Board' }),
  })
  if (!wbRes.ok) {
    throw new Error(`create whiteboard failed: ${wbRes.status}`)
  }
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

  socket.on('connect', () => {
    console.log(`[3] socket connected id=${socket.id}`)

    // 模拟重连后的"同一 tick 内 join + 多个 op"场景
    socket.emit('join-whiteboard', { whiteboardId: shortId })

    // 关键：不等 join-whiteboard-ack 到达，立即发 add + 多个 update op
    // 复现"重连补发"时序：join 还在 await DB，op 就已经到服务端了
    socket.emit('element-op', {
      clientOpId: `op-add-A-${Date.now()}`,
      opType: 'add',
      payload: {
        element: {
          id: 'elem-A',
          type: 'rect',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          fill: '#ff0000',
        },
      },
      timestamp: Date.now(),
    })

    socket.emit('element-op', {
      clientOpId: `op-updateA-${Date.now()}`,
      opType: 'update',
      payload: { id: 'elem-A', updates: { x: 200, y: 200 } },
      timestamp: Date.now(),
    })

    socket.emit('element-op', {
      clientOpId: `op-addB-${Date.now()}`,
      opType: 'add',
      payload: {
        element: {
          id: 'elem-B',
          type: 'rect',
          x: 300,
          y: 300,
          width: 60,
          height: 60,
          fill: '#00ff00',
        },
      },
      timestamp: Date.now(),
    })

    socket.emit('element-op', {
      clientOpId: `op-updateB-${Date.now()}`,
      opType: 'update',
      payload: { id: 'elem-B', updates: { x: 400, y: 400 } },
      timestamp: Date.now(),
    })

    console.log('[3] sent 4 ops in same tick after join')
  })

  socket.on('join-whiteboard-ack', (payload) => {
    console.log(`[4] join-whiteboard-ack received with ${payload.elements?.length || 0} elements`)
  })

  socket.on('error', (err) => {
    opErrors.push(err)
    console.log(`[ERROR] code=${err.code} message=${err.message}`)
  })

  // 4. 等够时间让所有 op 被处理
  await new Promise((r) => setTimeout(r, 3000))

  // 5. 直接查 DB 看持久化结果
  await mongoose.connect(MONGODB_URI)
  const WhiteboardModel = mongoose.model(
    'Whiteboard',
    new mongoose.Schema({}, { strict: false }),
    'whiteboards'
  )
  const wb = await WhiteboardModel.findOne({ shortId })
  console.log(`\n[5] DB state: ${JSON.stringify(wb?.elements)}`)

  // 6. 验证
  console.log('\n=== 验证 ===')
  const elements = wb?.elements || []
  const elemA = elements.find((e) => e.id === 'elem-A')
  const elemB = elements.find((e) => e.id === 'elem-B')

  let allPass = true
  if (!elemA) {
    console.log('❌ elem-A missing')
    allPass = false
  } else {
    if (elemA.x === 200 && elemA.y === 200) {
      console.log(`✅ elem-A at correct position (${elemA.x}, ${elemA.y})`)
    } else {
      console.log(`❌ elem-A wrong position (${elemA.x}, ${elemA.y}), expected (200, 200)`)
      allPass = false
    }
  }
  if (!elemB) {
    console.log('❌ elem-B missing')
    allPass = false
  } else {
    if (elemB.x === 400 && elemB.y === 400) {
      console.log(`✅ elem-B at correct position (${elemB.x}, ${elemB.y})`)
    } else {
      console.log(`❌ elem-B wrong position (${elemB.x}, ${elemB.y}), expected (400, 400)`)
      allPass = false
    }
  }

  const notInWbErrors = opErrors.filter((e) => e.code === 'NOT_IN_WHITEBOARD')
  if (notInWbErrors.length > 0) {
    console.log(`❌ Got ${notInWbErrors.length} NOT_IN_WHITEBOARD errors (race condition not fixed)`)
    allPass = false
  } else {
    console.log('✅ No NOT_IN_WHITEBOARD errors (race condition fixed)')
  }

  console.log(`\n${allPass ? '🎉 修复验证通过！' : '⚠️ 修复验证失败'}`)

  await mongoose.disconnect()
  socket.disconnect()
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('test error:', err)
  process.exit(1)
})
