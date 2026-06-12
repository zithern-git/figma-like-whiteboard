import mongoose from 'mongoose'

const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env — refusing to start')
    throw new Error('MONGODB_URI is required')
  }

  try {
    await mongoose.connect(uri)
    console.log('✅ MongoDB connected successfully →', uri.replace(/:[^:@]+@/, ':***@'))
  } catch (error) {
    console.error('❌ MongoDB connection failed:', (error as Error).message)
    console.error('   请检查 MONGODB_URI 是否正确，以及云 MongoDB/SSH 隧道是否可用')
    throw error  // 直接挂掉，不要静默切到内存数据库（会丢数据）
  }
}

export default connectDB
