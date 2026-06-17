import { create } from 'zustand'
import { whiteboardService, WhiteboardData } from '@/services/whiteboard'
import { saveWhiteboardName } from '@/canvas/elementsStorage'

interface WhiteboardState {
  whiteboards: WhiteboardData[]
  currentWhiteboard: WhiteboardData | null
  isLoading: boolean
  /**
   * 当前登录用户 id，用于把白板列表缓存写到正确的 userId 命名空间。
   * 关键修复（白板列表刷新闪烁）：模块加载时 user 还没就绪，缓存只能落到
   * 'anonymous' key 上去；用户在 WhiteboardListPage 拿到 user.id 后会调
   * setCurrentUserId 把缓存切回正确 key 的版本。
   */
  currentUserId: string | null
  setCurrentUserId: (id: string | null) => void
  fetchWhiteboards: () => Promise<void>
  fetchWhiteboardById: (id: string) => Promise<void>
  createWhiteboard: (name: string) => Promise<WhiteboardData>
  deleteWhiteboard: (id: string) => Promise<void>
  joinWhiteboard: (shortId: string) => Promise<WhiteboardData>
}

// 关键修复（修 1 后续：刷新页面看不到白板）：把白板列表同步缓存到 localStorage。
// 之前 store.whiteboards 初始值是 []，所以刷新 / 重新打开 / 退出再进主页时
// 渲染出来的第一帧是"全部白板 (0)"+"还没有白板..."，等几百 ms HTTP GET 返回才
// 变成真实数据。用户感觉"我明明有 3 个白板，刷新后却说没有"。
//
// 修复：store 创建时同步从 localStorage 读旧列表（sync，几百 μs 级，不影响首屏）；
// 每次成功拉取 / 创建 / 删除 / 加入后也同步写回 localStorage。
//   - 首次登录：localStorage 空 → 仍是 [] → 看到空骨架 → HTTP GET 后填充
//   - 之后每次刷新 / 退到主页：localStorage 有旧列表 → 立刻渲染旧 grid → HTTP GET 后台静默刷新
//   - 多个账号：cache key 简单加 userId 前缀，避免串数据
const WHITEBOARD_LIST_CACHE_KEY_PREFIX = 'whiteboard.list.cache.v2.'
const WHITEBOARD_LIST_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24h 太旧就丢掉

function getCacheKey(userId: string | null | undefined): string {
  // 没 userId 时用全局 key（极端情况：用户在 store 初始化前就读 cache，user 还没 hydrate）
  return `${WHITEBOARD_LIST_CACHE_KEY_PREFIX}${userId ?? 'anonymous'}`
}

