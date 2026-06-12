// Real protocol test
const mongoose = require('mongoose')
const { createClient } = require('redis')

;(async () => {
  // MongoDB
  console.log('=== MongoDB 8.138.101.146:27017 ===')
  try {
    await mongoose.connect('mongodb://8.138.101.146:27017/whiteboard', {
      serverSelectionTimeoutMS: 8000,
    })
    console.log('OK connected. dbs:', await mongoose.connection.db.admin().listDatabases())
    await mongoose.disconnect()
  } catch (e) {
    console.log('FAIL:', e.message)
  }

  // Redis
  console.log('=== Redis 8.138.101.146:6379 ===')
  const r = createClient({ url: 'redis://8.138.101.146:6379', socket: { connectTimeout: 8000 } })
  r.on('error', (e) => console.log('redis err event:', e.message))
  try {
    await r.connect()
    const pong = await r.ping()
    console.log('OK ping:', pong)
    await r.set('__test__', 'hello')
    console.log('OK get:', await r.get('__test__'))
    await r.del('__test__')
    await r.quit()
  } catch (e) {
    console.log('FAIL:', e.message)
    try { await r.quit() } catch {}
  }
})()
