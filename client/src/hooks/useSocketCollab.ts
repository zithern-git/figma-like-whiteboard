/**
 * Socket.IO 协作客户端 Hook (useSocketCollab)
 *
 * 职责：
 * - 连接 Socket.IO 服务端
 * - 把上行 op 广播函数注入到 canvasStore
 * - 把远端 op 转发到 canvasStore._applyRemoteOp
 * - 管理在线用户列表（提供 React 订阅）
 * - 提供 sendCursorMove 方法（由 Canvas 在 mousemove 时调用）
 * - 监听连接状态变化、断线重连
 *
 * 关键修复（Phase 7）：离线操作队列
 * - 断网时：op 缓存到本地队列（不丢失）
 * - 重连后：按顺序补发队列中的 op
 * - 补发成功后：清空队列，显示 toast 提示用户
 * - 队列上限：100 条，超限后丢弃最旧的（防止内存溢出）
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useCanvasStore, ClientOp, ServerOp } from '@/stores/canvasStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { CanvasElement } from '@/canvas/CanvasElement'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import { saveWhiteboardName } from '@/canvas/elementsStorage'

/** 在线用户展示信息（与服务端协议对齐） */
export interface OnlineUser {
  userId: string
  name: string
  color: string
}

/** hook 返回值 */
export interface UseSocketCollabReturn {
  /** 当前 Socket.IO 连接状态 */
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  /** 在线用户列表 */
  onlineUsers: OnlineUser[]
  /** 发送光标位置（应 50ms 节流） */
  sendCursorMove: (x: number, y: number) => void
  /** 当前用户自己的 userId（从 authStore 读） */
  currentUserId: string
}

const CURSOR_THROTTLE_MS = 50
/** 离线队列最大长度，防止内存溢出 */
const MAX_OFFLINE_QUEUE = 100

