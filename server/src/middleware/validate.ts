/**
 * 请求参数校验中间件 (validate)
 *
 * 关键修复：
 * - 校验失败通过 next(err) 走统一 errorHandler（不再 res.json 直返）
 * - 支持必填、类型、长度、范围、邮箱、枚举等规则
 * - 校验失败时 VALIDATION_ERROR 包含 details.{ field: reason }，前端可定位字段
 * - 支持自定义错误消息（每条规则可覆盖）
 * - 支持嵌套字段（如 'user.name'）
 *
 * 规则类型：
 * - required: 是否必填
 * - type: 'string' | 'number' | 'email' | 'boolean' | 'array' | 'object'
 * - minLength / maxLength: 字符串长度
 * - min / max: 数值范围
 * - enum: 枚举值
 * - pattern: 正则
 * - custom: 自定义校验函数
 *
 * 用法：
 * ```ts
 * router.post('/login', validate([
 *   { field: 'email', required: true, type: 'email' },
 *   { field: 'password', required: true, minLength: 6, maxLength: 64 },
 * ]), handler)
 * ```
 */

import { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'

export type FieldType = 'string' | 'number' | 'email' | 'boolean' | 'array' | 'object'

export interface ValidationRule {
  field: string
  required?: boolean
  type?: FieldType
  /** 字符串最小长度（type=string 时校验字符数，type=array 时校验元素数） */
  minLength?: number
  /** 字符串最大长度 */
  maxLength?: number
  /** 数值最小值（type=number 时） */
  min?: number
  /** 数值最大值 */
  max?: number
  /** 枚举值（白名单） */
  enum?: ReadonlyArray<string | number>
  /** 正则（type=string 时） */
  pattern?: RegExp
  /** 自定义校验（返回 undefined = 通过，返回 string = 错误信息） */
  custom?: (value: unknown, req: Request) => string | undefined
  /** 字段描述，用于错误消息（不传则用 field 本身） */
  label?: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 校验规则数组 → 中间件
 */
export const validate = (rules: ValidationRule[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: Record<string, string> = {}

    for (const rule of rules) {
      const value = getNestedValue(req.body, rule.field)
      const label = rule.label || rule.field

      // 1. 必填检查
      if (rule.required) {
        if (value === undefined || value === null || value === '') {
          errors[rule.field] = `${label} is required`
          continue
        }
      }

      // 字段不存在且非必填 → 跳过该字段后续校验
      if (value === undefined || value === null) {
        continue
      }

      // 2. 类型校验
      if (rule.type) {
        const typeError = checkType(value, rule.type, label)
        if (typeError) {
          errors[rule.field] = typeError
          continue // 类型不通过则跳过后续
        }
      }

      // 3. 长度校验（字符串 / 数组）
      if (rule.minLength !== undefined) {
        const len = Array.isArray(value) ? value.length : String(value).length
        if (len < rule.minLength) {
          errors[rule.field] = `${label} must be at least ${rule.minLength} characters`
          continue
        }
      }
      if (rule.maxLength !== undefined) {
        const len = Array.isArray(value) ? value.length : String(value).length
        if (len > rule.maxLength) {
          errors[rule.field] = `${label} must be at most ${rule.maxLength} characters`
          continue
        }
      }

      // 4. 数值范围
      if (rule.type === 'number') {
        if (rule.min !== undefined && (value as number) < rule.min) {
          errors[rule.field] = `${label} must be >= ${rule.min}`
          continue
        }
        if (rule.max !== undefined && (value as number) > rule.max) {
          errors[rule.field] = `${label} must be <= ${rule.max}`
          continue
        }
      }

      // 5. 枚举
      if (rule.enum && !rule.enum.includes(value as string | number)) {
        errors[rule.field] = `${label} must be one of: ${rule.enum.join(', ')}`
        continue
      }

      // 6. 正则
      if (rule.pattern && !rule.pattern.test(String(value))) {
        errors[rule.field] = `${label} format is invalid`
        continue
      }

      // 7. 自定义校验
      if (rule.custom) {
        const customError = rule.custom(value, req)
        if (customError) {
          errors[rule.field] = customError
          continue
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      // 关键修复：使用 AppError 走统一错误处理，前端拦截器能正确识别
      next(
        new AppError(
          'VALIDATION_ERROR',
          'Request validation failed',
          400,
          errors
        )
      )
      return
    }

    next()
  }
}

/**
 * 取嵌套字段值（支持 'a.b.c'）
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const keys = path.split('.')
  let cur: unknown = obj
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** 类型校验，返回错误信息或 undefined（通过） */
function checkType(value: unknown, type: FieldType, label: string): string | undefined {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        return `${label} must be a string`
      }
      return undefined
    case 'number':
      // 关键修复：拒绝 NaN 和 Infinity（typeof 是 'number' 但不是有效数值）
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${label} must be a number`
      }
      return undefined
    case 'email':
      if (typeof value !== 'string' || !EMAIL_REGEX.test(value)) {
        return `${label} must be a valid email address`
      }
      return undefined
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `${label} must be a boolean`
      }
      return undefined
    case 'array':
      if (!Array.isArray(value)) {
        return `${label} must be an array`
      }
      return undefined
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `${label} must be an object`
      }
      return undefined
  }
}

/**
 * Mongo ObjectId 校验工具
 *
 * 用法：{ field: 'id', required: true, custom: isMongoId('id') }
 */
export const isMongoId = (label: string = 'id') => {
  return (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) {
      return `${label} must be a valid ObjectId`
    }
    return undefined
  }
}
