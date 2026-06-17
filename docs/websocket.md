# WebSocket 消息协议定义

## 连接配置

- **URL**: `ws://localhost:3001` (或 `wss://` 生产环境)
- **传输方式**: WebSocket (优先) / HTTP 长轮询 (降级)
- **认证**: 连接时通过 `auth.token` 传递 JWT

## 客户端上行事件

### join-whiteboard
加入白板房间

**Payload**:
```json
{
  "whiteboardId": "abc123"
}
```

**服务端响应**:
```json
{
  "success": true,
  "elements": [...],
  "serverVersion": 100,
  "users": [{ "userId": "...", "name": "User", "color": "#FF6B6B" }]
}
```

---

### leave-whiteboard
离开白板房间

**Payload**:
```json
{
  "whiteboardId": "abc123"
}
```

---

### element-op
发送元素操作

**Payload**:
```json
{
  "whiteboardId": "abc123",
  "clientOpId": "op-uuid",
  "opType": "add|update|delete|clear-all",
  "payload": {
    // add
    "element": { "id": "...", "type": "rect", ... },
    // update
    "id": "element-id",
    "updates": { "x": 100, "y": 200 },
    // delete
    "id": "element-id"
  },
  "timestamp": 1704067200000,
  "baseVersion": 100,
  "lamportClock": 200
}
```

---

### cursor-move
发送光标位置

**Payload**:
```json
{
  "whiteboardId": "abc123",
  "x": 500,
  "y": 300
}
```

---

### op-resend-request
请求重传操作（OT 缓冲超时）

**Payload**:
```json
{
  "whiteboardId": "abc123",
  "fromVersion": 100
}
```

---

## 服务端下行事件

### element-op
元素操作广播

**Payload**:
```json
{
  "opId": "server-op-id",
  "clientOpId": "op-uuid",
  "userId": "...",
  "userName": "User",
  "whiteboardId": "abc123",
  "opType": "add|update|delete|clear-all",
  "payload": { ... },
  "serverVersion": 101,
  "lamportClock": 201,
  "timestamp": 1704067200000,
  "transformed": false
}
```

---

### element-op-dropped
操作被丢弃通知

**Payload**:
```json
{
  "opId": "server-op-id",
  "clientOpId": "op-uuid",
  "reason": "BECAME_NOOP|CONFLICT_DROPPED",
  "userId": "...",
  "serverVersion": 100
}
```

---

### cursor-update
其他用户光标位置更新

**Payload**:
```json
{
  "userId": "...",
  "userName": "User",
  "color": "#FF6B6B",
  "x": 500,
  "y": 300
}
```

---

### user-joined
用户加入通知

**Payload**:
```json
{
  "userId": "...",
  "name": "User",
  "color": "#FF6B6B"
}
```

---

### user-left
用户离开通知

**Payload**:
```json
{
  "userId": "...",
  "name": "User"
}
```

---

### error
错误通知

**Payload**:
```json
{
  "code": "BUFFER_FULL|INTERNAL_ERROR|FORBIDDEN",
  "message": "错误描述"
}
```

---

## 时序图

### 用户加入白板

```
Client                              Server
  │                                   │
  │ ─────── connect + token ───────> │
  │                                   │
  │ <────────── connect ack ─────────│
  │                                   │
  │ ───── join-whiteboard(id) ─────> │
  │                                   │
  │ <──── join-whiteboard-ack ────── │
  │      (elements, version, users)  │
  │                                   │
  │ <────── user-joined (others) ────│
  │                                   │
```

### 发送操作并同步

```
Client A        Server           Client B
  │               │                  │
  │ ── op1 ─────> │                  │
  │               │ ── transform ──> │
  │               │                  │
  │ <─ ack ────── │                  │
  │               │ ── broadcast ──> │
  │               │                  │
  │               │ <─ op2 ───────── │
  │               │                  │
  │ <─ broadcast ─│ ── ack ────────> │
```

### 断线重连

```
Client                              Server
  │                                   │
  │ ─────── element-op ────────────> │
  │              × (network lost)     │
  │                                   │
  │ ─────── reconnect ─────────────> │
  │                                   │
  │ <────── connect ack ─────────────│
  │                                   │
  │ ───── join-whiteboard(id) ─────> │
  │                                   │
  │ <──── current state + version ───│
  │                                   │
  │ ───── resend buffered ops ─────> │
  │                                   │
```

## 操作类型定义

### CanvasElementShape
```typescript
interface CanvasElementShape {
  id: string
  type: 'rect' | 'circle' | 'line' | 'pen' | 'text' | 'image'
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  points?: Array<{ x: number; y: number }>
  text?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  textAlign?: 'left' | 'center' | 'right'
  textColor?: string
  imageUrl?: string
  cornerRadius?: number
  version: number
}
```

### Operation
```typescript
interface Operation {
  id?: string
  clientOpId: string
  whiteboardId: string
  userId: string
  opType: 'add' | 'update' | 'delete' | 'clear-all'
  payload: AddOpPayload | UpdateOpPayload | DeleteOpPayload
  baseVersion: number
  lamportClock: number
  timestamp: number
  prevOpId?: string
}
```
