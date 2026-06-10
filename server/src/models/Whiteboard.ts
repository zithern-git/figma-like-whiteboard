import mongoose, { Document, Schema } from 'mongoose'

export interface Collaborator {
  userId: string
  role: 'owner' | 'editor' | 'viewer'
}

/** 画布元素最小结构（6.1 范围内不严格校验） */
export interface CanvasElementShape {
  id: string
  type: string
  [key: string]: unknown
}

export interface IWhiteboard extends Document {
  shortId: string
  name: string
  ownerId: string
  collaborators: Collaborator[]
  /** 画布所有元素（6.1 简化：直接存 MongoDB。6.2 阶段会迁移到 snapshot 模型） */
  elements: CanvasElementShape[]
  deleted: boolean
  currentSnapshotId?: string
  createdAt: Date
  updatedAt: Date
}

const collaboratorSchema = new Schema<Collaborator>({
  userId: { type: String, required: true },
  role: {
    type: String,
    enum: ['owner', 'editor', 'viewer'],
    required: true,
  },
})

const whiteboardSchema = new Schema<IWhiteboard>(
  {
    shortId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerId: {
      type: String,
      required: true,
    },
    collaborators: [collaboratorSchema],
    elements: {
      type: [mongoose.Schema.Types.Mixed] as any,
      default: [],
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    currentSnapshotId: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
)

export default mongoose.model<IWhiteboard>('Whiteboard', whiteboardSchema)