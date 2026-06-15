/**
 * 快照相关 API 路由 (snapshotRoutes)
 *
 * Phase 6.3 — 历史版本 / 增量恢复
 *
 * 端点：
 * - GET    /api/whiteboards/:id/snapshots           — 列出所有快照
 * - GET    /api/whiteboards/:id/snapshots/:snapshotId — 预览指定快照
 * - POST   /api/whiteboards/:id/rollback            — 回滚到指定快照
 * - POST   /api/whiteboards/:id/snapshots           — 手动触发快照
 *
 * 权限：
 * - 列表 / 预览：owner / editor / viewer
 * - 回滚 / 手动触发：owner / editor（不允许 viewer）
 *
 * 路径参数：`:id` 支持 shortId（6位 nanoid）或 Mongo _id
 *
 * 关键修复（Phase 7）：
 * - 全部异步 handler 用 asyncHandler 包装
 * - 业务错误用 AppError 抛出
 * - 校验中间件：snapshotId 必填且最小长度
 */

import { Router, Request, Response } from 'express'
import mongoose from 'mongoose'
import { auth } from '../middleware/auth'
import { requireRole } from '../middleware/permission'
import { validate } from '../middleware/validate'
import {
  listSnapshots,
  getSnapshot,
  rollbackToSnapshot,
  snapshotWhiteboard,
} from '../services/snapshotService'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import Whiteboard from '../models/Whiteboard'

const router = Router()

router.use(auth)

/** 通过 shortId 或 _id 查找白板（已校验存在性） */
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

// ========== GET /api/whiteboards/:id/snapshots ==========
router.get(
  '/:id/snapshots',
  requireRole('owner', 'editor', 'viewer'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id)
    // requireRole 已校验存在性，但要取 shortId 给 snapshotService 用
    const whiteboard = await findWhiteboardOrFail(id)

    const snapshots = await listSnapshots(whiteboard.shortId)
    res.json({
      success: true,
      data: {
        snapshots,
        total: snapshots.length,
      },
    })
  })
)

// ========== GET /api/whiteboards/:id/snapshots/:snapshotId ==========
router.get(
  '/:id/snapshots/:snapshotId',
  requireRole('owner', 'editor', 'viewer'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, snapshotId } = req.params
    const safeId = String(id)
    const safeSnapshotId = String(snapshotId)
    const whiteboard = await findWhiteboardOrFail(safeId)

    const snapshot = await getSnapshot(whiteboard.shortId, safeSnapshotId)
    if (!snapshot) {
      throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot not found', 404)
    }

    res.json({
      success: true,
      data: snapshot,
    })
  })
)

// ========== POST /api/whiteboards/:id/rollback ==========
router.post(
  '/:id/rollback',
  requireRole('owner', 'editor'),
  validate([
    { field: 'snapshotId', required: true, minLength: 1, maxLength: 64, label: 'Snapshot ID' },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id)
    const { snapshotId } = req.body
    const userId = req.user!.userId

    const whiteboard = await findWhiteboardOrFail(id)

    const ok = await rollbackToSnapshot(whiteboard.shortId, snapshotId, userId)
    if (!ok) {
      throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot not found', 404)
    }

    res.json({
      success: true,
      data: {
        message: 'Rollback completed',
        snapshotId,
        whiteboardId: whiteboard.shortId,
      },
    })
  })
)

// ========== POST /api/whiteboards/:id/snapshots（手动触发快照） ==========
router.post(
  '/:id/snapshots',
  requireRole('owner', 'editor'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id)
    const whiteboard = await findWhiteboardOrFail(id)
    const snapshotId = await snapshotWhiteboard(whiteboard.shortId, 'manual')
    if (!snapshotId) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create snapshot', 500)
    }
    res.status(201).json({
      success: true,
      data: { snapshotId },
    })
  })
)

export default router
