/**
 * 顶部导航栏组件 (Navbar)
 *
 * 设计：48px 高度，白色背景，固定在视口顶部。
 * - 左侧：白板名称 + 返回按钮
 * - 中部：可扩展（留白）
 * - 右侧：缩放控制、元素计数、连接状态、在线用户、撤销/重做
 *
 * 关键设计决策：
 * - 接受外部传入的缩放控制、撤销/重做等回调，保持组件无业务状态
 * - 在线用户和连接状态用 useCollaboration 返回的数据，组件不直接订阅 socket
 * - 工具栏使用 grid 实现响应式：左中右三段
 *
 * 视觉细节：
 * - 底部 1px 边框 (#E5E5E5) 与下方画布分隔
 * - 按钮 hover 状态：浅灰背景，无边框
 * - 缩放百分比使用等宽字体（tabular-nums），避免数字跳动
 */

import { ReactNode } from 'react'

/** 在线用户条目 */
export interface OnlineUser {
  userId: string
  name: string
  color: string
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export interface NavbarProps {
  /** 白板名称（未命名时显示 '未命名白板'） */
  whiteboardName: string
  /** 返回按钮回调 */
  onBack: () => void
  /** 当前缩放比例（1 = 100%） */
  zoom: number
  /** 缩小回调（参数：相对缩放因子，如 0.9） */
  onZoomOut: () => void
  /** 放大回调 */
  onZoomIn: () => void
  /** 重置视口回调（回到 100% 居中） */
  onResetViewport: () => void
  /** 当前元素总数 */
  elementCount: number
  /** 协作连接状态 */
  connectionStatus: ConnectionStatus
  /** 在线用户列表（不含自己） */
  onlineUsers: OnlineUser[]
  /** 撤销按钮回调 */
  onUndo?: () => void
  /** 重做按钮回调 */
  onRedo?: () => void
  /** 是否可撤销（按钮 disabled 状态） */
  canUndo?: boolean
  /** 是否可重做 */
  canRedo?: boolean
  /** 导出 PNG 回调 */
  onExport?: () => void
  /** 额外的右侧操作（插槽） */
  rightExtra?: ReactNode
}

/** 通用细线 SVG 图标（stroke 继承 currentColor） */
type IconProps = { size?: number; className?: string }
const SvgIcon = ({ size = 16, className = '' }: IconProps) => ({
  width: size,
  height: size,
  className,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

/** 缩放控制小节 */
function ZoomControl({ zoom, onZoomOut, onZoomIn, onResetViewport }: {
  zoom: number
  onZoomOut: () => void
  onZoomIn: () => void
  onResetViewport: () => void
}) {
  const pct = Math.round(zoom * 100)
  return (
    <div className="flex items-center h-8 rounded-md border border-[#E5E5E5] overflow-hidden">
      <button
        type="button"
        onClick={onZoomOut}
        className="w-7 h-8 flex items-center justify-center text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors"
        title="缩小"
        aria-label="缩小"
      >
        <svg {...SvgIcon({ size: 14 })}>
          <line x1="4" y1="8" x2="12" y2="8" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onResetViewport}
        className="h-8 px-2 text-[11px] tabular-nums text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors min-w-[52px]"
        title="重置视口 (100%)"
      >
        {pct}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="w-7 h-8 flex items-center justify-center text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors"
        title="放大"
        aria-label="放大"
      >
        <svg {...SvgIcon({ size: 14 })}>
          <line x1="4" y1="8" x2="12" y2="8" />
          <line x1="8" y1="4" x2="8" y2="12" />
        </svg>
      </button>
    </div>
  )
}

/** 撤销/重做按钮组 */
function UndoRedoControl({ onUndo, onRedo, canUndo, canRedo }: {
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}) {
  return (
    <div className="flex items-center h-8 rounded-md border border-[#E5E5E5] overflow-hidden">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="w-8 h-8 flex items-center justify-center text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        title="撤销 (Ctrl+Z)"
        aria-label="撤销"
      >
        <svg {...SvgIcon({ size: 14 })}>
          <path d="M3 7h7a4 4 0 0 1 0 8H7" />
          <polyline points="5 4 2 7 5 10" />
        </svg>
      </button>
      <div className="w-px h-4 bg-[#E5E5E5]" />
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="w-8 h-8 flex items-center justify-center text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        title="重做 (Ctrl+Shift+Z)"
        aria-label="重做"
      >
        <svg {...SvgIcon({ size: 14 })}>
          <path d="M13 7H6a4 4 0 0 0 0 8h3" />
          <polyline points="11 4 14 7 11 10" />
        </svg>
      </button>
    </div>
  )
}

/** 连接状态指示器 */
function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { dot: string; text: string; label: string }> = {
    connected: { dot: 'bg-[#0DCC4A]', text: '已连接', label: '实时协作已连接' },
    connecting: { dot: 'bg-[#FFB800] animate-pulse', text: '连接中', label: '正在连接协作服务' },
    disconnected: { dot: 'bg-[#B3B3B3]', text: '离线', label: '协作未连接' },
  }
  const c = config[status]
  return (
    <div className="flex items-center gap-1.5 h-8 px-2 text-[11px] text-[#5F5F5F]" title={c.label}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      <span className="font-medium">{c.text}</span>
    </div>
  )
}

/** 在线用户头像堆叠 */
function OnlineUsersAvatars({ users }: { users: OnlineUser[] }) {
  if (users.length === 0) return null
  const maxShow = 5
  const visible = users.slice(0, maxShow)
  const overflow = users.length - maxShow
  return (
    <div className="flex items-center -space-x-1.5 ml-1">
      {visible.map((u) => (
        <div
          key={u.userId}
          className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-semibold text-white shadow-sm select-none"
          style={{ backgroundColor: u.color }}
          title={u.name}
        >
          {u.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-6 h-6 rounded-full border-2 border-white bg-[#F0F0F0] flex items-center justify-center text-[10px] font-medium text-[#5F5F5F] shadow-sm select-none">
          +{overflow}
        </div>
      )}
    </div>
  )
}

/** 通用圆形图标按钮（用于工具栏右侧的 icon-only 按钮） */
function IconButton({
  onClick,
  title,
  children,
  disabled,
}: {
  onClick?: () => void
  title: string
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="w-8 h-8 flex items-center justify-center rounded-md text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

export default function Navbar({
  whiteboardName,
  onBack,
  zoom,
  onZoomOut,
  onZoomIn,
  onResetViewport,
  elementCount,
  connectionStatus,
  onlineUsers,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onExport,
  rightExtra,
}: NavbarProps) {
  return (
    <header
      className="h-12 bg-white border-b border-[#E5E5E5] flex items-center px-3 shrink-0 select-none z-10"
      role="banner"
    >
      {/* === 左侧：返回 + 白板名 === */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 h-8 px-2 rounded-md text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors text-[12px] font-medium"
          aria-label="返回白板列表"
        >
          <svg {...SvgIcon({ size: 14 })}>
            <polyline points="10 4 4 8 10 12" />
            <line x1="4" y1="8" x2="14" y2="8" />
          </svg>
          <span>返回</span>
        </button>

        <div className="w-px h-4 bg-[#E5E5E5] mx-1" />

        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-5 h-5 rounded-[5px] bg-gradient-to-br from-[#0D99FF] to-[#7B5CFF] flex items-center justify-center shrink-0"
            aria-hidden
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" />
            </svg>
          </span>
          <h1
            className="text-[13px] font-semibold text-[#1A1A1A] truncate max-w-[280px]"
            title={whiteboardName}
          >
            {whiteboardName}
          </h1>
        </div>
      </div>

      {/* === 右侧：撤销/重做 + 缩放 + 元素数 + 协作 + 导出 === */}
      <div className="flex items-center gap-2 shrink-0">
        <UndoRedoControl
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
        />

        <ZoomControl
          zoom={zoom}
          onZoomOut={onZoomOut}
          onZoomIn={onZoomIn}
          onResetViewport={onResetViewport}
        />

        {onExport && (
          <IconButton onClick={onExport} title="导出 PNG">
            <svg {...SvgIcon({ size: 14 })}>
              <path d="M8 12V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v8" />
              <polyline points="4 10 8 14 12 10" />
              <line x1="8" y1="14" x2="8" y2="20" />
              <line x1="16" y1="20" x2="16" y2="14" />
            </svg>
          </IconButton>
        )}

        {rightExtra}

        <div className="w-px h-5 bg-[#E5E5E5] mx-1" />

        <div className="flex items-center h-8 px-2 text-[11px] text-[#5F5F5F] tabular-nums">
          <span className="font-medium text-[#1A1A1A]">{elementCount}</span>
          <span className="ml-1">个元素</span>
        </div>

        <div className="w-px h-5 bg-[#E5E5E5] mx-1" />

        <ConnectionIndicator status={connectionStatus} />
        <OnlineUsersAvatars users={onlineUsers} />
      </div>
    </header>
  )
}
