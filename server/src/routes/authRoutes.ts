import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User'
import { auth } from '../middleware/auth'
import { validate } from '../middleware/validate'

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
    { field: 'password', required: true, minLength: 6 },
    { field: 'name', required: true, minLength: 1, maxLength: 50 },
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, name } = req.body

      const existingUser = await User.findOne({ email })
      if (existingUser) {
        res.status(409).json({
          success: false,
          error: {
            code: 'EMAIL_TAKEN',
            message: '该邮箱已注册，请直接登录',
          },
        })
        return
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
    } catch (error) {
      next(error)
    }
  }
)

router.post(
  '/login',
  validate([
    { field: 'email', required: true, type: 'email' },
    { field: 'password', required: true, minLength: 6 },
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body

      const user = await User.findOne({ email })
      if (!user) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_ERROR',
            message: 'Invalid email or password',
          },
        })
        return
      }

      const isMatch = await bcrypt.compare(password, user.password)
      if (!isMatch) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_ERROR',
            message: 'Invalid email or password',
          },
        })
        return
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
    } catch (error) {
      next(error)
    }
  }
)

router.get('/me', auth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.userId).select('-password')

    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      })
      return
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
  } catch (error) {
    next(error)
  }
})

export default router