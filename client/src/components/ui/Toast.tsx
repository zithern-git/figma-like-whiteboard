/**
 * 全局 Toast 组件 (ToastContainer)
 *
 * 显示右上角的浮层通知，订阅 toastStore 自动更新。
 * 应在应用根组件挂载一次（App.tsx 中）。
 *
 * 设计：
 * - 固定定位 top-right 堆叠
 * - 类型决定颜色（success=绿 / error=红 / warning=黄 / info=蓝）
 * - 包含标题图标 + 消息 + 关闭按钮
 * - 入场/离场动画（CSS transition）
 */

import { useToastStore, Toast, ToastType } from '@/stores/toastStore'

/** 类型 → 样式映射 */
const TYPE_STYLES: Record<
  ToastType,
  { bg: string; border: string; icon: string; iconColor: string; title: string }
> = {
  success: {
    bg: 'bg-white',
    border: 'border-l-4 border-green-500',
    icon: '✓',
    iconColor: 'text-green-500',
    title: '成功',
  },
  error: {
    bg: 'bg-white',
    border: 'border-l-4 border-red-500',
    icon: '✕',
    iconColor: 'text-red-500',
    title: '错误',
  },
  warning: {
    bg: 'bg-white',
    border: 'border-l-4 border-yellow-500',
    icon: '⚠',
    iconColor: 'text-yellow-500',
    title: '警告',
  },
  info: {
    bg: 'bg-white',
    border: 'border-l-4 border-blue-500',
    icon: 'ⓘ',
    iconColor: 'text-blue-500',
    title: '提示',
  },
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const style = TYPE_STYLES[toast.type]
  return (
    <div
      role="alert"
      className={`${style.bg} ${style.border} shadow-lg rounded-md px-4 py-3 min-w-[280px] max-w-[420px] flex items-start gap-3 animate-in slide-in-from-right-5`}
      style={{
        animation: 'toast-in 200ms ease-out',
      }}
    >
      <span className={`${style.iconColor} text-lg leading-none mt-0.5 font-bold shrink-0`}>
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-gray-700 mb-0.5">{style.title}</div>
        <div className="text-sm text-gray-600 break-words whitespace-pre-wrap">
          {toast.message}
        </div>
      </div>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0"
        aria-label="关闭通知"
        type="button"
      >
        ×
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)

  if (toasts.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes toast-in {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-auto"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </>
  )
}
