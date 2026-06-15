/**
 * 认证相关 API 路由 (authRoutes)
 *
 * 端点：
 * - POST /api/auth/register  注册
 * - POST /api/auth/login     登录
 * - GET  /api/auth/me        当前用户信息
 *
 * 关键修复（Phase 7）：
 * - 全部异步 handler 用 asyncHandler 包装，自动捕获 throw → errorHandler
 * - 业务错误用 AppError 抛出（如 EMAIL_TAKEN、NOT_FOUND）
 * - 校验中间件 use validate()，不再手写字段检查
 */

import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User'
import { auth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { AppError, asyncHandler } from '../middleware/errorHandler'

const router = Router()

const generateToken = (userId: string, email: string): string => {
  const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d'
  return jwt.sign({ userId, email }, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] })
}

router.post(
  '/register',
  validate([
    { field: 'email', required: true, type: 'email' },
    { field: 'password', required: true, minLength: 6, maxLength: 64 },
    { field: 'name', required: true, minLength: 1, maxLength: 50 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, name } = req.body

    const existingUser = await User.findOne({ email })
    if (existingUser) {
      throw new AppError('EMAIL_TAKEN', '该邮箱已注册，请直接登录', 409)
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await User.create({
      email,
      password: hashedPassword,
      name,
    })

    const token = generateToken(String(user._id), user.email)

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        },
      },
    })
  })
)

router.post(
  '/login',
  validate([
    { field: 'email', required: true, type: 'email' },
    { field: 'password', required: true, minLength: 6, maxLength: 64 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      // 关键修复：使用 AppError，message 仍可自定义
      throw new AppError('AUTH_ERROR', 'Invalid email or password', 401)
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      throw new AppError('AUTH_ERROR', 'Invalid email or password', 401)
    }

    const token = generateToken(String(user._id), user.email)

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        },
      },
    })
  })
)

router.get(
  '/me',
  auth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await User.findById(req.user?.userId).select('-password')

    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404)
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        },
      },
    })
  })
)

export default router
