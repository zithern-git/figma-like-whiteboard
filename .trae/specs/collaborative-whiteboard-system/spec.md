# Figma-like 实时协作白板系统 技术规范

## Why
构建一个面向前端求职的作品集项目，展示 Canvas 2D 高性能渲染、WebSocket 实时通信、完整 OT 冲突解决算法和分布式系统设计能力。通过 100% 参考 Figma 的 UI/UX，确保无需设计经验即可产出专业级界面。

## What Changes
- 从零搭建完整的实时协作白板系统
- 实现用户认证（邮箱注册/登录 + JWT）
- 实现白板 CRUD 与权限控制
- 实现基于原生 Canvas 2D API 的绘图引擎（画笔、直线、矩形、圆形、文本、图片、橡皮擦）
- 实现三层渲染架构（背景层 + 主层 + 临时层）+ 离屏Canvas + 脏矩形渲染
- 实现操作控制（撤销/重做、缩放/平移、清空、导出）
- 实现 Socket.IO 驱动的实时多人协作（光标同步 + 完整 OT 冲突解决）
- 实现 Redis 消息发布订阅与分布式会话
- 实现完整的数据持久化体系（操作日志 + 定时快照 + 历史版本）
- 实现全面的错误处理与边界情况覆盖
- 本文件使用 **面试必问核心技术亮点** 标注关键模块

## Impact
- Affected specs: 全新项目，无影响现有功能
- Affected code: 全量新建

---

## ADDED Requirements

### Requirement: 项目架构与目录结构
系统 SHALL 采用 monorepo 结构，前端与后端分离部署，遵循模块化设计原则。

#### Scenario: 项目初始化
- **WHEN** 开发者执行 `npm create vite@latest client -- --template react` 创建前端项目，并手动创建 `server/` 目录
- **THEN** 前端项目使用 Vite 5 + React 18 + Tailwind CSS 3，后端使用 Node.js + Express + Socket.IO 4

#### Scenario: 目录结构
- **WHEN** 项目初始化完成
- **THEN** 生成如下目录结构：
```
d:\figma-like-whiteboard/
├── client/                          # 前端项目
│   ├── public/
│   ├── src/
│   │   ├── assets/                  # 静态资源
│   │   ├── canvas/                  # 🔥 Canvas核心渲染引擎（独立模块）
│   │   │   ├── CanvasRenderer.ts    # 渲染引擎核心（三层架构、视口变换、裁剪、rAF调度）
│   │   │   ├── ShapeRenderer.ts     # 图形渲染器（画笔、直线、矩形、圆形、文本、图片）
│   │   │   ├── DirtyRectManager.ts  # 脏矩形管理器（脏矩形追踪与合并）
│   │   │   ├── OffscreenCanvas.ts   # 离屏Canvas管理器
│   │   │   ├── CanvasElement.ts     # 元素数据结构与类型定义
│   │   │   └── index.ts             # 模块导出
│   │   ├── components/              # 通用UI组件
│   │   │   ├── layout/              # 布局组件（Navbar, Sidebar, Panel）
│   │   │   ├── canvas/              # Canvas UI组件（Canvas容器、远程光标、选择框等）
│   │   │   └── ui/                  # Button, Modal, Input等基础UI组件
│   │   ├── features/                # 功能模块
│   │   │   ├── auth/                # 认证模块
│   │   │   ├── whiteboard/          # 白板模块
│   │   │   └── collaboration/       # 协作模块
│   │   ├── hooks/                   # 自定义Hooks
│   │   ├── stores/                  # Zustand状态管理
│   │   ├── services/                # API/Socket服务层
│   │   ├── utils/                   # 工具函数（重试、错误处理等）
│   │   ├── types/                   # TypeScript类型定义
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── .eslintrc.cjs
├── server/                          # 后端项目
│   ├── src/
│   │   ├── config/                  # 配置（DB, Redis, JWT）
│   │   ├── middleware/              # 中间件（auth, error, cors, validate）
│   │   ├── models/                  # Mongoose模型
│   │   ├── routes/                  # RESTful路由
│   │   ├── sockets/                 # Socket.IO事件处理
│   │   ├── services/                # 业务逻辑层
│   │   ├── ot/                      # 🔥 OT算法模块（核心技术亮点）
│   │   │   ├── otService.ts         # OT冲突解决服务（版本检测、合并策略、操作分发）
│   │   │   ├── transform.ts         # 操作变换函数 transform() 和 compose()
│   │   │   ├── types.ts             # OT相关类型定义（Operation, TransformResult, OpLog, LamportClock）
│   │   │   ├── LamportClock.ts      # Lamport逻辑时钟实现
│   │   │   └── index.ts             # 模块导出
│   │   ├── utils/                   # 通用工具函数
│   │   ├── app.ts                   # Express应用入口
│   │   └── index.ts                 # 服务器启动入口
│   ├── package.json
│   ├── tsconfig.json
│   └── .eslintrc.cjs
├── docs/                            # 技术文档
│   ├── architecture.md              # 架构设计文档
│   ├── api.md                       # RESTful API接口文档
│   ├── websocket.md                 # WebSocket消息协议定义
│   └── deployment.md                # 部署指南
├── scripts/                         # 脚本目录
│   ├── dev.sh                       # 开发环境启动脚本
│   ├── build.sh                     # 构建脚本
│   └── deploy.sh                    # 部署脚本
├── tests/                           # 测试目录
│   ├── client/                      # 前端测试
│   └── server/                      # 后端测试
├── .prettierrc
├── .gitignore
└── README.md
```

