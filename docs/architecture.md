# 系统架构设计文档

## 1. 概述

Figma-like Whiteboard 是一个实时协作白板系统，支持多用户同时编辑、操作转换（OT）冲突解决、离线操作队列和撤销重做功能。

## 2. 技术栈

### 前端
- **React 18** + **TypeScript** + **Vite**
- **Tailwind CSS** 样式框架
- **Zustand** 状态管理
- **Socket.IO Client** 实时通信
- **Canvas 2D API** 渲染引擎

### 后端
- **Node.js** + **Express** + **TypeScript**
- **Socket.IO** WebSocket 服务
- **MongoDB** + **Mongoose** 数据持久化
- **Redis** 缓存与多实例广播适配器

## 3. 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (Client)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  React UI   │  │  Canvas     │  │  Socket.IO Client   │  │
│  │  Components │  │  Renderer   │  │  (Real-time Sync)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │             │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────────▼──────────┐  │
│  │  Zustand    │  │  DirtyRect  │  │  OT / UndoManager   │  │
│  │  Stores     │  │  Manager    │  │  / Command Pattern  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ WebSocket / HTTP
┌───────────────────────────▼─────────────────────────────────┐
│                       服务端 (Server)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Express    │  │  Socket.IO  │  │  OT Service         │  │
│  │  REST API   │  │  Server     │  │  (Transform/Apply)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │             │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────────▼──────────┐  │
│  │  Auth/JWT   │  │  Redis      │  │  Snapshot Service   │  │
│  │  Middleware │  │  Adapter    │  │  (10min interval)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  MongoDB    │  │  Operation  │  │  State Cache        │  │
│  │  (Mongoose) │  │  Log Service│  │  (Redis)            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 4. 三层 Canvas 渲染架构

```
┌────────────────────────────────────────┐
│           tempCanvas (临时层)            │  选区边框、手柄、工具预览
│           z-index: 3                   │
├────────────────────────────────────────┤
│           mainCanvas (主层)              │  元素本体渲染
│           z-index: 2                   │
├────────────────────────────────────────┤
│           bgCanvas (背景层)              │  网格背景
│           z-index: 1                   │
└────────────────────────────────────────┘
```

### 渲染流程
1. **背景层**：绘制网格，仅在视口变化时重绘
2. **主层**：渲染所有元素，使用脏矩形增量更新
3. **临时层**：渲染选区边框、变换手柄、工具预览

## 5. OT 流程图

```
User A                    Server                    User B
  │                         │                         │
  │ ────── op1 (x=50) ────> │                         │
  │                         │ ── transform(op1, op2) ─│
  │                         │                         │
  │ <──── ack + op1' ────── │                         │
  │                         │ ────── broadcast ─────> │
  │                         │                         │
  │                         │ <──── op2 (x=30) ────── │
  │                         │                         │
  │ <──── broadcast op2' ── │ ────── ack + op2' ────> │
```

### OT 核心规则
- **add vs add**：相同 id 去重
- **update vs update**：
  - 不同属性：合并
  - 相同属性（位置字段）：delta 反向补偿
  - 相同属性（非位置）：last-writer-wins
- **delete vs update**：丢弃 update
- **clear-all**：抹除一切

## 6. 数据流

### 操作流
```
Client Action -> Command -> UndoManager -> Socket Emit
                                              │
Server OT Apply -> Persist to MongoDB -> Broadcast
                                              │
Other Clients -> Apply Op -> Update Canvas Store -> Re-render
```

### 状态同步流
```
Client Join -> Request Current State <- MongoDB / Redis Cache
                │
                └─> Subscribe to Room -> Receive Real-time Ops
```

## 7. 模块划分

### 前端模块
| 模块 | 职责 |
|------|------|
| `canvas/` | Canvas 渲染引擎、元素定义、视口管理 |
| `components/` | React UI 组件（工具栏、属性面板等） |
| `hooks/` | 业务逻辑 Hook（绘图、选择、变换等） |
| `stores/` | Zustand 状态管理 |
| `services/` | API 客户端、Socket 连接 |
| `utils/` | 工具函数（UndoManager、性能测试等） |

### 后端模块
| 模块 | 职责 |
|------|------|
| `routes/` | RESTful API 路由 |
| `sockets/` | WebSocket 事件处理 |
| `ot/` | OT 算法核心（transform、compose） |
| `services/` | 业务服务（快照、日志、缓存） |
| `models/` | MongoDB 数据模型 |
| `middleware/` | Express 中间件（认证、错误处理） |

## 8. 关键设计决策

### 8.1 脏矩形增量渲染
- 只重绘变化的区域，而非全屏刷新
- 三层 Canvas 独立标记 dirty flag

### 8.2 离屏缓存
- 图片使用 Map 缓存 HTMLImageElement
- 避免重复加载同一 URL

### 8.3 视口持久化
- 按 whiteboardId 保存视口到 localStorage
- 刷新后恢复到上次视图位置

### 8.4 离线操作队列
- 断网时本地缓存操作
- 重连后按顺序补发

### 8.5 快照服务
- 每 10 分钟生成完整快照
- 保留最近 10 个快照
- 支持回滚到历史版本
