/**
 * React 错误边界 (ErrorBoundary)
 *
 * 捕获子组件树中的未捕获异常，渲染友好错误页面（避免白屏）。
 *
 * 关键设计：
 * - Canvas 渲染错误是发生在 requestAnimationFrame 内的 imperative 代码，
 *   不走 React 错误边界（rAF 是浏览器调度，不在 React 渲染栈上）。
 *   Canvas 内部 rAF 循环已用 try/catch 包裹（见 CanvasRenderer.startRenderLoop），
 *   单帧渲染错误不会让整棵树崩，但 ErrorBoundary 仍兜底 React 组件渲染错误。
 * - 错误状态在 setState 回调中更新，避免 render 阶段抛错
 * - "刷新页面" 按钮调用 location.reload 恢复
 * - 在 componentDidCatch 中 console.error 便于开发调试
 * - 友好提示：使用中文，避免冷冰冰的技术术语
 */

import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 自定义错误页面回退 UI；不传则用内置默认 */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    // 关键修复：在 render 之前同步更新 state，让下一次 render 走 fallback
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 上报 / 日志：开发环境 console.error，生产环境可对接 Sentry
    console.error('[ErrorBoundary] 捕获到子组件树错误:', error, info)
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return <DefaultErrorFallback error={this.state.error} onReload={this.handleReload} onReset={this.reset} />
    }

    return this.props.children
  }

  handleReload = (): void => {
    // 刷新整个页面，恢复到干净状态
    window.location.reload()
  }
}

/** 默认错误回退 UI */
function DefaultErrorFallback({
  error,
  onReload,
  onReset,
}: {
  error: Error
  onReload: () => void
  onReset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        {/* 错误图标 */}
        <div className="mx-auto w-16 h-16 mb-4 flex items-center justify-center bg-red-100 rounded-full">
          <span className="text-red-500 text-3xl" aria-hidden="true">
            ⚠
          </span>
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          页面出错了
        </h1>
        <p className="text-sm text-gray-600 mb-4">
          应用发生了意外错误。请刷新页面重试，问题可自行解决。
        </p>

        {/* 错误详情（开发模式可见） */}
        {import.meta.env.DEV && (
          <details className="mb-4 text-left">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
              查看错误详情（仅开发环境）
            </summary>
            <pre className="mt-2 p-3 bg-gray-50 rounded text-xs text-red-600 overflow-auto max-h-40">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}

        <div className="flex gap-2 justify-center">
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            type="button"
          >
            重试
          </button>
          <button
            onClick={onReload}
            className="px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
            type="button"
          >
            刷新页面
          </button>
        </div>
      </div>
    </div>
  )
}

export default ErrorBoundary
