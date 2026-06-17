/**
 * 工具按钮 UI 组件 (ToolButton)
 *
 * 设计：44×44px 方形按钮，承载单个工具图标的入口。
 * - 默认：透明背景，灰阶图标 (text-gray-700)
 * - hover：浅色背景 + 边框反色 (#F5F5F5)
 * - active / 按下：按下态 (transform)
 * - selected：蓝色背景 + 白色图标 (Figma 风格)
 *
 * 关键设计决策：
 * - 接受 children（SVG 节点）而非 icon prop，保证图标可定制、可着色
 * - 通过 aria-pressed 表达选中态，键盘可访问
 * - 焦点环：focus-visible:ring-2，让键盘用户能看清当前位置
 *
 * 此组件是纯展示组件，无业务状态；选中态由父组件传入。
 */

import { ReactNode, KeyboardEvent } from 'react'

export interface ToolButtonProps {
  /** 是否处于选中态（当前激活的工具） */
  selected?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 鼠标悬停提示 */
  title: string
  /** 快捷键显示文本，例如 "V" */
  shortcut?: string
  /** 点击事件 */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** SVG 图标节点 */
  children: ReactNode
  /** 额外的 className */
  className?: string
  /** ARIA label（覆盖 title） */
  ariaLabel?: string
}

export default function ToolButton({
  selected = false,
  disabled = false,
  title,
  shortcut,
  onClick,
  children,
  className = '',
  ariaLabel,
}: ToolButtonProps) {
  /** 键盘交互：Enter / Space 触发 onClick（保持原生 button 行为） */
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>)
    }
  }

  // 状态化样式
  // - selected：蓝色填充 + 白色图标（最强信号）
  // - 默认 + hover：浅灰背景（hover 仅在未选中时生效，避免与 selected 冲突）
  // - active：active:scale-95，按下时有微缩反馈
  const stateClasses = selected
    ? 'bg-[#0D99FF] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] hover:bg-[#0D8AED]'
    : 'bg-transparent text-[#5F5F5F] hover:bg-[#F0F0F0] active:bg-[#E8E8E8]'

  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      title={shortcut ? `${title} (${shortcut})` : title}
      aria-label={ariaLabel ?? title}
      aria-pressed={selected}
      className={[
        // 尺寸与形状
        'w-11 h-11',
        'rounded-md',
        // 布局
        'inline-flex items-center justify-center',
        'shrink-0',
        // 过渡
        'transition-[background-color,transform,box-shadow] duration-100 ease-out',
        'active:scale-[0.96]',
        // 焦点环（仅键盘可见）
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D99FF] focus-visible:ring-offset-1 focus-visible:ring-offset-white',
        // 状态色
        stateClasses,
        // 禁用态
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}