### Requirement: 用户认证模块
系统 SHALL 提供基于邮箱的注册与登录功能，使用 JWT 进行身份认证。

#### Scenario: 用户注册
- **WHEN** 用户提供邮箱和密码完成注册
- **THEN** 系统在 MongoDB 中创建用户记录（密码经 bcrypt 哈希后存储），返回 JWT token，用户自动登录

#### Scenario: 用户登录
- **WHEN** 用户提供正确的邮箱和密码
- **THEN** 系统验证凭据，返回 JWT token（有效期7天），前端将 token 存入 localStorage 并设置到请求头

#### Scenario: 认证中间件
- **WHEN** 任何受保护的 API 请求到达
- **THEN** 中间件验证请求头 `Authorization: Bearer <token>`，无效 token 返回 401

#### Scenario: 在线用户列表
- **WHEN** 用户连接或断开 WebSocket
- **THEN** 系统通过 Redis 维护在线用户集合，广播在线用户列表变化给白板内的所有用户

### Requirement: 白板管理模块
系统 SHALL 支持白板的创建、加入、删除和列表展示。

#### Scenario: 创建白板
- **WHEN** 已认证用户请求创建白板（提供名称）
- **THEN** 系统生成唯一的白板ID（6位短码），创建者即为所有者，返回白板信息

#### Scenario: 获取白板列表
- **WHEN** 用户请求白板列表
- **THEN** 系统返回用户拥有的和参与协作的所有白板

#### Scenario: 加入白板
- **WHEN** 用户通过白板ID或邀请链接加入白板
- **THEN** 系统验证白板存在，将用户添加到协作者列表，允许其进入白板

#### Scenario: 删除白板
- **WHEN** 白板所有者请求删除白板
- **THEN** 系统软删除白板（设置 deleted 标记），所有数据保留，非所有者请求删除返回 403

#### Scenario: 权限控制
- **WHEN** 用户对白板执行操作
- **THEN** 区分三种角色：
  - **owner**（所有者）：完全控制权，包括删除白板、管理协作者
  - **editor**（编辑者）：可绘制和修改
  - **viewer**（查看者）：只读，不可修改

---

### Requirement: 核心绘图引擎 🔥 面试必问
系统 SHALL 实现基于原生 Canvas 2D API 的完整绘图引擎，支持多种图形类型和高性能渲染。**禁止使用任何第三方 Canvas 库**。

#### Scenario: 三层渲染架构 🔥
- **WHEN** Canvas 组件挂载
- **THEN** 系统采用严格的三层渲染架构：
  - **背景层（Background Layer）**：最底层 Canvas，仅绘制网格背景和画布底色，仅在缩放/平移时重绘
  - **主层（Main Layer）**：中间层 Canvas，绘制所有已确认的静态元素，使用离屏Canvas预渲染 + 脏矩形增量更新
  - **临时层（Temp Layer）**：最顶层 Canvas，绘制正在交互中的临时元素（拖拽预览、选择框、多选手柄、远程光标），每帧全量重绘
  - 三层 Canvas 通过 CSS `position: absolute` 叠加，尺寸完全对齐