export function useSocketCollab(
  whiteboardId: string | null
): UseSocketCollabReturn {
  const token = useAuthStore((s) => s.token)
  const currentUserId = useAuthStore((s) => s.user?.id || '')

  const [connectionStatus, setConnectionStatus] =
    useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])

  const socketRef = useRef<Socket | null>(null)
  /** 待去重集合：自己发的 clientOpId 集合；收到回传时移除 */
  const pendingClientOpIds = useRef<Set<string>>(new Set())

  /**
   * 关键修复（实时协作失效 bug）：权威 shortId 引用。
   *
   * 问题根因：useSocketCollab 的 element-op 过滤器用
   *   op.whiteboardId !== whiteboardId
   * 丢弃不匹配项（防"白板串扰"）。whiteboardId 是 URL useParams 拿到的 id。
   * 服务端广播 op 时 whiteboardId 永远等于 **服务端 normalize 后的 shortId**。
   *
   *   - 如果 URL 是 shortId（WhiteboardListPage 跳转用 shortId）→ 过滤器放行 ✓
   *   - 如果 URL 是 mongo _id（旧链接 / 分享链接 / 直接访问）→ 永远被丢 ✗
   *     用户表现：A 改动 → 服务端持久化 + 广播给 B → B 收到 → 过滤掉 → B 看不到
   *               B 刷新 → join-whiteboard-ack 拉服务端最新状态 → 看到改动
   *
   * 修复：在 join-whiteboard-ack 到达时把服务端返回的 whiteboardShortId 存到
   * 这个 ref，过滤器用 actualShortIdRef.current ?? whiteboardId 做判定键。
   * 这样无论 URL 是 shortId 还是 mongo _id，只要 ack 拿到了真实 shortId，
   * 过滤器就能正确放行。
   */
  const actualShortIdRef = useRef<string | null>(null)

  /**
   * 关键修复：离线操作队列。
   * 断网时 op 不发 socket，而是 push 到 offlineQueue。
   * 重连后按 FIFO 顺序补发。
   */
  const offlineQueue = useRef<ClientOp[]>([])

  /**
   * 关键修复（位置错乱 bug）：待合并 op 列表。
   *
   * 重连时，connect 事件把 offlineQueue 的 op 转交给这个列表。
   * - 这些 op 已经发往服务端，服务端会持久化
   * - 服务端不广播给发送者（socket.to() 排除自己）
   * - 但 join-whiteboard-ack 会带服务端当前状态（断网前的旧状态）到达
   * - 如果直接 setElements(serverState)，本地会被回退到老位置！
   *
   * 修复：ack 到达时，先把 serverState 与这个列表里的 op 合并，再 setElements
   * - 服务端状态 = 其他人离线期间做的改动
   * - 这个列表 = 自己离线期间做的改动（应该覆盖服务端状态）
   * - 合并 = 取并集，自己后写优先
   *
   * 关键修复 v2（快速重连 bug）：在 join-whiteboard 等待 ack 的窗口内，
   * 如果用户继续产生新 op（持续拖动、未松手时网络恢复），这些 op
   * 走"在线"分支被直接 emit，不会进入 opsToMergeOnAck。但 ack 到达
   * 时 merge 只用 opsToMergeOnAck，导致"窗口期"的新 op 在 merge 中
   * 丢失。修复：用 isWaitingForAck 标志位让 broadcastOp 在等待窗口
   * 内把所有 op 追加进 opsToMergeOnAck。
   */
  const opsToMergeOnAck = useRef<ClientOp[]>([])

  /**
   * 关键修复 v2：join-whiteboard 已发出但 ack 尚未到达的窗口期。
   *
   * 这个窗口期内产生的 op 必须合并到 opsToMergeOnAck，否则会在
   * "快速重连"场景下丢失（用户正在拖动 → 网络恢复 → 用户继续拖动 →
   * 后半段 op 在线发出但不在 merge 队列里）。
   */
  const isWaitingForAck = useRef(false)

  // ========== cursor-move 节流 ==========
  const lastCursorSendRef = useRef<number>(0)
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null)
  const cursorTimerRef = useRef<number | null>(null)

  const flushCursor = useCallback(() => {
    const socket = socketRef.current
    if (!socket || !pendingCursorRef.current) return
    socket.emit('cursor-move', pendingCursorRef.current)
    pendingCursorRef.current = null
    cursorTimerRef.current = null
  }, [])

  const sendCursorMove = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      const elapsed = now - lastCursorSendRef.current
      if (elapsed >= CURSOR_THROTTLE_MS) {
        lastCursorSendRef.current = now
        socketRef.current?.emit('cursor-move', { x, y })
      } else {
        // 未到发送节流：暂存 + 定时器补发
        pendingCursorRef.current = { x, y }
        if (cursorTimerRef.current === null) {
          cursorTimerRef.current = window.setTimeout(
            flushCursor,
            CURSOR_THROTTLE_MS - elapsed
          )
        }
      }
    },
    [flushCursor]
  )

  // ========== 主连接 effect ==========
  useEffect(() => {
    if (!whiteboardId || !token) {
      setConnectionStatus('disconnected')
      return
    }

    setConnectionStatus('connecting')

    const socket = io('/', {
      path: '/socket.io',
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      maxHttpBufferSize: 20 * 1024 * 1024,
    } as any)
    socketRef.current = socket
    // 调试用：把 socket 暴露到 window，便于 E2E 测试模拟断网
    if (import.meta.env.DEV) {
      ;(window as unknown as { __socket: Socket }).__socket = socket
      ;(window as unknown as { __offlineQueue: ClientOp[] }).__offlineQueue = offlineQueue.current
    }

    // ========== 注入上行 op 广播回调到 store ==========
    const canvasStore = useCanvasStore.getState()
    canvasStore.setBroadcastOp((op: ClientOp) => {
      // 关键修复 v2（快速重连 bug）：在 join-whiteboard 等待 ack 的窗口内，
      // 任何新 op 都必须追加进 opsToMergeOnAck，否则在 ack 到达时这些 op
      // 不会进入 merge，本地状态会丢失它们。
      if (isWaitingForAck.current) {
        opsToMergeOnAck.current.push(op)
      }

      // 关键修复：判断当前是否在线
      if (socket.connected) {
        // 在线：直接 emit
        pendingClientOpIds.current.add(op.clientOpId)
        socket.emit('element-op', op)
      } else {
        // 离线：缓存到队列
        offlineQueue.current.push(op)
        // 超限丢弃最旧的
        if (offlineQueue.current.length > MAX_OFFLINE_QUEUE) {
          offlineQueue.current.shift()
        }
      }
    })

    // ========== 连接事件 ==========
    socket.on('connect', () => {
      setConnectionStatus('connected')
      // 关键修复 v2：进入"等待 ack"窗口
      // 之后任何新 op 都会进 opsToMergeOnAck，避免在快速重连场景下丢失
      isWaitingForAck.current = true
      // 关键修复（实时协作失效）：加日志确认传给服务端的 id 是 shortId 而非 mongo _id
      console.log(
        `[useSocketCollab] socket connected, emit join-whiteboard: whiteboardId=${whiteboardId}`
      )
      // 重新加入白板
      socket.emit('join-whiteboard', { whiteboardId })

      // 关键修复：重连后补发离线队列中的 op
      if (offlineQueue.current.length > 0) {
        // 关键修复：把 offlineQueue 的 op 追加到 opsToMergeOnAck
        // 服务端处理 op 后不广播回发送者
        // 但 join-whiteboard-ack 会带老的服务端状态到达
        // ack 处理器用这个列表把"自己的离线改动"叠加到服务端状态上
        // 这样本地不会回退到断网前的老位置
        // 关键修复 v2：用 push 而不是赋值，保留之前未消费的 op（极端情况：
        // 上一次重连 ack 未到达就再次断网，本次重连的 opsToMergeOnAck
        // 应当累积而不是覆盖）
        opsToMergeOnAck.current.push(...offlineQueue.current)
        const queue = [...offlineQueue.current]
        offlineQueue.current = []
        console.log(`[useSocketCollab] 重连后补发 ${queue.length} 条离线 op`)
        for (const op of queue) {
          pendingClientOpIds.current.add(op.clientOpId)
          socket.emit('element-op', op)
        }
        toast.success(`已同步 ${queue.length} 条离线操作`)
      }
      // 注意：这里不清空 opsToMergeOnAck。
      // 之前如果 isWaitingForAck 已经是 true（例如上一次重连 ack 没来就又断网），
      // opsToMergeOnAck 里可能还有未消费的 op，保留它们以便本次 ack 一起合并。
    })

    socket.on('disconnect', (reason: string) => {
      setConnectionStatus('disconnected')
      // 关键修复 v2：断开时清空"等待 ack"标志
      // 防止下次连接时残留错误状态
      isWaitingForAck.current = false
      // 关键修复：断开时给用户提示（仅非主动断开）
      if (reason !== 'io client disconnect') {
        toast.warning('网络已断开，操作将在恢复后自动同步')
      }
    })

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message)
      setConnectionStatus('disconnected')
    })

    // ========== 白板事件 ==========
    socket.on(
      'join-whiteboard-ack',
      (payload: {
        elements: CanvasElement[]
        onlineUsers: OnlineUser[]
        whiteboardName?: string
        whiteboardShortId?: string
        version: number
      }) => {
        // 关键修复 v2：退出"等待 ack"窗口
        isWaitingForAck.current = false
        // 关键修复（实时协作失效）：记录服务端 normalize 后的权威 shortId
        // 供下面的 element-op 过滤器使用（详见 actualShortIdRef 注释）。
        // 防御场景：URL 形如 /whiteboard/<mongo_id>（旧链接 / 分享链接），
        // whiteboardId 是 24 位 hex，actualShortIdRef 是 6 位 shortId，
        // 过滤器用 actualShortIdRef 后能正确放行。
        if (payload.whiteboardShortId) {
          actualShortIdRef.current = payload.whiteboardShortId
          console.log(
            `[useSocketCollab] 记录权威 shortId: ${actualShortIdRef.current}（URL id=${whiteboardId}）`
          )
        }
        // 关键修复（白板名"未命名白板"bug）：服务端在 ack 中附带 whiteboardName，
        // 缓存到 localStorage 作为刷新后的兜底（HTTP GET /api/whiteboards/:id
        // 对不在 collaborators 的用户返回 403，会导致 currentWhiteboard 永远 null）。
        if (payload.whiteboardName) {
          // 关键修复：缓存 key 用当前 whiteboardId（即 URL 里的 id），
          // 而**不是** server 返回的 whiteboardShortId。
          // 原因：URL 形如 /whiteboard/<mongo_id> 时 useParams 拿到的是 24 位
          // hex mongo _id，WhiteboardPage 里的 loadWhiteboardName(id) 用
          // 这个 id 查 localStorage。如果这里存 shortId，6 位和 24 位永远
          // 对不上，刷新后缓存 miss → Navbar 退到 "未命名白板"。
          // 用 whiteboardId 存（无论 mongo _id 还是 shortId）都能命中。
          // 同时把对方的 shortId 也存一份，防御别人用 /whiteboard/<shortId>
          // 访问时也能命中。
          saveWhiteboardName(whiteboardId, payload.whiteboardName)
          if (
            payload.whiteboardShortId &&
            payload.whiteboardShortId !== whiteboardId
          ) {
            saveWhiteboardName(payload.whiteboardShortId, payload.whiteboardName)
          }
          // 关键修复：通知 WhiteboardPage 更新 cachedWhiteboardName 状态，
          // 让 Navbar 立即显示真实名称（不等 React 重新读取 localStorage）。
          // 用 whiteboardId 作匹配键，跟 WhiteboardPage 的 id (useParams) 一致。
          window.dispatchEvent(
            new CustomEvent('whiteboard-name-updated', {
              detail: {
                whiteboardId,
                name: payload.whiteboardName,
              },
            })
          )
        }
        // 关键修复（白板串扰 bug）：先做白板 ID 校验
        // 服务端已经在 join-whiteboard 时校验过 shortId 是否匹配，但 ack 的 elements
        // 是服务端根据 shortId 查的。如果 whiteboardId 传错，服务端会返回错误白板的 elements。
        // 这里再校验一次防御。
        const localElements = useCanvasStore.getState().elements
        let elements = payload.elements || []
        const hasOfflineOps = opsToMergeOnAck.current.length > 0
        if (hasOfflineOps) {
          // ========== 场景 A：离线重连（重要）==========
          // 关键修复（用户报告"几秒后变回修改之前的状态"）：
          // 本地有未同步的 op（用户在断网期间产生），服务端 ack 状态不包含这些 op。
          // 正确做法：把 offline op 应用到两端，得到一致的"应用 op 后的状态"，再合并。
          const ops = [...opsToMergeOnAck.current]
          opsToMergeOnAck.current = []
          console.log(`[useSocketCollab] 合并 ${ops.length} 条离线 op 到服务端状态 + 本地状态`)
          // 1) 应用到服务端
          elements = mergeOpsIntoElements(elements, ops)
          // 2) 关键修复：也应用到本地！否则本地状态早于 op 产生时间，
          //    用本地覆盖服务端会把用户的最新修改"擦掉"。
          if (localElements.length > 0) {
            const localWithOps = mergeOpsIntoElements(localElements, ops)
            // 3) 合并：本地独有的保留（op 期间的本地中间态），其余用"应用 op 后的服务端"
            elements = mergeElementsPreferLocal(elements, localWithOps)
          }
        } else if (localElements.length > 0) {
          // ========== 场景 B：刷新 / 首次连接（无离线 op）==========
          // 关键修复（协作偏差 bug v2）：
          // 这是协作场景，**不应用本地优先合并**。
          // 原因：
          //   - 场景 B1（首次连接）：localStorage 是空的（或旧的），
          //     应该用服务端权威状态 → 直接用 payload.elements
          //   - 场景 B2（刷新后 localStorage 恢复）：
          //     localStorage 保存的是用户刷新前的最后状态。
          //     如果另一用户在此期间修改了同一元素，服务端状态更新。
          //     用本地覆盖服务端会让该用户看不到协作修改 → 位置偏差！
          //   - 场景 B3（用户自己刷新后立即重连，op 全部成功发送）：
          //     没有 offline op，服务端状态是最新的 → 直接用 payload.elements
          //
          // 关键修复：之前用 mergeElementsPreferLocal 会让本地旧版本覆盖服务端新版本，
          // 导致两个客户端看到的元素位置不一致。
          // 正确做法：直接用服务端状态，仅在服务端元素数 < 本地时补充本地独有元素
          // （说明本地 add 的元素未及时同步到服务端）。
          console.log(
            `[useSocketCollab] 服务端 ${elements.length} 个元素，本地 ${localElements.length} 个（无离线 op）→ 用服务端权威状态`
          )
        }
        // 关键修复（白板串扰 bug v3）：**移除**"补充本地独有元素"的兜底逻辑。
        //
        // 之前代码在 join-whiteboard-ack 到达时，如果 localElements 数量 > payload.elements
        // （例如切到新白板时，canvasStore 全局状态还有上一白板的元素），
        // 会把"本地独有元素"全部追加到 elements，导致**新白板里出现上一白板的元素**。
        //
        // 这个兜底原本是为"离线期间 add 的元素未及时同步"设计的，但它无法区分：
        //   - 离线未同步的本地新增元素（应该保留）
        //   - 跨白板切换残留的上一白板元素（应该丢弃）
        //
        // 这两个场景从 serverElements 看是完全一样的（服务端都没有这些元素），
        // 但语义完全不同。错误的兜底会导致**白板间元素串扰**这个严重 bug。
        //
        // 修复策略：
        //   1. 严格信任服务端权威状态
        //   2. 在白板切换时（router id 变化）由 WhiteboardPage 负责彻底清空 canvasStore
        //   3. 这里不再做"本地补充"，避免跨白板残留
        //
        // 离线期间新增的 add 元素会进入 opsToMergeOnAck（场景 A 分支处理），
        // 不会出现在 localElements.length > elements.length 的"无离线 op"分支。
        canvasStore.setElements(elements)
        setOnlineUsers(payload.onlineUsers || [])
      }
    )

    socket.on('online-users', (users: OnlineUser[]) => {
      setOnlineUsers(users)
    })

    socket.on('element-op', (op: ServerOp) => {
      // 关键修复（白板串扰 bug）：收到的 op 必须匹配当前白板才应用
      // 原因：socket.io 不会自动断开/重连房间；如果 useEffect cleanup 时 socket
      // 没真正断开，或者 join 多个 room 残留，op 可能从其他白板串到当前 store。
      // 通过 op.whiteboardId 与当前 whiteboardId 严格比对来避免。
      //
      // 关键修复（实时协作失效 bug）：判定键必须是服务端的 shortId。
      // 服务端广播的 op.whiteboardId 是 shortId（详见 actualShortIdRef 注释）。
      // 判定键优先级（多源 fallback，应对各种 server 协议 / URL 形态）：
      //   1. actualShortIdRef.current    ← 服务端 ack 里的 whiteboardShortId（最权威）
      //   2. useWhiteboardStore 里 currentWhiteboard.shortId ← HTTP GET 拿到的
      //   3. whiteboardId                 ← URL useParams（可能是 mongo _id 也可能是 shortId）
      // 防御：
      //   - URL 是 shortId（新导航）  → 直接走 3，过滤器放行
      //   - URL 是 mongo _id（旧链接）→ 走 1 或 2，过滤器放行
      //   - 全部 fallback 都没拿到（比如服务重启中）→ 用 3 兜底，可能误判但不丢常见 case
      const storeShortId = useWhiteboardStore.getState().currentWhiteboard?.shortId
      const filterKey = actualShortIdRef.current ?? storeShortId ?? whiteboardId
      if (!op.whiteboardId || op.whiteboardId !== filterKey) {
        console.warn(
          `[useSocketCollab] 忽略来自其他白板的 op: op.wb=${op.whiteboardId}, current=${filterKey}`
        )
        return
      }
      // 去重：如果是我们自己发的（被服务端回传），不重复应用
      if (op.clientOpId && pendingClientOpIds.current.has(op.clientOpId)) {
        pendingClientOpIds.current.delete(op.clientOpId)
        return
      }
      // 远端 op：应用到本地 store
      // 关键修复（实时协作失效）：增加可观测日志，便于排查 op 链路问题
      console.log(
        `[useSocketCollab] 收到远端 op: type=${op.opType} userId=${op.userId} clientOpId=${op.clientOpId}`
      )
      useCanvasStore.getState()._applyRemoteOp(op)
    })

    socket.on(
      'cursor-move',
      (_payload: { userId: string; x: number; y: number }) => {
        // 6.1 范围内仅占位（不实现光标渲染，但保留接口）
      }
    )

    socket.on('error', (err: { code: string; message: string }) => {
      console.warn('Socket error:', err)
    })

    // ========== 清理 ==========
    return () => {
      // 关键修复（白板串扰 bug）：先发 leave-whiteboard（带当前 whiteboardId），
      // 再 disconnect 触发服务端 removeSocket。
      // 之前 cleanup 时直接 disconnect，可能在服务端还未来得及 leave room
      // 时，client 就已经 disconnect，导致 op 仍可能投递到旧 socket 的 room。
      if (socket.connected) {
        socket.emit('leave-whiteboard', { whiteboardId })
        // 关键修复：强制 socket 离开上一个白板的 room
        // 多白板切换场景下，旧 socket 残留的房间订阅可能继续接收 op
        socket.emit('leave-all-rooms')
        socket.disconnect()
      }
      socketRef.current = null

      // 清除上行 op 广播回调（避免下次 mount 之前 store 仍持有旧引用）
      useCanvasStore.getState().setBroadcastOp(null)

      // 清理节流定时器
      if (cursorTimerRef.current !== null) {
        clearTimeout(cursorTimerRef.current)
        cursorTimerRef.current = null
      }
      pendingCursorRef.current = null
      pendingClientOpIds.current.clear()
      // 关键修复（实时协作失效）：清理权威 shortId 引用，防止切到新白板时
      // 残留旧 shortId 导致新 op 全部被过滤器误判拒绝（见 actualShortIdRef 注释）。
      actualShortIdRef.current = null
      // 关键修复：清理合并队列，防止下次 mount 时把上次未消费的 op 误合并
      opsToMergeOnAck.current = []
      setOnlineUsers([])
    }
  }, [whiteboardId, token])

  return {
    connectionStatus,
    onlineUsers,
    sendCursorMove,
    currentUserId,
  }
}

