import mongoose, { Document, Schema } from 'mongoose'

export interface Collaborator {
  userId: string
  role: 'owner' | 'editor' | 'viewer'
}

export interface IWhiteboard extends Document {
  shortId: string
  name: string
  ownerId: string
  collaborators: Collaborator[]
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