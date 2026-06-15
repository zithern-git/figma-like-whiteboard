/**
 * Axios 客户端 + 响应拦截器重试机制 (api)
 *
 * 关键修复：
 * - 网络错误 / 超时 / 5xx 错误自动重试，最多 3 次
 * - 重试间隔递增：1s → 2s → 4s（指数退避）
 * - 3 次均失败后调用 toast.error 提示用户
 * - 401 错误自动清理登录态并跳转到登录页
 * - 重试的请求不触发多次 toast（只在最终失败时提示）
 *
 * 用法：import api from '@/services/api'
 *   api.get('/xxx') / api.post('/xxx', data)
 *
 * 路由层会在 next() 出错时 throw AppError，统一在拦截器里捕获。
 */

import axios, { AxiosError } from 'axios'
import { toast } from '@/stores/toastStore'

const MAX_RETRY = 3
const BASE_DELAY_MS = 1000

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：自动附加 JWT
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 给 AxiosRequestConfig 加上 retry 标记
declare module 'axios' {
  export interface AxiosRequestConfig {
    retryCount?: number
    /** 标记该请求不触发 toast 提示（默认 false = 触发） */
    silent?: boolean
  }
}

// 响应拦截器：401 处理 + 自动重试 + 最终失败 toast
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const { config, response } = error

    // config 可能为空（请求根本没发出去）
    if (!config) {
      return Promise.reject(error)
    }

    // 401：清理登录态 + 跳登录页（静默，不弹 toast）
    if (response && response.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // 避免在登录页本身重复跳转
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login'
      }
      return Promise.reject(error)
    }

    // 判断是否需要重试：网络错误 / 超时 / 5xx / 408
    const shouldRetry =
      !response ||
      response.status >= 500 ||
      response.status === 408 ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ERR_NETWORK'

    const retryCount = config.retryCount ?? 0

    if (shouldRetry && retryCount < MAX_RETRY) {
      config.retryCount = retryCount + 1
      // 关键修复：递增间隔 1s → 2s → 4s
      const delay = BASE_DELAY_MS * Math.pow(2, retryCount)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return api(config)
    }

    // 走到这里 = 全部重试都失败了，或本身不该重试（如 4xx 业务错误）
    // 提取后端错误信息
    const message = extractErrorMessage(error)

    // silent 请求不弹 toast（调用方自己处理）
    if (!config.silent) {
      toast.error(message)
    }

    return Promise.reject(error)
  }
)

/**
 * 提取后端统一格式的错误信息
 *
 * 后端 errorHandler 格式：{ success: false, error: { code, message, details } }
 */
function extractErrorMessage(err: AxiosError): string {
  // 后端有结构化响应
  const data = err.response?.data as
    | { error?: { message?: string } }
    | undefined
  if (data?.error?.message) {
    return data.error.message
  }

  // 纯网络错误
  if (err.code === 'ECONNABORTED') {
    return '请求超时，请检查网络后重试'
  }
  if (err.code === 'ERR_NETWORK') {
    return '网络异常，请检查连接'
  }

  // HTTP 状态码兜底
  const status = err.response?.status
  if (status && status >= 500) {
    return `服务器错误 (${status})`
  }
  if (status && status >= 400) {
    return `请求失败 (${status})`
  }

  return err.message || '请求失败，请稍后重试'
}

export default api
