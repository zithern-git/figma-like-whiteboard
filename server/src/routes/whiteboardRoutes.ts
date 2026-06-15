/**
 * 白板 CRUD API 路由 (whiteboardRoutes)
 *
 * 端点：
 * - POST   /api/whiteboards            创建白板
 * - GET    /api/whiteboards            列出当前用户可访问的白板
 * - GET    /api/whiteboards/:id        详情
 * - DELETE /api/whiteboards/:id        软删除（owner only）
 * - POST   /api/whiteboards/:id/join   通过 shortId 加入
 *
 * 关键修复（Phase 7）：
 * - 全部异步 handler 用 asyncHandler 包装
 * - 业务错误用 AppError（NOT_FOUND / FORBIDDEN / CONFLICT）
 * - 校验中间件：name 必填且长度限制
 */

import { Router, Request, Response } from 'express'
import mongoose from 'mongoose'
import { nanoid } from 'nanoid'
import Whiteboard from '../models/Whiteboard'
import { auth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { requireRole } from '../middleware/permission'
import { AppError, asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.use(auth)

router.post(
  '/',
  validate([
    { field: 'name', required: true, minLength: 1, maxLength: 100, label: 'Whiteboard name' },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
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
  })
)

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
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
  })
)

router.get(
  '/:id',
  requireRole('owner', 'editor', 'viewer'),
  asyncHandler(async (req: Request, res: Response) => {
    // 关键修复：先校验 ID 格式，避免 CastError 走默认 500
    const id = String(req.params.id)
    const whiteboard = await findWhiteboardOrFail(id)

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
  })
)

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id)
    const whiteboard = await findWhiteboardOrFail(id)

    whiteboard.deleted = true
    await whiteboard.save()

    res.json({
      success: true,
      data: { message: 'Whiteboard deleted' },
    })
  })
)

router.post(
  '/:id/join',
  validate([
    { field: 'shortId', required: true, minLength: 6, maxLength: 6, label: 'Short ID' },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const { shortId } = req.body
    const userId = req.user!.userId

    const whiteboard = await Whiteboard.findOne({
      shortId,
      deleted: false,
    })

    if (!whiteboard) {
      throw new AppError('NOT_FOUND', 'Whiteboard not found', 404)
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
  })
)

/** 查找白板（支持 shortId 或 mongo _id），找不到或已删除时抛 NOT_FOUND */
async function findWhiteboardOrFail(id: string) {
  let whiteboard
  if (mongoose.isValidObjectId(id)) {
    whiteboard = await Whiteboard.findById(id)
  } else {
    whiteboard = await Whiteboard.findOne({ shortId: id })
  }
  if (!whiteboard || whiteboard.deleted) {
    throw new AppError('NOT_FOUND', 'Whiteboard not found', 404)
  }
  return whiteboard
}

export default router