/**
 * 关键修复（刷新立刻恢复）：合并服务端和本地元素，本地优先。
 *
 * 场景：用户刷新浏览器，WhiteboardPage mount 时从 localStorage 恢复了一组 elements
 * （用户刷新前的最后状态）。之后 socket 连接上，join-whiteboard-ack 返回服务端状态。
 * 此时不能直接用服务端状态覆盖本地 —— 服务端可能未保存用户的最新修改
 * （add bug / 还没落库 / 网络丢包）。
 *
 * 合并规则（按 id）：
 * - 本地有、服务端没有 → 保留（用户的最新修改，未及时同步到服务端）
 * - 本地没有、服务端有 → 追加（其他人的协作 / 服务端权威状态）
 * - 双方都有 → 用本地的（用户的最新状态）
 *
 * 注意：合并后会再 setElements 触发 canvasStore 更新，本地保存的 useEffect
 * 也会自动把合并后的状态写回 localStorage，下次刷新时本地就有完整数据了。
 */
function mergeElementsPreferLocal(
  serverElements: CanvasElement[],
  localElements: CanvasElement[]
): CanvasElement[] {
  const localById = new Map<string, CanvasElement>()
  for (const el of localElements) {
    localById.set(el.id, el)
  }

  const result: CanvasElement[] = []
  const seen = new Set<string>()

  // 遍历服务端元素，遇到本地有的用本地版本
  for (const serverEl of serverElements) {
    seen.add(serverEl.id)
    const localEl = localById.get(serverEl.id)
    if (localEl) {
      result.push(localEl)  // 本地优先
    } else {
      result.push(serverEl)  // 服务端独有：保留（其他人的协作）
    }
  }

  // 本地独有（服务端没有）→ 追加
  for (const localEl of localElements) {
    if (!seen.has(localEl.id)) {
      result.push(localEl)
    }
  }

  return result
}

