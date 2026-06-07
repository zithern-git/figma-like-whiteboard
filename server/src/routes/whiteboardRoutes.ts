import { Router, Request, Response, NextFunction } from 'express'
import { nanoid } from 'nanoid'
import Whiteboard from '../models/Whiteboard'
import { auth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { requireRole } from '../middleware/permission'

const router = Router()

router.use(auth)

router.post(
  '/',
  validate([{ field: 'name', required: true, minLength: 1, maxLength: 100 }]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body
      const userId = req.user!.userId

      const shortId = nanoid(6)
      const whiteboard = await Whiteboard.create({
        shortId,
        name,
        ownerId: userId,
        collaborators: [{ userId, role: 'owner' }],
      })

      res.status(201).json({
        success: true,
        data: {
          id: whiteboard._id,
          shortId: whiteboard.shortId,
          name: whiteboard.name,
          ownerId: whiteboard.ownerId,
          collaborators: whiteboard.collaborators,
          createdAt: whiteboard.createdAt,
          updatedAt: whiteboard.updatedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId

    const whiteboards = await Whiteboard.find({
      deleted: false,
      $or: [{ ownerId: userId }, { 'collaborators.userId': userId }],
    }).sort({ updatedAt: -1 })

    res.json({
      success: true,
      data: whiteboards.map((wb) => ({
        id: wb._id,
        shortId: wb.shortId,
        name: wb.name,
        ownerId: wb.ownerId,
        collaborators: wb.collaborators,
        createdAt: wb.createdAt,
        updatedAt: wb.updatedAt,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get(
  '/:id',
  requireRole('owner', 'editor', 'viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const whiteboard = await Whiteboard.findById(req.params.id)

      if (!whiteboard || whiteboard.deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      res.json({
        success: true,
        data: {
          id: whiteboard._id,
          shortId: whiteboard.shortId,
          name: whiteboard.name,
          ownerId: whiteboard.ownerId,
          collaborators: whiteboard.collaborators,
          createdAt: whiteboard.createdAt,
          updatedAt: whiteboard.updatedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

router.delete(
  '/:id',
  requireRole('owner'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const whiteboard = await Whiteboard.findById(req.params.id)

      if (!whiteboard || whiteboard.deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      whiteboard.deleted = true
      await whiteboard.save()

      res.json({
        success: true,
        data: { message: 'Whiteboard deleted' },
      })
    } catch (error) {
      next(error)
    }
  }
)

router.post(
  '/:id/join',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { shortId } = req.body
      const userId = req.user!.userId

      const whiteboard = await Whiteboard.findOne({
        shortId,
        deleted: false,
      })

      if (!whiteboard) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      const existingCollaborator = whiteboard.collaborators.find(
        (c: { userId: string; role: string }) => c.userId === userId
      )

      if (!existingCollaborator) {
        whiteboard.collaborators.push({ userId, role: 'editor' })
        await whiteboard.save()
      }

      res.json({
        success: true,
        data: {
          id: whiteboard._id,
          shortId: whiteboard.shortId,
          name: whiteboard.name,
          ownerId: whiteboard.ownerId,
          collaborators: whiteboard.collaborators,
          createdAt: whiteboard.createdAt,
          updatedAt: whiteboard.updatedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

export default router