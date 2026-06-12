import api from './api'

export interface LoginData {
  email: string
  password: string
}

export interface RegisterData {
  email: string
  password: string
  name: string
}

export interface User {
  id: string
  email: string
  name: string
  avatar: string
}

export interface AuthResponse {
  success: boolean
  data: {
    token: string
    user: User
  }
}

// 从 axios 错误里把后端的 error.message 提取出来
const extractError = (err: unknown, fallback: string): Error => {
  if (err && typeof err === 'object' && 'response' in err) {
    const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
    const msg = axiosErr.response?.data?.error?.message
    if (msg) return new Error(msg)
  }
  if (err instanceof Error) return err
  return new Error(fallback)
}

export const authService = {
  async login(data: LoginData): Promise<AuthResponse> {
    try {
      const response = await api.post<AuthResponse>('/auth/login', data)
      return response.data
    } catch (err) {
      throw extractError(err, '登录失败')
    }
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      const response = await api.post<AuthResponse>('/auth/register', data)
      return response.data
    } catch (err) {
      throw extractError(err, '注册失败')
    }
  },

  async getMe(): Promise<{ success: boolean; data: { user: User } }> {
    try {
      const response = await api.get('/auth/me')
      return response.data
    } catch (err) {
      throw extractError(err, '获取用户信息失败')
    }
  },
}