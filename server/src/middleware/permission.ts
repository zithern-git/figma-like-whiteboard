import { Request, Response, NextFunction } from 'express'
import Whiteboard from '../models/Whiteboard'

export type Role = 'owner' | 'editor' | 'viewer'

export const requireRole = (...roles: Role[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const whiteboardId = req.params.id
      const userId = req.user?.userId

      if (!userId) {
        res.status(401).json({
          success: false,
          error: { code: 'AUTH_ERROR', message: 'Authentication required' },
        })
        return
      }

      const whiteboard = await Whiteboard.findById(whiteboardId)

      if (!whiteboard) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      if (whiteboard.ownerId === userId) {
        return next()
      }

      const collaborator = whiteboard.collaborators.find(
        (c: { userId: string; role: string }) => c.userId === userId
      )

      if (!collaborator) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' },
        })
        return
      }

      if (!roles.includes(collaborator.role as Role)) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Requires ${roles.join(' or ')} role`,
          },
        })
        return
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}