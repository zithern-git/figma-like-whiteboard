/**
 * JWT 认证中间件 (auth)
 *
 * 关键修复（Phase 7）：
 * - 失败通过 next(err) 走统一 errorHandler（不再 res.json 直返）
 * - 使用 AppError('AUTH_ERROR', ...) 走统一格式
 */

import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AppError } from './errorHandler'

interface JwtPayload {
  userId: string
  email: string
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export const auth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('AUTH_ERROR', 'Authentication required', 401))
  }

  const token = authHeader.split(' ')[1]

  try {
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    const decoded = jwt.verify(token, secret) as JwtPayload
    req.user = decoded
    next()
  } catch {
    next(new AppError('AUTH_ERROR', 'Invalid or expired token', 401))
  }
}