/**
 * 关键修复：把离线 op 应用到服务端状态上
 *
 * 重连时 join-whiteboard-ack 带的服务端状态不包含我们的离线改动（因为 op 还在
 * 服务端持久化或正在持久化中，但未进入 ack 的 snapshot）。直接 setElements
 * 会丢失我们的离线改动，导致本地状态回退到断网前。
 *
 * 正确做法：把离线 op 按 opType 应用到服务端 elements 上。
 * 顺序：op 数组已按 FIFO 排列（因为 offlineQueue 是顺序 push 的）
 *
 * 与服务端 applyOpToElements 保持一致：
 * - add:  按 id 去重后追加
 * - update: 按 id 合并字段
 * - delete: 按 id 过滤
 * - clear-all: 清空
 */
function mergeOpsIntoElements(
  serverElements: CanvasElement[],
  ops: ClientOp[]
): CanvasElement[] {
  let elements = [...serverElements]

  for (const op of ops) {
    switch (op.opType) {
      case 'add': {
        const incoming = (op.payload as { element?: CanvasElement })?.element
        if (!incoming?.id) break
        // 防御：去重（按 id）
        if (elements.some((e) => e.id === incoming.id)) break
        elements = [...elements, incoming]
        break
      }
      case 'update': {
        const { id, updates } = (op.payload as { id?: string; updates?: Partial<CanvasElement> }) ?? {}
        if (!id) break
        elements = elements.map((e) =>
          e.id === id ? { ...e, ...(updates ?? {}), id } : e
        )
        break
      }
      case 'delete': {
        const { id } = (op.payload as { id?: string }) ?? {}
        if (!id) break
        elements = elements.filter((e) => e.id !== id)
        break
      }
      case 'clear-all': {
        elements = []
        break
      }
    }
  }

  return elements
}
