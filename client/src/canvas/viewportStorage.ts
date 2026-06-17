/**
 * 视口状态持久化工具
 *
 * 把 viewport（translateX, translateY, zoom）持久化到 localStorage，
 * 按 whiteboardId 命名空间区分。刷新页面 / 重新进入白板时恢复。
 *
 * 为什么不存到服务端？
 * - viewport 是纯客户端视图状态（不影响协作内容），没必要走服务端
 * - localStorage 读写不阻塞，刷新恢复即时
 * - 不会增加网络请求和数据库压力
 *
 * 节流策略：
 * - 拖动 / 缩放期间每帧都可能调用 setViewport，频繁写 localStorage 会卡顿
 * - 用 rAF 节流：同一帧内多次 setViewport 只写一次
 */

interface Viewport {
  translateX: number
  translateY: number
  zoom: number
}

const STORAGE_KEY_PREFIX = 'whiteboard.viewport.'
const writeQueue = new Map<string, number>()  // whiteboardId -> rAF id
const pendingWrites = new Map<string, Viewport>()  // whiteboardId -> latest viewport

/**
 * 从 localStorage 读取视口
 *
 * @param whiteboardId - 白板 ID
 * @returns 保存的 viewport，若无记录则返回 undefined
 */
export function loadViewport(whiteboardId: string): Viewport | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + whiteboardId)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    // 关键修复：防御性检查字段，localStorage 里的数据可能被人为修改
    if (
      typeof parsed?.translateX === 'number' &&
      typeof parsed?.translateY === 'number' &&
      typeof parsed?.zoom === 'number'
    ) {
      return parsed as Viewport
    }
  } catch {
    // 关键修复：localStorage 可能满了 / 被禁用 / JSON 损坏，全部静默
  }
  return undefined
}

/**
 * 把视口写入 localStorage（rAF 节流）
 *
 * 关键修复：拖动时每帧都可能调用 setViewport（~60fps），
 * 同步写 localStorage 会阻塞主线程引起卡顿。用 requestAnimationFrame
 * 节流后，同一帧内多次调用只会写一次，且写入发生在帧末（不阻塞渲染）。
 *
 * @param whiteboardId - 白板 ID
 * @param viewport - 新的 viewport
 */
export function saveViewport(whiteboardId: string, viewport: Viewport): void {
  pendingWrites.set(whiteboardId, viewport)

  // 关键修复：如果已经排了写入，就不再重复排队（rAF 自然会去取最新值）
  if (writeQueue.has(whiteboardId)) return

  const id = requestAnimationFrame(() => {
    writeQueue.delete(whiteboardId)
    const latest = pendingWrites.get(whiteboardId)
    pendingWrites.delete(whiteboardId)
    if (!latest) return
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + whiteboardId, JSON.stringify(latest))
    } catch {
      // localStorage 满了 / 隐私模式，静默忽略
    }
  })
  writeQueue.set(whiteboardId, id)
}

/**
 * 删除视口记录（重置视口时调用，避免 stale 状态）
 */
export function clearViewport(whiteboardId: string): void {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + whiteboardId)
  } catch {
    // 静默
  }
  pendingWrites.delete(whiteboardId)
  const id = writeQueue.get(whiteboardId)
  if (id !== undefined) {
    cancelAnimationFrame(id)
    writeQueue.delete(whiteboardId)
  }
}
