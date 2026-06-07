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
    isLoading,
    fetchWhiteboards,
    createWhiteboard,
    deleteWhiteboard,
    joinWhiteboard,
  } = useWhiteboardStore()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')

  const loadWhiteboards = useCallback(() => {
    fetchWhiteboards()
  }, [fetchWhiteboards])

  useEffect(() => {
    loadWhiteboards()
  }, [loadWhiteboards])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setError('')
    try {
      const wb = await createWhiteboard(newName.trim())
      setShowCreateModal(false)
      setNewName('')
      navigate(`/whiteboard/${wb.id}`)
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
      navigate(`/whiteboard/${wb.id}`)
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

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : whiteboards.length === 0 ? (
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
                onClick={() => navigate(`/whiteboard/${wb.id}`)}
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