#### Scenario: 离屏Canvas渲染 🔥
- **WHEN** 主层需要渲染静态元素
- **THEN** 系统使用离屏Canvas（OffscreenCanvas）预渲染复杂元素：
  - 每个复杂元素（画笔路径、带文本的组合图形）在离屏Canvas上预渲染为位图缓存
  - 主层渲染时直接 `drawImage(offscreenCanvas, ...)` 绘制缓存位图，避免重复计算
  - 元素内容变更时使缓存失效，重新预渲染
  - 缓存按需创建，使用 LRU 策略管理内存（最多缓存最近50个元素）

#### Scenario: 脏矩形渲染算法 🔥
- **WHEN** 仅部分元素发生变化
- **THEN** 渲染引擎使用脏矩形(Dirty Rect)算法实现增量渲染：
  - 维护一个脏矩形列表（DirtyRect[]），记录所有需要重绘的屏幕区域
  - 多个脏矩形进行合并（union）以减少绘制区域
  - 重绘时先 `save()` + `clip()` 限定绘制区域，仅重绘脏矩形内的内容
  - 合并后的脏矩形数量不超过4个，超过则退化为全画布重绘
  - 背景层和主层分别维护独立的脏矩形列表

#### Scenario: 图形类型支持
- **WHEN** 用户选择绘图工具
- **THEN** 系统支持以下图形类型：
  - **画笔（Pen）**：自由绘制路径，记录点序列，使用 Catmull-Rom 曲线平滑
  - **直线（Line）**：两个端点定义，支持箭头端点样式
  - **矩形（Rectangle）**：x, y, width, height，支持圆角半径
  - **圆形（Circle/Ellipse）**：中心点 + 半径（或长短轴）
  - **文本（Text）**：位置 + 内容 + 字体属性（fontSize, fontFamily, color, alignment, bold, italic）
  - **图片（Image）**：位置 + 图片URL/Base64 + 尺寸，支持拖拽调整
  - **橡皮擦（Eraser）**：通过碰撞检测删除与橡皮擦轨迹相交的元素

#### Scenario: 元素数据结构
- **WHEN** 用户创建任意图形
- **THEN** 每个元素存储为统一的数据结构：
```typescript
interface Point {
  x: number;
  y: number;
}

interface CanvasElement {
  id: string;           // 唯一标识（nanoid）
  type: 'pen' | 'line' | 'rect' | 'circle' | 'text' | 'image';
  x: number;            // 包围盒左上角X
  y: number;            // 包围盒左上角Y
  width: number;        // 包围盒宽
  height: number;       // 包围盒高
  rotation: number;     // 旋转角度（弧度，默认0）
  opacity: number;      // 透明度 0-1（默认1）
  fill: string;         // 填充色（hex格式，默认'#000000'）
  stroke: string;       // 描边色（hex格式，默认'#000000'）
  strokeWidth: number;  // 描边宽度（默认2）
  points?: Point[];     // 画笔/直线点序列
  text?: string;        // 文本内容
  fontSize?: number;    // 字号（默认16）
  fontFamily?: string;  // 字体（默认'Arial'）
  imageUrl?: string;    // 图片URL
  version: number;      // 乐观锁版本号（从1开始自增）
  lockUserId?: string;  // 当前编辑者（乐观锁用）
  createdAt: number;    // 创建时间戳
  updatedAt: number;    // 最后更新时间戳
  createdBy: string;    // 创建者用户ID
}
```

#### Scenario: 量化性能指标 🔥
- **WHEN** 白板包含1000+静态元素
- **THEN** 渲染帧率稳定在 **60fps**（Chrome DevTools Performance 面板验证）
- **WHEN** 50人同时绘制（通过 WebSocket 模拟并发操作）
- **THEN** 渲染帧率不低于 **45fps**，首帧渲染时间不超过 16ms

#### Scenario: 性能优化 — 视口裁剪
- **WHEN** 白板包含大量元素
- **THEN** 渲染引擎仅绘制当前视口内的元素，视口外的元素完全跳过渲染，通过包围盒与视口矩形相交检测实现

#### Scenario: 性能优化 — requestAnimationFrame 调度
- **WHEN** 需要重绘画布
- **THEN** 使用 requestAnimationFrame 进行渲染调度，同一帧内的多次重绘请求合并为一次执行，在 rAF 回调中统一处理脏矩形列表

---

### Requirement: 操作控制模块
系统 SHALL 提供撤销/重做、画布缩放/平移、清空和导出功能。

