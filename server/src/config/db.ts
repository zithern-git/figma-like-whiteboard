import mongoose from 'mongoose'

const connectDB = async (): Promise<void> => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whiteboard'
    await mongoose.connect(uri)
    console.log('MongoDB connected successfully')
  } catch (error) {
    console.warn('MongoDB connection failed, using in-memory mode')
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    const mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    await mongoose.connect(uri)
    console.log('MongoDB in-memory server started')
  }
}

export default connectDB
