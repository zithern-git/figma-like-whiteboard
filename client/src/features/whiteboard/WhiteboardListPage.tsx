import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'

export default function WhiteboardListPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const {
    whiteboards,
    fetchWhiteboards,
    createWhiteboard,
    deleteWhiteboard,
    joinWhiteboard,
    setCurrentUserId,
  } = useWhiteboardStore()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  /** 记录刚刚复制了哪个白板码，用于显示"已复制"反馈 */
  const [copiedId, setCopiedId] = useState<string | null>(null)

  /**
   * 复制白板码到剪贴板。复制成功时短暂显示"已复制"反馈（1.5s 后清除）。
   * 必须 e.stopPropagation() 防止冒泡触发卡片点击跳转。
   */
  const handleCopyCode = useCallback(
    async (e: React.MouseEvent, shortId: string, wbId: string) => {
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(shortId)
        setCopiedId(wbId)
        setTimeout(() => setCopiedId(null), 1500)
      } catch {
        // 降级：选中文本让用户手动复制
        const ta = document.createElement('textarea')
        ta.value = shortId
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopiedId(wbId)
        setTimeout(() => setCopiedId(null), 1500)
      }
    },
    []
  )

  useEffect(() => {
    // 关键修复（白板列表刷新闪烁）：
    // 1) setCurrentUserId 同步把 localStorage 缓存里该 userId 的旧列表填进 store，
    //    首帧立刻渲染 grid，不再显示"还没有白板..."。
    // 2) fetchWhiteboards 后台 HTTP 拉最新数据，回调里覆盖缓存。
    // 3) 依赖 user?.id：换账号登录时立刻切到新用户的缓存。
    if (!user?.id) return
    setCurrentUserId(user.id)
    fetchWhiteboards()
  }, [user?.id, setCurrentUserId, fetchWhiteboards])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setError('')
    try {
      const wb = await createWhiteboard(newName.trim())
      setShowCreateModal(false)
      setNewName('')
      // 关键：用 wb.shortId 作 URL 参数（实时协作修复）。
      // 服务端 socket 广播 op 时附带的 whiteboardId 是 shortId（6 位），
      // 客户端 useSocketCollab 里的远端 op 过滤器按
      //   op.whiteboardId !== whiteboardId 丢弃不匹配项。
      // 如果 URL 用 mongo _id，URL 拿到的 id 永远 != 远端 op 的 shortId，
      // **所有远端 op 都被丢**，B 必须刷新后通过 join-whiteboard-ack 全量拉才能看到。
      // 改用 shortId 后 URL id == 服务端广播的 whiteboardId，过滤器全部放行，
      // 真正的实时协作生效。
      //
      // 副作用：localStorage 里按 URL id 命名的缓存（elements / undo / name）
      // 会以 shortId 为 key 重写，旧 mongo _id key 的缓存失效一次。代价：
      // 改完后第一次进入旧白板会从服务端拉一次（毫秒级），无功能损失。
      navigate(`/whiteboard/${wb.shortId}`)
    } catch {
      setError('创建失败，请稍后重试')
    }
  }

  const handleJoin = async () => {
    if (!joinCode.trim()) return
    setError('')
    try {
      const wb = await joinWhiteboard(joinCode.trim())
      setShowJoinModal(false)
      setJoinCode('')
      // 同上：用 shortId 让 socket 远端 op 过滤器放行
      navigate(`/whiteboard/${wb.shortId}`)
    } catch {
      setError('加入失败，请检查白板码是否正确')
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定要删除白板「${name}」吗？`)) return
    try {
      await deleteWhiteboard(id)
    } catch {
      setError('删除失败，请稍后重试')
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">我的白板</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            全部白板 ({whiteboards.length})
          </h2>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setError('')
                setShowJoinModal(true)
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              加入白板
            </button>
            <button
              onClick={() => {
                setError('')
                setShowCreateModal(true)
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              创建白板
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {whiteboards.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">还没有白板，创建一个开始协作吧</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              创建第一个白板
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {whiteboards.map((wb) => (
              <div
                key={wb.id}
                // 关键：用 wb.shortId 作 URL（实时协作修复），同 handleCreate 的注释。
                onClick={() => navigate(`/whiteboard/${wb.shortId}`)}
                className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-medium text-gray-900 truncate flex-1">
                    {wb.name}
                  </h3>
                  {wb.ownerId === user?.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(wb.id, wb.name)
                      }}
                      className="ml-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除白板"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  )}
                </div>
                {/* ========== 白板码 + 一键复制 ========== */}
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-xs text-gray-500">白板码</span>
                  <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-800 tracking-wide select-all">
                    {wb.shortId}
                  </code>
                  <button
                    onClick={(e) => handleCopyCode(e, wb.shortId, wb.id)}
                    className="ml-auto px-2 py-0.5 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors flex items-center gap-1"
                    title="复制白板码"
                  >
                    {copiedId === wb.id ? (
                      <>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        <span>复制</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>
                    {wb.collaborators.length} 人协作
                  </span>
                  <span>·</span>
                  <span>{new Date(wb.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">创建白板</h3>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="白板名称"
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">加入白板</h3>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="输入6位白板码"
              maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowJoinModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleJoin}
                disabled={!joinCode.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                加入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}