#### Scenario: 撤销与重做（Undo/Redo）
- **WHEN** 用户按 Ctrl+Z 或 Ctrl+Y
- **THEN** 系统基于命令模式实现：
  - 每个操作（添加、修改、删除元素）都生成一个命令对象（command）
  - 命令对象包含 execute() 和 undo() 方法
  - 操作历史维护 undoStack 和 redoStack
  - 支持 batch undo（连续同类型操作合并为一个命令）
  - 本地操作和远程操作均纳入历史记录
  - 历史栈限制在50步以内，超出后移除最早记录

#### Scenario: 画布缩放
- **WHEN** 用户使用鼠标滚轮（或 Alt+滚轮）
- **THEN** 系统以鼠标位置为中心进行缩放，缩放范围 0.1x ~ 10x，缩放时显示当前缩放百分比提示

#### Scenario: 画布平移
- **WHEN** 用户按住空格键并使用鼠标拖拽，或使用触控板双指手势
- **THEN** 画布视口按拖拽方向和距离平移

#### Scenario: 快捷键支持
- **WHEN** 用户在画布上使用快捷键
- **THEN** 支持以下快捷键（与 Figma 保持一致）：
  - **Ctrl+Z / Ctrl+Y**：撤销/重做
  - **V**：选择工具 | **P**：画笔 | **L**：直线 | **R**：矩形 | **O**：圆形 | **T**：文本 | **E**：橡皮擦
  - **Delete / Backspace**：删除选中元素
  - **Ctrl+D**：复制选中元素 | **Ctrl+A**：全选
  - **Space+拖拽**：平移画布 | **Shift+拖拽**：等比例缩放 | **Alt+滚轮**：缩放
  - **Ctrl+Shift+E**：导出为PNG
  - **Ctrl+Shift+Delete**：清空画布

#### Scenario: 导出图片
- **WHEN** 用户触发导出功能
- **THEN** 系统将当前视口内的白板内容渲染到离屏Canvas，导出为 PNG 格式，触发浏览器下载

#### Scenario: 清空画布
- **WHEN** 用户触发清空画布操作
- **THEN** 系统删除画布上所有元素，生成一条 `clear-all` 操作命令（可撤销），清空后画布仅保留网格背景
- **AND** `clear-all` 作为特殊操作类型，在 OT 处理中直接清空所有元素，不与其他操作进行变换

---

### Requirement: 实时协作模块
系统 SHALL 支持多人同时编辑同一白板，实时同步操作和光标位置。

#### Scenario: 加入协作会话
- **WHEN** 用户进入白板页面
- **THEN** 客户端通过 Socket.IO 连接到后端，发送 `join-whiteboard` 事件（携带 whiteboardId 和 JWT），后端验证后将用户加入对应的 Socket.IO room

#### Scenario: 操作同步
- **WHEN** 用户在白板上执行绘图、修改、删除等操作
- **THEN** 客户端通过 Socket.IO 发送 `element-op` 事件，后端广播给 room 内其他用户（排除发送者）

#### Scenario: 光标同步
- **WHEN** 用户在画布上移动鼠标
- **THEN** 客户端通过节流（throttle 50ms）发送 `cursor-move` 事件，包含用户ID、用户名、颜色、屏幕坐标，其他客户端渲染远程用户光标

#### Scenario: 用户断线重连
- **WHEN** 用户网络断开后重新连接
- **THEN** 系统通过 Socket.IO 自动重连（指数退避算法），发送 `rejoin-whiteboard` 事件，服务端推送自上次断开后的增量操作，未同步部分一次性下发

---

### Requirement: OT 冲突解决算法 🔥🔥🔥 面试必问核心
系统 SHALL 实现完整的操作变换（Operational Transformation）算法，**禁止使用简单的"最后写入胜出"（Last Write Wins）策略**。

#### Scenario: OT 核心函数 — transform() 🔥
- **WHEN** 两个并发操作 O1 和 O2 基于同一状态产生
- **THEN** 系统实现 `transform(op1, op2)` 函数：
  - 输入：两个基于同一状态的操作 O1（先执行）、O2（后执行）
  - 输出：变换后的 O2'，使得 O2' 基于 O1 执行后的状态
  - 变换规则：
    - add vs add/update：不变（元素ID不同）
    - update vs update（同元素）：
      - 不同属性 → 合并两个修改
      - 相同属性 → O2 覆盖 O1 的值
      - 位置/尺寸属性 → O2 的坐标需要根据 O1 的变换调整
    - delete vs update（同元素）：update 操作丢弃
    - delete vs delete（同元素）：后一个 delete 变为空操作
    - clear-all 操作：作为特殊操作类型，在 OT 处理中直接清空所有元素，不与其他操作进行变换
  - 函数为纯函数，不产生副作用

