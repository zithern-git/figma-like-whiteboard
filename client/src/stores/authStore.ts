import { create } from 'zustand'
import { authService, User } from '@/services/auth'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const response = await authService.login({ email, password })
    localStorage.setItem('token', response.data.token)
    set({
      user: response.data.user,
      token: response.data.token,
      isAuthenticated: true,
    })
  },

  register: async (email: string, password: string, name: string) => {
    const response = await authService.register({ email, password, name })
    localStorage.setItem('token', response.data.token)
    set({
      user: response.data.user,
      token: response.data.token,
      isAuthenticated: true,
    })
  },

  logout: () => {
    localStorage.removeItem('token')
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    })
  },

  initialize: async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      set({ isLoading: false })
      return
    }

    try {
      const response = await authService.getMe()
      set({
        user: response.data.user,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      localStorage.removeItem('token')
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },
}))