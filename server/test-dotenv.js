// Test dotenv behavior
const dotenv = require('dotenv')
console.log('dotenv version:', require('dotenv/package.json').version)
console.log('before config, MONGODB_URI =', process.env.MONGODB_URI)
const r = dotenv.config({ debug: true })
console.log('result:', JSON.stringify(r, null, 2))
console.log('after config, MONGODB_URI =', process.env.MONGODB_URI)
console.log('after config, REDIS_URL =', process.env.REDIS_URL)
console.log('after config, PORT =', process.env.PORT)