#### Scenario: OT 核心函数 — compose() 🔥
- **WHEN** 需要合并两个连续的操作 Oa 和 Ob（Ob 基于 Oa 执行后的状态）
- **THEN** 系统实现 `compose(opA, opB)` 函数：
  - 输入：操作 Oa 和基于 Oa 执行后状态的 Ob
  - 输出：合并后的操作 Oab，直接作用于 Oa 执行前的状态即可得到 Ob 执行后的状态
  - 用于压缩操作序列，减少存储和传输开销
  - 合并规则：
    - 连续修改同一元素的同一属性：取最终值
    - 连续修改同一元素的不同属性：合并为一个多属性修改操作
    - add + delete 同一元素：空操作（抵消）

#### Scenario: 操作乱序处理 🔥
- **WHEN** 网络延迟导致操作到达服务端的顺序与产生顺序不一致
- **THEN** 服务端通过以下机制处理乱序：
  - 每个操作携带生成时的全局时钟序号（Lamport Timestamp）
  - 服务端维护每个客户端已确认的操作序号
  - 收到乱序操作时，先缓冲等待前序操作到达，再依次处理
  - 超时（200ms）仍未收到前序操作，则请求客户端重传

#### Scenario: 3+用户并发编辑 🔥
- **WHEN** 3个或更多用户同时编辑同一画布的不同元素
- **THEN** 所有用户最终看到一致的画布状态，无数据丢失，无元素错位

#### Scenario: 操作历史可追溯
- **WHEN** 需要查看白板的操作历史
- **THEN** 系统支持查询任意时间范围内的操作日志，包含操作者、操作类型、操作时间、操作前后状态

#### Scenario: OT 算法类型定义
- **WHEN** 实现 OT 算法
- **THEN** 使用以下类型定义：
```typescript
// OT 操作类型
interface Operation {
  id: string;              // 操作唯一ID
  userId: string;          // 操作者ID
  whiteboardId: string;    // 白板ID
  type: 'add' | 'update' | 'delete' | 'clear-all';  // 操作类型
  elementId: string;       // 目标元素ID
  data?: Partial<CanvasElement>;  // 操作数据（新增/修改时）
  baseVersion: number;     // 操作的基准版本
  lamportClock: number;    // Lamport逻辑时钟
  timestamp: number;       // 操作时间戳
}

// OT 变换结果
interface TransformResult {
  operation: Operation;    // 变换后的操作
  applied: boolean;        // 是否实际应用（false表示操作被丢弃）
}

// 操作日志条目
interface OperationLog {
  operation: Operation;
  snapshotBefore: Partial<CanvasElement> | null;  // 操作前元素状态
  snapshotAfter: Partial<CanvasElement> | null;   // 操作后元素状态
  serverTimestamp: number;  // 服务端接收时间戳
}

// Lamport 逻辑时钟
interface LamportClock {
  counter: number;  // 当前时钟值（从0开始自增）
  tick(): number;   // 自增并返回新值
  update(received: number): void;  // 更新为 max(local, received) + 1
}
```

---

### Requirement: 数据持久化体系 🔥 面试亮点
系统 SHALL 实现完整的数据持久化体系，确保数据不丢失且可追溯。

#### Scenario: 操作日志实时写入
- **WHEN** 服务端接收到任何白板操作
- **THEN** 操作日志立即写入 MongoDB `operations` 集合，写入延迟 **<50ms**（P95），包含操作快照（操作前后元素状态）

#### Scenario: 定时快照生成
- **WHEN** 白板创建后
- **THEN** 系统每 **10分钟** 自动生成一次白板完整快照，存入 MongoDB `snapshots` 集合：
  - 快照包含：所有元素完整状态、操作序号、生成时间戳
  - 保留最近10个快照，超出数量的旧快照自动删除
  - 同时设置 TTL 索引 30天作为兜底清理策略（防止异常情况下无限增长）
  - 快照生成异步执行（setInterval），不阻塞操作处理

