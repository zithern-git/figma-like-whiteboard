/**
 * 画布元素持久化工具 (elementsStorage)
 *
 * 把 elements 数组持久化到 localStorage，按 whiteboardId 命名空间区分。
 * 刷新页面时立即从 localStorage 恢复，不需等待 socket / 服务端响应。
 *
 * 关键设计：
 * - 刷新时立即显示本地缓存的元素（零延迟），避免用户看到空白画布
 * - socket join-whiteboard-ack 到达后，如果服务端有更新，则合并/替换
 * - 大画布（>1000 元素）可能超出 localStorage 5MB 限额，用 try/catch 静默失败
 *
 * 节流策略：
 * - 拖动 / 缩放期间每帧都可能更新 elements（~60fps），频繁写 localStorage 会卡顿
 * - 用 rAF 节流：同一帧内多次保存只写一次
 * - 卸载 / 切页面前 flushPendingWrite() 立即写入（防止丢最后一帧）
 *
 * 图片预热：
 * - 图片元素（imageUrl）从 localStorage 恢复时，CanvasRenderer 首次渲染会创建
 *   new Image() + 异步加载，HTTP 请求 + 解码需要几十~几百 ms，期间只能显示
 *   "加载中..."占位符。刷新后用户感知到"图片闪一下"。
 * - 修复：loadElements 后调用 preloadImages()，用 fetch 预热 HTTP 缓存，
 *   后续 new Image().src = url 直接命中浏览器缓存，毫秒级"加载完成"。
 */

import type { CanvasElement } from './CanvasElement'

const STORAGE_KEY_PREFIX = 'whiteboard.elements.'
const writeQueue = new Map<string, number>()  // whiteboardId -> rAF id
const pendingWrites = new Map<string, CanvasElement[]>()  // whiteboardId -> latest elements

/**
 * 从 localStorage 读取元素
 *
 * 刷新页面时调用，立即恢复画布内容（不需等待 socket）
 *
 * @param whiteboardId - 白板 ID
 * @returns 保存的元素数组，若无记录则返回空数组
 */
export function loadElements(whiteboardId: string): CanvasElement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + whiteboardId)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as CanvasElement[]
    }
  } catch {
    // localStorage 可能满了 / 被禁用 / JSON 损坏，全部静默
  }
  return []
}

/**
 * 把元素写入 localStorage（rAF 节流）
 *
 * 关键修复：拖动时每帧都可能调用（~60fps），
 * 同步写 localStorage 会阻塞主线程引起卡顿。用 requestAnimationFrame
 * 节流后，同一帧内多次调用只会写一次，且写入发生在帧末（不阻塞渲染）。
 *
 * @param whiteboardId - 白板 ID
 * @param elements - 最新的 elements 数组
 */
export function saveElements(whiteboardId: string, elements: CanvasElement[]): void {
  pendingWrites.set(whiteboardId, elements)

  // 关键修复：如果已经排了写入，就不再重复排队（rAF 自然会去取最新值）
  if (writeQueue.has(whiteboardId)) return

  const id = requestAnimationFrame(() => {
    writeQueue.delete(whiteboardId)
    const latest = pendingWrites.get(whiteboardId)
    pendingWrites.delete(whiteboardId)
    if (!latest) return
    try {
      localStorage.setItem(
        STORAGE_KEY_PREFIX + whiteboardId,
        JSON.stringify(latest)
      )
    } catch {
      // localStorage 满了 / 隐私模式，静默忽略
    }
  })
  writeQueue.set(whiteboardId, id)
}

/**
 * 立即 flush 待写入的元素（用于卸载 / 切页面前）
 *
 * 同步写入 localStorage，确保刷新时不会丢失最后一帧的更改。
 */
export function flushPendingElementsWrites(whiteboardId: string): void {
  const id = writeQueue.get(whiteboardId)
  if (id !== undefined) {
    cancelAnimationFrame(id)
    writeQueue.delete(whiteboardId)
  }
  const latest = pendingWrites.get(whiteboardId)
  pendingWrites.delete(whiteboardId)
  if (!latest) return
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + whiteboardId,
      JSON.stringify(latest)
    )
  } catch {
    // 静默
  }
}

