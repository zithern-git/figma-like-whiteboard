/**
 * 图片上传 API 路由 (uploadRoutes)
 *
 * 端点：
 * - POST /api/upload    上传图片（multipart/form-data，字段名 'file'）
 *
 * 关键设计：
 * - multer 内存存储（memoryStorage）：避免先落盘再读二次 IO
 *   上传完成后由我们写盘到 public/uploads/，文件名 = nanoid(12) + 扩展名
 * - 文件大小硬上限 10MB（与客户端 useImageUpload 保持一致）
 * - MIME 白名单：image/png / image/jpeg / image/gif / image/webp / image/svg+xml
 * - 认证：必须登录（与白板创建/编辑权限一致）
 * - 静态文件服务：app.ts 挂载 /uploads → public/uploads
 *
 * 响应格式：{ success, data: { url, filename, size, mimetype, width?, height? } }
 * - url 是相对路径（如 /uploads/abc.png），客户端拼接 SERVER_URL 即可
 * - 不做图片二次处理：保持上传原样，避免引入 sharp/jimp 等依赖
 *   客户端 useImageUpload 已对 >10MB 的图自动 JPEG 压缩，所以服务端拿到的图通常 <10MB
 */

import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { auth } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/errorHandler'

const router = Router()

// ============================================================
// 路径 & 目录
// ============================================================

/** 上传目录（与 app.ts 的 express.static 挂载点对应） */
const UPLOAD_DIR = path.resolve(__dirname, '../../public/uploads')

/** 确保目录存在（启动时执行） */
function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}
ensureUploadDir()

// ============================================================
// MIME 白名单 & 大小限制
// ============================================================

const ALLOWED_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

/** 10MB（与客户端 useImageUpload 的 COMPRESS_THRESHOLD_BYTES 一致） */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** MIME → 扩展名映射 */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

// ============================================================
// multer 配置
// ============================================================

const storage = multer.memoryStorage()

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      cb(new AppError('BAD_REQUEST', `不支持的图片格式: ${file.mimetype}`, 400))
      return
    }
    cb(null, true)
  },
})

// ============================================================
// POST /api/upload
// ============================================================

router.post(
  '/',
  auth,
  // 关键修复：multer 错误也走 next(err) → 统一 errorHandler
  // 通过 upload.single('file') 的回调参数（err）传给 errorHandler
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(
              new AppError(
                'BAD_REQUEST',
                `文件大小超过限制（最大 ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB）`,
                413
              )
            )
          }
          return next(new AppError('BAD_REQUEST', `上传失败: ${err.message}`, 400))
        }
        if (err instanceof AppError) return next(err)
        return next(new AppError('BAD_REQUEST', '上传失败', 400))
      }
      next()
    })
  },
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file
    if (!file) {
      throw new AppError('BAD_REQUEST', '未收到文件（字段名需为 file）', 400)
    }

    // 生成唯一文件名：{nanoid}.{ext}
    const ext = MIME_TO_EXT[file.mimetype] || 'bin'
    const filename = `${nanoid(12)}.${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)

    // 写盘
    await fs.promises.writeFile(filepath, file.buffer)

    // 关键修复：返回的 url 是相对路径，客户端根据 SERVER_URL 拼接
    // - 开发：客户端 axios baseURL 是 http://localhost:3000
    // - 生产：客户端用 VITE_API_BASE 拼接
    const url = `/uploads/${filename}`

    res.status(201).json({
      success: true,
      data: {
        url,
        filename,
        size: file.size,
        mimetype: file.mimetype,
      },
    })
  })
)

export default router
