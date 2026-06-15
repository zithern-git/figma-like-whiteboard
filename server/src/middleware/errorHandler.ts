/**
 * 统一错误响应中间件 (errorHandler)
 *
 * 所有错误统一格式：{ success: false, error: { code, message, details } }
 *
 * 设计要点：
 * 1. AppError 自定义错误类：业务代码 throw new AppError('NOT_FOUND', '...') 即可
 * 2. asyncHandler 包装器：自动捕获 async route handler 中的 throw
 * 3. 错误码规范化：VALIDATION_ERROR / AUTH_ERROR / NOT_FOUND / FORBIDDEN /
 *    CONFLICT / INTERNAL_ERROR / BAD_REQUEST / EMAIL_TAKEN / OP_REJECTED
 * 4. 生产环境不暴露内部错误细节（500 错误统一返回 'Internal server error'）
 * 5. 404 由 404 handler 负责（前置中间件）
 * 6. 异步错误自动识别（Promise rejection 自动 next）
 *
 * 用法：
 * ```ts
 * router.get('/xxx', auth, asyncHandler(async (req, res) => {
 *   if (!something) throw new AppError('NOT_FOUND', 'xxx not found', 404)
 *   const data = await SomeModel.find()
 *   res.json({ success: true, data })
 * }))
 * ```
 */

import { Request, Response, NextFunction } from 'express'

/** 业务错误码 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST'
  | 'EMAIL_TAKEN'
  | 'OP_REJECTED'
  | 'SNAPSHOT_NOT_FOUND'
  | 'NOT_IN_WHITEBOARD'
  | 'EMAIL_ALREADY_REGISTERED'

/**
 * 业务错误类
 *
 * 路由 handler 里 throw new AppError('NOT_FOUND', 'xxx not found', 404)
 * 即可生成标准错误响应。
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly details?: Record<string, unknown>
  public readonly expose: boolean

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 400,
    details?: Record<string, unknown>,
    expose: boolean = true
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
    // expose: false 用于内部错误（如数据库连接失败），生产环境不返回 message
    this.expose = expose
    // 修复 prototype chain（TypeScript extends Error 的标准修复）
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

/**
 * 异步 handler 包装器
 *
 * 自动捕获 async (req, res) => {} 中 throw 的错误，转交给 errorHandler。
 * Express 5 已原生支持 async 错误捕获，但 Express 4 需要这个包装。
 * 这里保留包装以兼容两个版本。
 */
export const asyncHandler = <T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: T, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/** 统一错误响应格式 */
interface ErrorResponseBody {
  success: false
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown>
    /** 仅开发环境返回：原始错误 stack，便于调试 */
    stack?: string
  }
}

/**
 * Express 错误处理中间件
 *
 * 签名必须是 4 个参数（Express 靠参数数量识别 error handler）
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  // 1. 提取错误信息
  let statusCode = 500
  let code: ErrorCode = 'INTERNAL_ERROR'
  let message = 'Internal server error'
  let details: Record<string, unknown> | undefined
  let expose = false

  if (err instanceof AppError) {
    statusCode = err.statusCode
    code = err.code
    message = err.message
    details = err.details
    expose = err.expose
  } else if (err instanceof Error) {
    // 未知错误（程序 bug、未捕获的 promise rejection 等）
    message = err.message || 'Internal server error'
  }

  // 2. 生产环境不暴露内部错误
  const isProd = process.env.NODE_ENV === 'production'
  const finalMessage = isProd && statusCode >= 500 && !expose
    ? 'Internal server error'
    : message

  // 3. 服务端日志（生产环境应当接入日志系统）
  if (statusCode >= 500) {
    console.error('[errorHandler]', {
      code,
      statusCode,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
  }

  // 4. 构造响应体
  const body: ErrorResponseBody = {
    success: false,
    error: {
      code,
      message: finalMessage,
    },
  }
  if (details) {
    body.error.details = details
  }
  // 开发环境附带 stack 方便调试
  if (!isProd && err instanceof Error && err.stack) {
    body.error.stack = err.stack
  }

  res.status(statusCode).json(body)
}

/**
 * 404 处理中间件（挂在所有路由之后）
 *
 * 关键修复：使用 AppError 走统一格式，避免在 404 路径上手写响应
 */
export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new AppError('NOT_FOUND', 'API endpoint not found', 404))
}
