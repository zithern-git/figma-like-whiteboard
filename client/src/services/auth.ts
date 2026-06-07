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

export const authService = {
  async login(data: LoginData): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/login', data)
    return response.data
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/register', data)
    return response.data
  },

  async getMe(): Promise<{ success: boolean; data: { user: User } }> {
    const response = await api.get('/auth/me')
    return response.data
  },
}