/**
 * 删除元素记录（清空画布时调用，避免 stale 状态）
 */
export function clearElements(whiteboardId: string): void {
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

/**
 * 关键修复（刷新后保留 undo 栈）：从 localStorage 读取 undo 栈的序列化数据
 *
 * @param whiteboardId - 白板 ID
 * @returns undo 栈的序列化数据
 */
export function loadUndoStack(whiteboardId: string): any[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + whiteboardId + '.undo')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // 静默
  }
  return []
}

/**
 * 关键修复（刷新后保留 undo 栈）：从 localStorage 读取 redo 栈的序列化数据
 */
export function loadRedoStack(whiteboardId: string): any[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + whiteboardId + '.redo')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // 静默
  }
  return []
}

/**
 * 关键修复（刷新后保留 undo 栈）：把 undo/redo 栈写入 localStorage
 *
 * @param whiteboardId - 白板 ID
 * @param undoData - undo 栈的序列化数据
 * @param redoData - redo 栈的序列化数据
 */
export function saveUndoStack(
  whiteboardId: string,
  undoData: any[],
  redoData: any[]
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + whiteboardId + '.undo',
      JSON.stringify(undoData)
    )
    localStorage.setItem(
      STORAGE_KEY_PREFIX + whiteboardId + '.redo',
      JSON.stringify(redoData)
    )
  } catch {
    // 静默
  }
}

/**
 * 关键修复（图片闪一下）：预热图片元素的 HTTP 缓存
 *
 * 刷新页面时，loadElements 会立即恢复 elements，CanvasRenderer 首次渲染时
 * 对每个 image 元素创建 new Image() 并设置 src。浏览器需要：
 *   1) DNS 解析 + TCP 连接（如果域名未缓存）
 *   2) HTTP 请求 + 响应（如果未命中浏览器缓存）
 *   3) 图片解码（如果是 JPEG/PNG，需要 CPU 解码才能绘制到 canvas）
 *
 * 这 3 个步骤总共需要几十~几百 ms，期间 CanvasRenderer 显示"加载中..."占位符。
 * 加载完成后通过 markDirty('main') 触发重画，图片从占位符变成真实图。
 * 用户感知到"图片闪一下"。
 *
 * 修复：用 fetch 把所有 imageUrl 预热到浏览器 HTTP 缓存 + 浏览器 image cache。
 * 后续 new Image().src = url 命中缓存，跳过网络和解码，立即完成（毫秒级）。
 * 注意：fetch 默认会保留在 HTTP 缓存，浏览器图片解码缓存由 Image 内部管理。
 *
 * @param elements - 当前画布的元素列表
 */
export function preloadImages(elements: CanvasElement[]): void {
  const urls = new Set<string>()
  for (const el of elements) {
    if (el.type === 'image' && el.imageUrl) {
      urls.add(el.imageUrl)
    }
  }
  for (const url of urls) {
    // 关键修复：fetch 不消费响应体，只为了让浏览器把资源拉进 HTTP 缓存。
    // 用 no-cors 避免跨域 CORS 错误阻塞（即使不需要读取 body）。
    // 用 cache: 'force-cache' 强制使用 HTTP 缓存（避免重复网络请求）。
    // 即使 fetch 失败（图片 404 / 网络断），也不影响后续 new Image() 行为。
    fetch(url, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {
      // 静默：预热失败不影响主流程
    })
    // 关键修复：同步触发图片解码缓存。
    // 浏览器 <img> 加载成功后会把解码后的 bitmap 缓存在 ImageBitmap 池中，
    // 后续 new Image().src = url 创建的新 Image 会直接复用缓存（毫秒级）。
    // 这一步在很多浏览器里是"暗示性"优化，命中率不一定 100%，但能显著降低闪屏概率。
    const img = new Image()
    img.decoding = 'async'
    img.src = url
  }
}
