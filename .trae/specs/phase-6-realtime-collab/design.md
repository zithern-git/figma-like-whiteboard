# Phase 6.1 实时事件管道设计

**日期**: 2026-06-10
**阶段**: Phase 6.1 — 实时事件层（不含 OT / 快照）
**状态**: 设计已批准，待实施

## Why

Phase 5 完成了客户端单机的撤销/重做、复制、变换等所有交互。Phase 6 的目标是把单机白板升级为多人实时协作系统。完整协作需要 OT 算法、快照持久化、增量恢复等组件（估时 5+ 天），不适合单次交付。

本次（6.1）只做最小可联调的事件管道：**last-write-wins**，让两浏览器窗口能实时看到对方的操作，但不解决并发冲突。OT 留到 6.3 处理。

## What Changes

### 服务端

- `server/src/models/Whiteboard.ts`：加 `elements: CanvasElement[]` 字段
- `server/src/sockets/onlineUsers.ts`（新建）：Redis 在线集合管理
- `server/src/sockets/operationBroadcaster.ts`（新建）：权限检查 + 操作广播
- `server/src/sockets/whiteboardHandler.ts`（新建）：事件分发
- `server/src/sockets/index.ts`：注册 handler、Redis 客户端扩展 hash 方法

### 客户端

- `client/src/hooks/useSocketCollab.ts`（新建）：socket 连接 / 加入 / 发送 / 监听
- `client/src/stores/canvasStore.ts`：暴露 `_broadcastOp` 回调点
- `client/src/features/whiteboard/WhiteboardPage.tsx`：接入 socket hook

## 事件协议

### 服务端 → 客户端

| 事件 | Payload | 含义 |
|---|---|---|
| `join-whiteboard-ack` | `{ elements, onlineUsers, version }` | 加入成功，推送初始状态 |
| `element-op` | `{ clientOpId, opType, payload, userId, timestamp }` | 远端 op 转发 |
| `online-users` | `[{ userId, name, color }]` | 在线用户列表变化 |
| `cursor-move` | `{ userId, x, y }` | 远端光标位置（节流 50ms） |
| `error` | `{ code, message }` | 错误通知 |

### 客户端 → 服务端

| 事件 | Payload | 含义 |
|---|---|---|
| `join-whiteboard` | `{ whiteboardId }` | 请求加入 |
| `leave-whiteboard` | `{ whiteboardId }` | 主动离开 |
| `element-op` | `{ clientOpId, opType, payload, timestamp }` | 提交 op |
| `cursor-move` | `{ x, y }` | 推送光标位置 |

### 操作类型 (`opType`)

```
'add'         → { element: CanvasElement }
'update'      → { id, updates: Partial<CanvasElement> }
'delete'      → { id }
'clear-all'   → {}
```

**不通过 element-op 同步的操作**（本地 UI 行为，不是数据）：
- undo / redo（6.1 LWW 限制：User A 撤销不会同步给其他人）
- selection / viewport 状态
- 鼠标 hover、拖拽预览

## 数据流

```
┌──────────┐                                              ┌──────────┐
│ Browser A│                                              │ Browser B│
└─────┬────┘                                              └────┬─────┘
      │ join-whiteboard{shortId}                                │
      ├──────────────────────┐                                  │
      │                      ▼                                  │
      │              ┌──────────────┐                           │
      │              │ Socket.IO    │                           │
      │              │ Server       │                           │
      │              └──────┬───────┘                           │
      │                     │                                   │
      │              join-whiteboard-ack{elements, onlineUsers} │
      │ ◄────────────────────┤                                   │
      │                     │                                   │
      │ element-op{add, ...}                                    │
      ├─────────────────────┤                                   │
      │                     │ check role (editor/owner only)    │
      │                     │ persist (write to Whiteboard doc) │
      │                     │ broadcast to room (except sender) │
      │                     ├──── element-op{add, ...} ────────►│
      │                     │                                   │
      │                     │              element-op{add, ...} │
      │                     │ ◄─────────────────────────────────┤
      │                     │ persist + broadcast              │
      │ element-op{add, ...} ◄─────────────────────────────────┤
```

## 关键设计

### 1. clientOpId 去重

每个客户端 op 携带 UUID。客户端发送时记录 `pendingOps: Set<clientOpId>`。
收到广播的 element-op 时：
- 如果 `clientOpId` 在 pending 中 → 从 pending 删除（这是我自己发的回传），不应用到本地
- 否则 → 这是远端的 op，应用到本地 store

### 2. 服务端持久化（6.1 简化）

每次 element-op 直接全量更新 `Whiteboard.elements` 字段（Mongoose `$set`）。
不写操作日志，不生成快照。Phase 6.2 引入 Operation / Snapshot 模型时迁移。

### 3. Redis 在线集合

| Key | 类型 | 用途 |
|---|---|---|
| `whiteboard:{shortId}:online` | Set<userId> | 在线用户 ID 集合 |
| `whiteboard:{shortId}:users` | String (JSON) | 用户信息数组（含 name/color） |