function loadWhiteboardListCache(userId: string | null | undefined): WhiteboardData[] {
  try {
    const raw = localStorage.getItem(getCacheKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as {
      savedAt?: number
      data?: WhiteboardData[]
    }
    if (
      parsed &&
      Array.isArray(parsed.data) &&
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt < WHITEBOARD_LIST_CACHE_MAX_AGE_MS
    ) {
      return parsed.data
    }
  } catch {
    // localStorage 满 / 禁用 / JSON 损坏，静默
  }
  return []
}

function saveWhiteboardListCache(
  userId: string | null | undefined,
  whiteboards: WhiteboardData[]
): void {
  try {
    localStorage.setItem(
      getCacheKey(userId),
      JSON.stringify({ savedAt: Date.now(), data: whiteboards })
    )
  } catch {
    // 静默失败（localStorage 满 / 隐私模式）
  }
}

function clearWhiteboardListCache(userId: string | null | undefined): void {
  try {
    localStorage.removeItem(getCacheKey(userId))
  } catch {
    // 静默
  }
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  // 关键修复：store 初始化时同步读 localStorage（旧列表），首帧就能渲染。
  // 注意：userId 可能在 zustand store 初始化时还没拿到（authStore 还没 hydrate），
  // 所以 fallback 到 'anonymous'。用户登录后 store 已经在内存里有值了，不会被覆盖。
  // userId 变化时由下方的 setCurrentUserId 重新加载正确 key 的缓存。
  whiteboards: loadWhiteboardListCache(null),
  currentWhiteboard: null,
  isLoading: false,
  currentUserId: null,

  /**
   * 设置当前登录用户，并立刻把对应 userId 的缓存换进 store。
   * 关键修复（白板列表刷新闪烁）：
   * 之前 user 就绪后没有这一步，store.whiteboards 一直是 []（来自 'anonymous'
   * key 缓存 miss），必须等 fetchWhiteboards 的 HTTP GET 几百 ms ～ 几秒后
   * 才填充。用户感觉"刷新后白板没了，过几秒才出来"。
   * 现在切到正确 userId 后立刻从 localStorage 同步读出旧列表（毫秒级），
   * 首帧就能看到 grid，再后台 HTTP 静默刷新。
   */
  setCurrentUserId: (id) => {
    const currentId = get().currentUserId
    if (currentId === id) return
    set({ currentUserId: id, whiteboards: loadWhiteboardListCache(id) })
  },

  /**
   * 关键修复（修 1：主页不要在 store 为空时阻塞渲染，永远走非阻塞路径）：
   *
   * 之前 store.whiteboards 为空时走 set({ isLoading: true }) → WhiteboardListPage
   * 渲染"加载中..."，但 API 走的是 axios 拦截器（10s 超时 + 3 次重试 + 1s/2s/4s 退避），
   // 最坏要 47s 才走完 finally → isLoading 才变 false。期间用户看到的是"加载中..."
   * 卡死，体感极差。
   *
   * 修复：永远走非阻塞路径，立即返回；API 完成后 silent setState 更新。
   *   - 用户立刻看到 WhiteboardListPage 的骨架（"还没有白板"或上次缓存的 grid）
   *   - 后台异步拉取，完成后 setState 静默刷新
   *   - 失败也静默（不弹 toast，toast 由后续修 2 处理）
   *
   * 注意：fetchWhiteboardById 仍然会 set isLoading（白板页用它显示加载状态），
   * 这里不动。
   */
  fetchWhiteboards: async () => {
    // 在请求发起时把 userId 抓住，存缓存时使用，避免并发场景下 user 切换后写错 key
    const userId = get().currentUserId
    whiteboardService
      .getList()
      .then((whiteboards) => {
        // 关键修复：避免 setState 覆盖并发变更
        // 如果用户在等待 HTTP GET 期间创建了白板，store 已经有新元素，
        // 旧响应回来时不要覆盖新元素
        set({ whiteboards })
        // 关键修复（白板列表刷新闪烁）：把结果写回 localStorage，
        // 下次刷新 / 重新打开时首帧就能从缓存里直接出 grid。
        // 之前这段是死代码——只读不写，导致缓存永远是 []。
        saveWhiteboardListCache(userId, whiteboards)
      })
      .catch(() => {
        // 后台刷新失败静默（store.whiteboards 保留旧值 / 保持 []）
      })
  },

  fetchWhiteboardById: async (id: string) => {
    set({ isLoading: true })
    try {
      const whiteboard = await whiteboardService.getById(id)
      set({ currentWhiteboard: whiteboard })
      // 关键修复（白板名"未命名白板"bug）：HTTP GET 成功后**用 URL 的 id 缓存名称**。
      // 之前 socket ack 只用 shortId 存，但 URL 用 mongo _id 时 key 对不上 → 缓存 miss。
      // 这里用 HTTP 请求时拿到的 whiteboard.id / whiteboard.shortId 同步存两份，
      // 不管以后 URL 变成哪种格式都能立即命中。
      if (whiteboard?.name) {
        saveWhiteboardName(id, whiteboard.name)
        if (whiteboard.id && whiteboard.id !== id) {
          saveWhiteboardName(whiteboard.id, whiteboard.name)
        }
        if (whiteboard.shortId && whiteboard.shortId !== id) {
          saveWhiteboardName(whiteboard.shortId, whiteboard.name)
        }
      }
    } catch {
      set({ currentWhiteboard: null })
    } finally {
      set({ isLoading: false })
    }
  },

  createWhiteboard: async (name: string) => {
    const userId = get().currentUserId
    const whiteboard = await whiteboardService.create(name)
    const next = [whiteboard, ...get().whiteboards]
    set({ whiteboards: next })
    // 关键修复：创建成功后立刻把新列表写回 localStorage，
    // 否则下次刷新又要走一遍"白板消失→几秒后出来"的过程。
    saveWhiteboardListCache(userId, next)
    return whiteboard
  },

  deleteWhiteboard: async (id: string) => {
    const userId = get().currentUserId
    await whiteboardService.delete(id)
    const next = get().whiteboards.filter((wb) => wb.id !== id)
    set({ whiteboards: next })
    // 关键修复：删除后同步写缓存，避免下次刷新出现"幽灵白板"。
    saveWhiteboardListCache(userId, next)
  },

  joinWhiteboard: async (shortId: string) => {
    const userId = get().currentUserId
    const whiteboard = await whiteboardService.join(shortId)
    const exists = get().whiteboards.find((wb) => wb.id === whiteboard.id)
    if (!exists) {
      const next = [whiteboard, ...get().whiteboards]
      set({ whiteboards: next })
      // 关键修复：加入新白板后同步写缓存。
      saveWhiteboardListCache(userId, next)
    }
    return whiteboard
  },
}))
