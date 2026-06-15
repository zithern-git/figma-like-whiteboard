/**
 * 角色权限中间件 (requireRole)
 *
 * 关键修复（Phase 7）：
 * - 失败通过 next(err) 走统一 errorHandler
 * - 使用 AppError(AUTH_ERROR / NOT_FOUND / FORBIDDEN) 走统一格式
 */

import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import Whiteboard from '../models/Whiteboard'
import { AppError, asyncHandler } from './errorHandler'

export type Role = 'owner' | 'editor' | 'viewer'

export const requireRole = (...roles: Role[]) => {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const whiteboardId = req.params.id
    const userId = req.user?.userId

    if (!userId) {
      throw new AppError('AUTH_ERROR', 'Authentication required', 401)
    }

    // 关键修复：先校验 ID 格式，避免 CastError 走默认 500
    let whiteboard
    if (mongoose.isValidObjectId(whiteboardId)) {
      whiteboard = await Whiteboard.findById(whiteboardId)
    } else {
      whiteboard = await Whiteboard.findOne({ shortId: whiteboardId })
    }

    if (!whiteboard || whiteboard.deleted) {
      throw new AppError('NOT_FOUND', 'Whiteboard not found', 404)
    }

    if (whiteboard.ownerId === userId) {
      return next()
    }

    const collaborator = whiteboard.collaborators.find(
      (c: { userId: string; role: string }) => c.userId === userId
    )

    if (!collaborator) {
      throw new AppError('FORBIDDEN', 'Access denied', 403)
    }

    if (!roles.includes(collaborator.role as Role)) {
      throw new AppError(
        'FORBIDDEN',
        `Requires ${roles.join(' or ')} role`,
        403
      )
    }

    next()
  })
}
