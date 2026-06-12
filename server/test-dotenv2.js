// Test dotenv with explicit path
const path = require('path')
const dotenv = require('dotenv')

const envPath = path.join(__dirname, '.env')
console.log('Looking for .env at:', envPath)
const fs = require('fs')
console.log('File exists:', fs.existsSync(envPath))
console.log('File content:')
console.log(fs.readFileSync(envPath, 'utf-8'))
console.log('---')

const r = dotenv.config({ path: envPath, debug: true })
console.log('result:', JSON.stringify(r, null, 2))
console.log('MONGODB_URI =', process.env.MONGODB_URI)