#### Scenario: 新用户加入加载流程
- **WHEN** 新用户加入白板
- **THEN** 系统按以下顺序加载数据：
  1. 从 MongoDB 读取最新快照
  2. 从 MongoDB 读取快照之后的所有操作日志
  3. 在内存中依次应用操作日志，重建最新状态
  4. 将最新状态推送给客户端
  5. 此过程在 2 秒内完成

#### Scenario: 历史版本查看与回滚
- **WHEN** 用户需要查看或恢复到历史版本
- **THEN** 系统支持：
  - 列出所有快照时间点（GET /api/whiteboards/:id/snapshots）
  - 预览指定快照的白板内容（GET /api/whiteboards/:id/snapshots/:snapshotId）
  - 将白板回滚到指定快照（POST /api/whiteboards/:id/rollback），回滚操作本身也作为一条操作日志记录

#### Scenario: MongoDB 集合设计
- **WHEN** 数据库初始化
- **THEN** 创建以下集合：
  - `users`：{ email, password(hashed), name, avatar, createdAt, updatedAt }
  - `whiteboards`：{ shortId, name, ownerId, collaborators[{userId, role}], elements: CanvasElement[], currentSnapshotId, deleted, createdAt, updatedAt }
  - `operations`：{ whiteboardId, operation(完整Operation对象), snapshotBefore, snapshotAfter, serverTimestamp }，索引：{ whiteboardId: 1, serverTimestamp: 1 }
  - `snapshots`：{ whiteboardId, elements[], operationSeq, timestamp, size }，索引：{ whiteboardId: 1, timestamp: -1 }，保留最近10个快照，TTL 索引 30天兜底清理

---

### Requirement: 错误处理与边界情况
系统 SHALL 实现全面的错误处理和边界情况覆盖，确保系统鲁棒性。

#### Scenario: 前端全局错误捕获
- **WHEN** 前端发生未捕获的 JavaScript 异常
- **THEN** 系统通过 ErrorBoundary 组件捕获错误，显示友好的错误提示页面（而非白屏），并记录错误信息到控制台。Canvas 渲染错误不影响 React 组件树的其他部分。

#### Scenario: 网络请求失败自动重试
- **WHEN** REST API 请求因网络问题失败（超时、5xx 错误）
- **THEN** 系统自动重试，最多 **3次**，每次重试间隔递增（1s → 2s → 4s），3次均失败后显示错误提示。重试机制实现在 axios 拦截器中。

#### Scenario: WebSocket 断线自动重连
- **WHEN** WebSocket 连接断开
- **THEN** Socket.IO 客户端使用 **指数退避算法** 自动重连：
  - 初始重连延迟：1s
  - 最大重连延迟：30s
  - 退避因子：2x（即 1s → 2s → 4s → 8s → 16s → 30s → 30s...）
  - 重连成功后自动发送 `rejoin-whiteboard` 同步状态
  - 重连过程中显示"连接断开，正在重连..."提示

#### Scenario: 后端参数校验
- **WHEN** API 请求到达
- **THEN** 中间件对所有请求参数进行校验：
  - 必填字段检查
  - 类型校验（string/number/email 格式）
  - 长度/范围限制
  - 校验失败返回 400，包含具体的错误字段和原因

