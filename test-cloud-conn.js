// Test MongoDB and Redis connectivity to cloud server
const net = require('net')

function tcpTest(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = new net.Socket()
    let done = false
    const finish = (ok, info) => {
      if (done) return
      done = true
      try { sock.destroy() } catch {}
      resolve({ ok, ms: Date.now() - start, ...info })
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true, { msg: 'TCP connected (service may or may not respond to protocol)' }))
    sock.once('timeout', () => finish(false, { msg: 'timeout' }))
    sock.once('error', (e) => finish(false, { msg: e.code || e.message }))
    sock.connect(port, host)
  })
}

;(async () => {
  console.log('TCP 27017:', await tcpTest('8.138.101.146', 27017))
  console.log('TCP 6379:', await tcpTest('8.138.101.146', 6379))
})()
