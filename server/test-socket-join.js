/**
 * 通过 Socket.IO 客户端模拟 join-whiteboard 流程，
 * 验证服务端实际下发的 join-whiteboard-ack 中 elements 是否包含内容。
 */
const { io } = require('socket.io-client')
const jwt = require('jsonwebtoken')

// 拿一个有效 token：直接用 user "test-user" 签一个
// （服务端只验证签名，不查 DB；假设 userId=test-user 已被加为白板成员）
const token = jwt.sign(
  { userId: 'test-user', name: 'Tester' },
  'your-secret-key-change-in-production',
  { expiresIn: '1d' }
)

console.log('Connecting with token...')
const socket = io('http://localhost:3001', {
  path: '/socket.io',
  auth: { token },
  transports: ['websocket'],
})

socket.on('connect', () => {
  console.log('connected, joining whiteboard z7C9YX...')
  socket.emit('join-whiteboard', { whiteboardId: 'z7C9YX' })
})

socket.on('join-whiteboard-ack', (payload) => {
  console.log('=== join-whiteboard-ack ===')
  console.log('elements count:', (payload.elements || []).length)
  console.log('onlineUsers count:', (payload.onlineUsers || []).length)
  console.log('first element:', JSON.stringify((payload.elements || [])[0]))
  console.log('version:', payload.version)
  socket.disconnect()
  process.exit(0)
})

socket.on('error', (err) => {
  console.error('socket error:', err)
  process.exit(1)
})

socket.on('connect_error', (err) => {
  console.error('connect_error:', err.message)
  process.exit(1)
})

setTimeout(() => {
  console.error('timeout - no ack received in 5s')
  process.exit(1)
}, 5000)