#### Scenario: 统一错误响应格式
- **WHEN** API 处理过程中发生任何错误
- **THEN** 系统返回统一的错误响应格式：
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "具体错误描述",
    "details": { "field": "email", "reason": "Invalid email format" }
  }
}
```
- 支持的错误码：VALIDATION_ERROR, AUTH_ERROR, NOT_FOUND, FORBIDDEN, CONFLICT, INTERNAL_ERROR

#### Scenario: 边界情况处理
- **WHEN** 遇到以下边界情况
- **THEN** 系统正确处理：
  - 空画布（无元素）：正常渲染网格背景
  - 元素移出画布视口：正常渲染，元素数据保留
  - 超长文本（>500字符）：Canvas 渲染时自动截断并显示省略号
  - 超大图片（>10MB）：前端压缩后上传，服务端限制10MB
  - 同时打开多个浏览器标签页：每个标签页独立维护 Socket 连接
  - 浏览器窗口失焦：暂停不必要的渲染，恢复焦点后恢复
  - 页面刷新：通过 localStorage 恢复 token，通过快照+增量恢复画布状态

---

### Requirement: 量化性能测试指标 🔥
系统 SHALL 满足以下量化性能指标，所有指标均可通过工具验证。

#### Scenario: 前端性能指标
- **WHEN** 使用 Chrome Lighthouse 评估
- **THEN** 满足：
  - **页面首次加载时间（FCP）**：**< 2s**
  - **Lighthouse Performance 评分**：**> 90分**
  - **加载1000元素白板**：首帧渲染 < 500ms
  - **1000+静态元素持续渲染**：**60fps** 稳定
  - **50人同时绘制**：**≥ 45fps**

#### Scenario: 后端性能指标
- **WHEN** 100用户同时在线协作
- **THEN** 满足：
  - **服务器 CPU 使用率**：**< 70%**
  - **服务器内存使用**：**< 512MB**
  - **单操作端到端同步延迟**（用户A操作 → 用户B看到）：**< 100ms**（P95）
  - **操作日志写入延迟**：**< 50ms**（P95）

#### Scenario: WebSocket 性能
- **WHEN** 100用户同时在线
- **THEN** 满足：
  - WebSocket 消息从发送到广播的延迟：**< 50ms**（P95）
  - 断线重连时间：**< 5s**（在30s最大退避内）

---

### Requirement: Redis 消息发布订阅与会话管理
系统 SHALL 使用 Redis 实现 Socket.IO 多实例间的消息广播和分布式会话管理。

#### Scenario: Redis Pub/Sub 多实例广播
- **WHEN** 后端部署多个实例（水平扩展）
- **THEN** 使用 `@socket.io/redis-adapter` 通过 Redis Pub/Sub 在不同实例间转发 Socket.IO 事件，确保连接到不同实例的用户能相互通信

#### Scenario: Redis 分布式会话
- **WHEN** 用户登录后
- **THEN** 服务端将 Session 信息存入 Redis（key: `session:{userId}`，value: JWT token + 用户信息 + TTL），后续 API 请求通过 Redis 验证会话有效性

#### Scenario: Redis 在线用户跟踪
- **WHEN** 用户连接或断开
- **THEN** 使用 Redis Set 维护每个白板的在线用户ID集合（key: `whiteboard:{id}:online`），用于快速查询在线用户列表

#### Scenario: Redis 白板状态缓存
- **WHEN** 白板状态更新
- **THEN** 系统将白板当前元素列表缓存到 Redis（key: `whiteboard:{id}:state`，TTL=5分钟），读取白板时优先从 Redis 缓存获取，加速读取响应

---

### Requirement: UI 与布局
系统 SHALL 采用与 Figma 一致的界面布局和交互模式。

#### Scenario: 布局结构
- **WHEN** 用户进入白板页面
- **THEN** 页面呈现以下布局：
  - **顶部导航栏**：高度 48px，固定顶部，白色背景，包含白板名称、用户头像、协作人数、分享按钮
  - **左侧工具栏**：宽度 64px，固定左侧，背景色 `#F5F5F5`，上下排列工具图标按钮
  - **右侧属性面板**：宽度 280px，可折叠，白色背景，显示选中元素的属性（位置、尺寸、颜色、透明度等）
  - **中间画布区域**：占满剩余空间，浅灰色网格背景（`#E5E5E5`），网格间距 20px

#### Scenario: 工具按钮交互
- **WHEN** 用户与工具栏按钮交互
- **THEN** 按钮尺寸 44x44px，有 hover（背景色变化）和 active（按下态）状态，当前选中工具高亮显示

#### Scenario: 属性面板
- **WHEN** 无元素被选中
- **THEN** 属性面板显示空状态或画布整体属性
- **WHEN** 有元素被选中
- **THEN** 属性面板显示元素的：X/Y 坐标、宽/高（锁比例按钮）、旋转角度、填充色（颜色选择器）、描边色和描边宽度、透明度滑块

### Requirement: 工程化目录结构
系统 SHALL 具备独立的工程化支撑目录，提升项目的专业性和可维护性。

#### Scenario: 技术文档目录
- **WHEN** 项目初始化完成
- **THEN** `docs/` 目录包含：architecture.md、api.md、websocket.md、deployment.md

#### Scenario: 脚本目录
- **WHEN** 项目初始化完成
- **THEN** `scripts/` 目录包含：dev.sh、build.sh、deploy.sh

#### Scenario: 测试目录
- **WHEN** 项目初始化完成
- **THEN** `tests/` 目录包含：client/（前端测试）、server/（后端测试）

