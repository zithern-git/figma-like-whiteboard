/**
 * 连接状态指示器组件 (ConnectionStatus)
 *
 * Phase 6.3 — 协作客户端
 *
 * 职责：
 * - 在工具栏附近显示当前 socket 连接状态
 * - 绿色圆点：已连接（无文字 / "在线"）
 * - 黄色圆点：重连中 + "连接断开，正在重连..." 文字
 * - 红色圆点：连接失败
 *
 * 设计：
 * - 紧凑型：默认仅显示圆点；hover 展开 tooltip
 * - 显式型：alwaysExpanded=true 时一直显示文字
 */

import type { ConnectionStatus } from '@/services/socket'

interface ConnectionStatusProps {
  status: ConnectionStatus
  /** 是否强制显示文字（不 hover 也显示） */
  alwaysExpanded?: boolean
  /** 自定义 className */
  className?: string
}

interface StatusDisplay {
  color: string
  pulse: boolean
  label: string
  description: string
}

const STATUS_MAP: Record<ConnectionStatus, StatusDisplay> = {
  connected: {
    color: 'bg-green-500',
    pulse: true,
    label: '已连接',
    description: '实时同步中',
  },
  connecting: {
    color: 'bg-yellow-500',
    pulse: true,
    label: '连接中',
    description: '正在建立连接',
  },
  reconnecting: {
    color: 'bg-yellow-500',
    pulse: true,
    label: '重连中',
    description: '连接断开，正在重连...',
  },
  disconnected: {
    color: 'bg-red-500',
    pulse: false,
    label: '已断开',
    description: '未连接到协作服务',
  },
  failed: {
    color: 'bg-red-500',
    pulse: false,
    label: '连接失败',
    description: '无法连接到协作服务',
  },
}

export default function ConnectionStatus({
  status,
  alwaysExpanded = false,
  className = '',
}: ConnectionStatusProps) {
  const display = STATUS_MAP[status]

  return (
    <div
      className={`group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/80 backdrop-blur shadow-sm border border-gray-200 cursor-default ${className}`}
      title={display.description}
    >
      <span className="relative inline-flex items-center justify-center">
        <span
          className={`block w-2 h-2 rounded-full ${display.color} ${
            display.pulse ? 'animate-pulse' : ''
          }`}
        />
        {display.pulse && (
          <span
            className={`absolute inline-flex w-2 h-2 rounded-full ${display.color} opacity-75 animate-ping`}
          />
        )}
      </span>
      <span
        className={`text-[11px] font-medium text-gray-700 whitespace-nowrap ${
          alwaysExpanded ? '' : 'hidden group-hover:inline'
        }`}
      >
        {display.label}
      </span>
    </div>
  )
}
