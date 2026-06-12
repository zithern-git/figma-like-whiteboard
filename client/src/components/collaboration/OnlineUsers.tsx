/**
 * 在线用户列表组件 (OnlineUsers)
 *
 * Phase 6.3 — 协作客户端
 *
 * 职责：
 * - 显示每个在线用户的头像（首字母 + 颜色圆点）和颜色标识
 * - 顶部展示总人数（"3人正在协作"）
 * - 当前用户置顶 + 标记 "（你）"
 * - 鼠标悬停显示完整用户名（移动端显示 tooltip）
 *
 * 设计：
 * - 纯展示组件，不直接调用 socket
 * - 通过 props 接收 onlineUsers 列表
 * - 颜色用 USER_COLOR_PALETTE 哈希分配（与 useCollaboration 共享）
 */

import { OnlineUser } from '@/hooks/useCollaboration'

interface OnlineUsersProps {
  onlineUsers: OnlineUser[]
  currentUserId?: string
  maxVisible?: number
}

export default function OnlineUsers({
  onlineUsers,
  currentUserId,
  maxVisible = 5,
}: OnlineUsersProps) {
  if (onlineUsers.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/80 backdrop-blur shadow-sm border border-gray-200">
        <span className="text-xs text-gray-500">等待其他用户加入…</span>
      </div>
    )
  }

  // 排序：当前用户置顶
  const sorted = [...onlineUsers].sort((a, b) => {
    if (a.userId === currentUserId) return -1
    if (b.userId === currentUserId) return 1
    return a.name.localeCompare(b.name)
  })

  const visible = sorted.slice(0, maxVisible)
  const overflow = sorted.length - visible.length

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/80 backdrop-blur shadow-sm border border-gray-200">
      {/* 在线人数标签 */}
      <span className="text-xs text-gray-600 font-medium whitespace-nowrap">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 animate-pulse" />
        {sorted.length} 人正在协作
      </span>

      {/* 用户头像堆叠 */}
      <div className="flex items-center -space-x-2">
        {visible.map((user) => {
          const isMe = user.userId === currentUserId
          return (
            <div
              key={user.userId}
              className="relative group"
              title={isMe ? `${user.name}（你）` : user.name}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold border-2 border-white shadow-sm transition-transform group-hover:scale-110 group-hover:z-10"
                style={{ backgroundColor: user.color }}
              >
                {user.name?.[0]?.toUpperCase() || '?'}
              </div>
              {isMe && (
                <span className="absolute -bottom-0.5 -right-0.5 bg-blue-500 text-white text-[8px] px-1 rounded-full border border-white">
                  YOU
                </span>
              )}
            </div>
          )
        })}
        {overflow > 0 && (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-700 text-[10px] font-semibold bg-gray-200 border-2 border-white shadow-sm"
            title={`还有 ${overflow} 人`}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  )
}
