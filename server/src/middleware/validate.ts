import { Request, Response, NextFunction } from 'express'

interface ValidationRule {
  field: string
  required?: boolean
  type?: 'string' | 'number' | 'email'
  minLength?: number
  maxLength?: number
}

export const validate = (rules: ValidationRule[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Record<string, string> = {}

    for (const rule of rules) {
      const value = req.body[rule.field]

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors[rule.field] = `${rule.field} is required`
        continue
      }

      if (value === undefined || value === null) {
        continue
      }

      if (rule.type === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(String(value))) {
          errors[rule.field] = 'Invalid email format'
        }
      }

      if (rule.type === 'number' && typeof value !== 'number') {
        errors[rule.field] = 'Must be a number'
      }

      if (rule.minLength !== undefined && String(value).length < rule.minLength) {
        errors[rule.field] = `Minimum length is ${rule.minLength}`
      }

      if (rule.maxLength !== undefined && String(value).length > rule.maxLength) {
        errors[rule.field] = `Maximum length is ${rule.maxLength}`
      }
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors,
        },
      })
      return
    }

    next()
  }
}