**操作**：
- 加入 → SADD online + 读 / 写 users JSON
- 离开 / 断开 → SREM online + 重新计算 + 广播
- 简化：每次维护一个 JSON 数组（避免 InMemoryRedis 缺少 hset/hgetall）

### 4. 权限检查

每个 element-op 入口：
1. 查询 Whiteboard.collaborators
2. 找到 userId 对应角色
3. role === 'viewer' → emit `error { code: 'FORBIDDEN' }`，丢弃 op
4. role === 'editor' / 'owner' → 放行

viewer 角色应该被服务端在 join 时也限制（不能接收后续 op），但 6.1 范围内不严格实现：viewer 可以加入（看到画布），但写操作被拒。

### 5. 客户端架构

```typescript
// useSocketCollab.ts
useEffect(() => {
  const socket = io(API_BASE, { auth: { token } })
  
  // 加入
  socket.emit('join-whiteboard', { whiteboardId: id })
  socket.on('join-whiteboard-ack', ({ elements }) => {
    canvasStore.setElements(elements)  // 初始化本地 store
  })
  
  // 远端 op
  socket.on('element-op', (op) => {
    if (op.clientOpId in pendingOps) {
      delete pendingOps[op.clientOpId]
      return
    }
    canvasStore._applyRemoteOp(op)
  })
  
  // 暴露发送方法
  return { sendOp: (op) => socket.emit('element-op', op), ... }
}, [id])
```

**canvasStore 集成**：
- 新增 `_broadcastOp` 字段（函数引用，由 WhiteboardPage 注入）
- addElement / updateElement / deleteElement / clearAllElements 内部调用 `_broadcastOp`
- 新增 `_applyRemoteOp(op)` 方法：远端 op 走 `_raw` 方法直接修改，不入 undo 栈

### 6. 断线重连（基础）

- Socket.IO 客户端配置：`reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 30000, randomizationFactor: 0.5, timeout: 20000`
- 重连成功后 emit `join-whiteboard` 重新加入
- 服务端在 disconnect 时清理 socket 关联的 room 状态（Redis SREM）

### 7. 光标同步节流

- 客户端：50ms 节流发送 cursor-move
- 服务端：不做额外节流（每 socket 都有独立 room，直接广播）

## Edge Cases

| 场景 | 处理 |
|---|---|
| viewer 发送 op | 服务端发 error 事件，丢弃 op |
| 同一用户多标签页 | 每个 socket 独立 room，重复收到 op 视为正常 |
| 重复加入 | join 时已 SADD 不会重复；users JSON 重写 |
| 服务重启 | elements 字段持久化在 MongoDB，重启可恢复 |
| Redis 不可用 | 用 InMemoryRedis（已有），单实例不广播 |
| 客户端在 op 飞行中关闭 | 服务端 send 失败被 Socket.IO 静默处理；下次加入会重新拿到完整状态 |
| 撤销 (undo) | 不广播；本地 undo 不影响他人（6.1 已知行为） |

## 不做的事（YAGNI）

- ❌ OT 算法 / transform / compose（留给 6.3）
- ❌ Operation / Snapshot 独立模型（留给 6.2）
- ❌ lastOperationTimestamp 增量恢复（留给 6.4）
- ❌ 撤销广播（留到 OT 阶段）
- ❌ 元素锁 / 悲观并发控制
- ❌ 房间内消息 / 评论
- ❌ 客户端 viewer 模式的 UI 限制（仅服务端拒绝写 op）
- ❌ 写单元测试（手动双窗口联调）

## File Manifest

| 操作 | 路径 | 估行数 |
|---|---|---|
| 新建 | `client/src/hooks/useSocketCollab.ts` | ~180 |
| 修改 | `client/src/stores/canvasStore.ts` | +40 / -5 |
| 修改 | `client/src/features/whiteboard/WhiteboardPage.tsx` | +30 / -5 |
| 修改 | `server/src/models/Whiteboard.ts` | +15 |
| 修改 | `server/src/sockets/index.ts` | +10 / -5 |
| 新建 | `server/src/sockets/onlineUsers.ts` | ~80 |
| 新建 | `server/src/sockets/operationBroadcaster.ts` | ~120 |
| 新建 | `server/src/sockets/whiteboardHandler.ts` | ~100 |

## 手动测试场景

1. 浏览器 A + B 同时加入白板 X → 双方 `online-users` 列表显示 2 人
2. A 画矩形 → B 屏幕 < 100ms 出现矩形
3. A 拖拽矩形 → B 看到实时拖动
4. A 删除矩形 → B 屏幕矩形消失
5. A 关闭浏览器 → B `online-users` 列表移除 A
6. A 网络断开 5 秒再恢复 → A 自动重连并看到最新画布
7. Viewer 角色用户画矩形 → 收到 error，未应用
8. 双方各自 Ctrl+Z 不影响对方（6.1 已知行为）
9. 服务重启后打开白板 → 仍能看到之前的元素（持久化生效）
