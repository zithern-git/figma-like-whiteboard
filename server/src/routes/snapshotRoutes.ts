/**
 * 快照相关 API 路由 (snapshotRoutes)
 *
 * Phase 6.3 — 历史版本 / 增量恢复
 *
 * 端点：
 * - GET    /api/whiteboards/:id/snapshots           — 列出所有快照
 * - GET    /api/whiteboards/:id/snapshots/:snapshotId — 预览指定快照
 * - POST   /api/whiteboards/:id/rollback            — 回滚到指定快照
 *
 * 权限：
 * - 列表 / 预览：owner / editor / viewer
 * - 回滚：owner / editor（不允许 viewer 触发回滚）
 *
 * 路径参数：`:id` 支持 shortId（6位 nanoid）或 Mongo _id
 */

import { Router, Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { auth } from '../middleware/auth'
import { requireRole } from '../middleware/permission'
import {
  listSnapshots,
  getSnapshot,
  rollbackToSnapshot,
  snapshotWhiteboard,
} from '../services/snapshotService'

const router = Router()

router.use(auth)

/** 通过 shortId 或 _id 查找白板 */
async function findWhiteboard(id: string) {
  if (mongoose.isValidObjectId(id)) {
    return await mongoose.model('Whiteboard').findById(id)
  }
  return await mongoose.model('Whiteboard').findOne({ shortId: id })
}

// ========== GET /api/whiteboards/:id/snapshots ==========
router.get(
  '/:id/snapshots',
  requireRole('owner', 'editor', 'viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id)
      // requireRole 已校验存在性，但我们要取 shortId 给 snapshotService 用
      const whiteboard: any = await findWhiteboard(id)
      if (!whiteboard || whiteboard.deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      const snapshots = await listSnapshots(whiteboard.shortId)
      res.json({
        success: true,
        data: {
          snapshots,
          total: snapshots.length,
        },
      })
    } catch (err) {
      next(err)
    }
  }
)

// ========== GET /api/whiteboards/:id/snapshots/:snapshotId ==========
router.get(
  '/:id/snapshots/:snapshotId',
  requireRole('owner', 'editor', 'viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id, snapshotId } = req.params
      const safeId = String(id)
      const safeSnapshotId = String(snapshotId)
      const whiteboard: any = await findWhiteboard(safeId)
      if (!whiteboard || whiteboard.deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      const snapshot = await getSnapshot(whiteboard.shortId, safeSnapshotId)
      if (!snapshot) {
        res.status(404).json({
          success: false,
          error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot not found' },
        })
        return
      }

      res.json({
        success: true,
        data: snapshot,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ========== POST /api/whiteboards/:id/rollback ==========
router.post(
  '/:id/rollback',
  requireRole('owner', 'editor'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params
      const safeId = String(id)
      const { snapshotId } = req.body
      const userId = req.user!.userId

      if (!snapshotId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'snapshotId is required' },
        })
        return
      }

      const whiteboard: any = await findWhiteboard(safeId)
      if (!whiteboard || whiteboard.deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }

      const ok = await rollbackToSnapshot(whiteboard.shortId, snapshotId, userId)
      if (!ok) {
        res.status(404).json({
          success: false,
          error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot not found' },
        })
        return
      }

      res.json({
        success: true,
        data: {
          message: 'Rollback completed',
          snapshotId,
          whiteboardId: whiteboard.shortId,
        },
      })
    } catch (err) {
      next(err)
    }
  }
)

// ========== POST /api/whiteboards/:id/snapshots（手动触发快照） ==========
router.post(
  '/:id/snapshots',
  requireRole('owner', 'editor'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params
      const safeId = String(id)
      const whiteboard: any = await findWhiteboard(safeId)
      if (!whiteboard || whiteboard.deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Whiteboard not found' },
        })
        return
      }
      const snapshotId = await snapshotWhiteboard(whiteboard.shortId, 'manual')
      res.status(201).json({
        success: true,
        data: { snapshotId },
      })
    } catch (err) {
      next(err)
    }
  }
)

export default router