#### Scenario: 前端 Canvas 引擎独立目录
- **WHEN** 项目初始化完成
- **THEN** `client/src/canvas/` 目录作为 Canvas 核心渲染引擎的独立模块，包含：
  - `CanvasRenderer.ts`：渲染引擎核心（三层架构、视口变换矩阵、视口裁剪、rAF调度）
  - `ShapeRenderer.ts`：图形渲染器（画笔、直线、矩形、圆形、文本、图片）
  - `DirtyRectManager.ts`：脏矩形管理器（追踪、合并、裁剪）
  - `OffscreenCanvas.ts`：离屏Canvas管理器（预渲染缓存、LRU淘汰）
  - `CanvasElement.ts`：元素数据结构与类型定义
  - `index.ts`：模块统一导出
- **AND** `client/src/components/canvas/` 仅保留 UI 相关组件

#### Scenario: 后端 OT 算法独立目录
- **WHEN** 项目初始化完成
- **THEN** `server/src/ot/` 目录作为 OT 算法的独立模块，包含：
  - `otService.ts`：OT 冲突解决服务（版本检测、合并策略、操作分发）
  - `transform.ts`：操作变换函数 `transform()` 和 `compose()`
  - `types.ts`：OT 相关类型定义（Operation, TransformResult, OperationLog, LamportClock）
  - `LamportClock.ts`：Lamport 逻辑时钟实现
  - `index.ts`：模块统一导出

---

### Requirement: Vibe Coding 能力验证
本系统使用 **TRAE CN SOLO** 模式开发，作为 AI 辅助工程化开发的实践案例。

#### Scenario: 开发模式
- **WHEN** 进行项目开发
- **THEN** 遵循以下分工：
  - **AI 生成（100%）**：基础 CRUD 代码、UI 组件代码、配置模板、文档模板
  - **AI 生成框架 + 人工优化**：OT 核心算法（transform/compose）、Canvas 渲染引擎（三层架构、脏矩形）
  - **人工编写**：性能调优参数、最终验收测试

#### Scenario: 开发周期
- **WHEN** 项目从零开始
- **THEN** 预计总开发时间：**12-14 小时**（含文档编写和测试）

---

### Requirement: 代码规范与质量
系统 SHALL 遵循统一的代码规范并保证代码质量。

#### Scenario: 代码规范
- **WHEN** 开发者提交代码
- **THEN** ESLint + Prettier 自动检查和格式化代码，确保代码风格一致

#### Scenario: 关键逻辑注释
- **WHEN** 实现复杂算法（OT transform/compose、Canvas 三层渲染、脏矩形、离屏Canvas）
- **THEN** 代码中包含详细的中文注释，解释算法原理和关键步骤，满足面试讲解需求

---

## 技术决策说明

### 三层渲染架构设计
1. **背景层**：仅在缩放/平移时重绘，绘制网格和底色，开销极小
2. **主层**：使用离屏Canvas预渲染 + 脏矩形增量更新，静态元素变更时仅重绘受影响区域
3. **临时层**：每帧全量重绘，但仅包含少量交互元素（选择框、拖拽预览、远程光标），开销可控

### OT 算法设计
采用完整的 OT 变换链算法，而非简单的版本号比较：
1. `transform(op1, op2)`：处理并发操作的变换，解决操作乱序问题
2. `compose(opA, opB)`：合并连续操作，压缩操作序列
3. Lamport 逻辑时钟：处理操作乱序到达
4. 操作日志完整记录：支持历史追溯和回滚

### 数据持久化策略
1. **操作日志实时写入**：每个操作立即写入 MongoDB，保证数据不丢失
2. **定时快照**：每10分钟生成完整快照，加速新用户加载和历史版本查看
3. **快照 + 增量恢复**：新用户加载最新快照后仅需应用少量增量操作
4. **历史版本回滚**：基于快照实现任意时间点回滚

### 性能优化策略总览
1. **视口裁剪（Viewport Culling）**：仅渲染可视区域内的元素
2. **离屏Canvas预渲染**：复杂元素缓存为位图，避免重复绘制
3. **脏矩形增量渲染**：仅重绘变更区域，而非全画布
4. **requestAnimationFrame 批处理**：合并同一帧内的多次重绘请求
5. **三层分层渲染**：静态内容和动态内容分离，减少不必要的重绘