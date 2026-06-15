/**
 * 全局 Toast 状态管理 (toastStore)
 *
 * 使用 Zustand 管理 toast 队列，提供：
 * - success / error / warning / info 四种类型
 * - 自动消失（默认 3s）
 * - 手动关闭
 * - 全局唯一 store，任意组件可直接调用
 */

import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  /** 自动消失的毫秒数；传 0 表示不自动消失 */
  duration: number
}

interface ToastState {
  toasts: Toast[]
  /** 新增 toast，返回 toast id */
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string
  /** 手动移除指定 id 的 toast */
  remove: (id: string) => void
  /** 清空所有 toast */
  clear: () => void
}

let toastSeq = 0
const genId = (): string => `toast-${Date.now()}-${++toastSeq}`

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = genId()
    const duration = toast.duration ?? 3000
    const item: Toast = {
      id,
      type: toast.type,
      message: toast.message,
      duration,
    }
    set((s) => ({ toasts: [...s.toasts, item] }))

    if (duration > 0) {
      setTimeout(() => {
        // 可能已经被手动移除，find 检查
        if (get().toasts.some((t) => t.id === id)) {
          get().remove(id)
        }
      }, duration)
    }

    return id
  },

  remove: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  clear: () => {
    set({ toasts: [] })
  },
}))

/**
 * 便捷调用：直接传入类型和消息
 * 用法：toast.success('保存成功')
 */
export const toast = {
  success: (message: string, duration?: number): string =>
    useToastStore.getState().push({ type: 'success', message, ...(duration !== undefined ? { duration } : {}) }),
  error: (message: string, duration?: number): string =>
    useToastStore.getState().push({ type: 'error', message, ...(duration !== undefined ? { duration } : {}) }),
  warning: (message: string, duration?: number): string =>
    useToastStore.getState().push({ type: 'warning', message, ...(duration !== undefined ? { duration } : {}) }),
  info: (message: string, duration?: number): string =>
    useToastStore.getState().push({ type: 'info', message, ...(duration !== undefined ? { duration } : {}) }),
}
