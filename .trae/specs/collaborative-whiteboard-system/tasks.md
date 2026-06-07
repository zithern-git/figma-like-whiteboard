# Tasks: 实时协作白板系统

> 标注说明：🔥 = 面试必问核心技术亮点

## Phase 1: 项目基础设施搭建

- [ ] **Task 1: 初始化前端项目**
  - [ ] 使用 Vite 5 创建 React + TypeScript 前端项目
  - [ ] 安装核心依赖：react-router-dom, zustand, socket.io-client, tailwindcss, postcss, autoprefixer, axios
  - [ ] 配置 Tailwind CSS（tailwind.config.js, postcss.config.js, index.css）
  - [ ] 配置 Vite（路径别名 `@/` → `src/`，开发代理 `/api` → `http://localhost:3001`，端口 5173）
  - [ ] 配置 ESLint + Prettier（.eslintrc.cjs, .prettierrc）
  - [ ] 创建基础目录结构（canvas, components, features, hooks, stores, services, utils, types）
  - [ ] 搭建 React Router 路由骨架（登录页、注册页、白板列表页、白板编辑页）
  - [ ] 创建 axios 实例（services/api.ts），配置 baseURL、超时、拦截器

- [ ] **Task 2: 初始化后端项目**
  - [ ] 手动创建 server/ 目录和 package.json
  - [ ] 安装核心依赖：express, socket.io, mongoose, redis, jsonwebtoken, bcryptjs, cors, dotenv, nanoid, multer
  - [ ] 安装开发依赖：typescript, ts-node-dev, @types/*
  - [ ] 配置 TypeScript（tsconfig.json）
  - [ ] 创建基础目录结构（config, middleware, models, routes, sockets, services, ot, utils）
  - [ ] 实现 Express 应用入口（app.ts）和服务器启动（index.ts），端口 3001
  - [ ] 实现 MongoDB 连接配置（config/db.ts），连接 mongodb://localhost:27017/whiteboard
  - [ ] 实现 Redis 连接配置（config/redis.ts），连接 redis://localhost:6379
  - [ ] 实现基础中间件（cors, json, error handler）
  - [ ] 配置环境变量（.env 模板：PORT, MONGODB_URI, REDIS_URL, JWT_SECRET, JWT_EXPIRES_IN）

## Phase 2: 用户认证模块

- [ ] **Task 3: 后端 — 用户认证系统**
  - [ ] 创建 User Mongoose 模型（email 唯一索引, password, name, avatar, createdAt, updatedAt）
  - [ ] 实现注册 API（POST /api/auth/register），密码 bcrypt 哈希（saltRounds=10），返回 JWT
  - [ ] 实现登录 API（POST /api/auth/login），验证凭据，返回 JWT（7天有效期）
  - [ ] 实现获取当前用户 API（GET /api/auth/me），需认证中间件
  - [ ] 实现 JWT 认证中间件（middleware/auth.ts）
  - [ ] 实现参数校验中间件（middleware/validate.ts），校验 email 格式、密码长度≥6
  - [ ] 实现 Redis Session 存储（登录后 Session 写入 Redis，key: `session:{userId}`，TTL=7天）

- [ ] **Task 4: 前端 — 用户认证 UI**
  - [ ] 创建登录页面组件（features/auth/LoginPage.tsx），Tailwind 样式，参考 Figma 风格
  - [ ] 创建注册页面组件（features/auth/RegisterPage.tsx）
  - [ ] 实现 authStore（Zustand）：user, token, isAuthenticated, login(), register(), logout() actions
  - [ ] 实现 authService（services/auth.ts），封装注册/登录 API 调用
  - [ ] 实现 axios 拦截器：请求自动添加 Authorization 头，响应拦截处理 401 自动登出
  - [ ] 实现路由守卫（ProtectedRoute 组件，未认证重定向到登录页）
  - [ ] 实现全局状态初始化（App 启动时从 localStorage 恢复 token，调用 /api/auth/me 验证有效性）

## Phase 3: 白板管理模块

- [ ] **Task 5: 后端 — 白板 CRUD 与权限**
  - [ ] 创建 Whiteboard Mongoose 模型（shortId 唯一索引, name, ownerId, collaborators[{userId, role}], elements: CanvasElement[], currentSnapshotId, deleted, createdAt, updatedAt）
  - [ ] 实现创建白板 API（POST /api/whiteboards），生成6位 shortId（nanoid），创建者设为 owner
  - [ ] 实现获取白板列表 API（GET /api/whiteboards），返回用户拥有的和参与的白板
  - [ ] 实现获取单个白板 API（GET /api/whiteboards/:id），含权限验证（至少 viewer）
  - [ ] 实现删除白板 API（DELETE /api/whiteboards/:id），仅 owner 可操作，软删除（deleted=true）
  - [ ] 实现加入白板 API（POST /api/whiteboards/:id/join），通过 shortId 加入，默认 editor 角色
  - [ ] 实现权限中间件（middleware/permission.ts），区分 owner/editor/viewer 三级权限
  - [ ] 所有 API 返回统一格式 `{ success: true, data: ... }` 或 `{ success: false, error: { code, message, details } }`

- [ ] **Task 6: 前端 — 白板管理 UI**
  - [ ] 创建白板列表页（features/whiteboard/WhiteboardListPage.tsx），卡片网格布局，显示名称、创建时间、协作人数
  - [ ] 创建创建白板弹窗（Modal 组件，输入白板名称）
  - [ ] 创建加入白板弹窗（输入6位白板 shortId）
  - [ ] 实现 whiteboardStore（Zustand）：whiteboards[], createWhiteboard(), deleteWhiteboard(), joinWhiteboard() actions
  - [ ] 实现 whiteboardService（封装白板相关 API 调用）
  - [ ] 实现白板列表页路由（/whiteboards）和导航

## Phase 4: 核心绘图引擎 🔥

- [ ] **Task 7: 前端 — Canvas 渲染引擎核心 🔥**
  - [ ] 创建 CanvasElement 数据结构与类型定义（canvas/CanvasElement.ts）
  - [ ] 创建 Canvas 渲染引擎核心类（canvas/CanvasRenderer.ts）：
    - Canvas 初始化与尺寸管理（响应式 ResizeObserver）
    - 视口变换矩阵（translate + scale）：screenToWorld() / worldToScreen() 坐标转换
    - 背景网格绘制（20px 间距，浅灰色）
    - 视口裁剪：仅渲染当前视口内的元素（包围盒 vs 视口矩形相交检测）
    - requestAnimationFrame 渲染调度：合并同一帧内的多次重绘请求
  - [ ] 创建三层 Canvas DOM 结构（components/canvas/Canvas.tsx）：
    - 背景层 Canvas：z-index 1，仅绘制网格和底色
    - 主层 Canvas：z-index 2，绘制所有静态元素
    - 临时层 Canvas：z-index 3，绘制交互中的临时元素
    - 三层通过 CSS `position: absolute` 叠加，尺寸完全对齐
  - [ ] 创建缩放/平移 Hook（hooks/useCanvasViewport.ts）：
    - 滚轮缩放（以鼠标位置为中心，缩放范围 0.1x~10x）
    - 空格+拖拽平移
    - Alt+滚轮缩放（备选方案）
    - 缩放百分比实时显示

- [ ] **Task 8: 前端 — 三层渲染与性能优化 🔥**
  - [ ] 实现离屏Canvas管理器（canvas/OffscreenCanvas.ts）：
    - 为复杂元素（画笔路径、文本）创建离屏Canvas预渲染为位图缓存
    - 主层渲染时直接 `drawImage(offscreenCanvas, ...)` 绘制缓存
    - 元素变更时使缓存失效并重新预渲染
    - LRU 缓存淘汰策略（最多缓存50个元素）
  - [ ] 实现脏矩形管理器（canvas/DirtyRectManager.ts）：
    - 维护脏矩形列表 DirtyRect[]，记录需要重绘的屏幕区域
    - 多个脏矩形合并（union）以减少绘制区域，最多合并为4个
    - 超过4个脏矩形时退化为全画布重绘
    - 重绘时使用 `save()` + `clip()` 限定绘制区域
    - 背景层和主层分别维护独立的脏矩形列表
  - [ ] 实现图形渲染器（canvas/ShapeRenderer.ts）：
    - renderPen()：Canvas Path2D 绘制自由路径，Catmull-Rom 曲线平滑
    - renderLine()：绘制直线（支持箭头端点样式）
    - renderRect()：绘制矩形（含圆角半径）
    - renderCircle()：绘制圆形/椭圆
    - renderText()：Canvas fillText 绘制文本（支持 fontSize, fontFamily, color, alignment, bold, italic）
    - renderImage()：drawImage 绘制图片（支持缩放和裁剪）
  - [ ] 创建模块统一导出（canvas/index.ts）

- [ ] **Task 9: 前端 — 元素创建与交互**
  - [ ] 实现工具控制器 Hook（hooks/useDrawTool.ts）：
    - 鼠标按下 → 创建元素（临时层）→ 鼠标移动 → 实时更新临时层 → 鼠标释放 → 确认元素（提交到主层）
    - 各工具的拖拽交互逻辑（画笔记录点序列，矩形圆形计算包围盒）
  - [ ] 实现橡皮擦工具：检测橡皮擦轨迹与元素包围盒相交，标记删除（碰撞检测）
  - [ ] 实现元素选择功能（hooks/useElementSelection.ts）：
    - 点击检测（点是否在元素包围盒内，考虑旋转）
    - 多选（Shift+点击添加到选区，或框选矩形覆盖）
    - 选中元素绘制控制手柄（8个缩放手柄 + 顶部旋转手柄）
  - [ ] 实现元素变换功能（hooks/useElementTransform.ts）：
    - 拖拽移动（选中后拖拽到新位置）
    - 缩放（拖拽8个手柄，Shift 锁比例）
    - 旋转（拖拽旋转手柄，以元素中心为轴）
  - [ ] 实现快捷键绑定（hooks/useKeyboardShortcuts.ts）：
    - V/P/L/R/O/T/E 工具切换
    - Delete/Backspace 删除选中元素
    - Ctrl+A 全选，Ctrl+D 复制选中元素
    - Ctrl+Z/Y 撤销重做
    - Ctrl+Shift+E 导出
    - Ctrl+Shift+Delete 清空画布

## Phase 5: 操作控制与状态管理

- [ ] **Task 10: 前端 — 撤销/重做系统**
  - [ ] 实现命令模式基类（utils/Command.ts）：
    - AddElementCommand, DeleteElementCommand, UpdateElementCommand
    - execute() 和 undo() 方法
    - batchId 支持操作合并（连续同类型操作合并为一个 batch）
  - [ ] 实现 undo/redo Manager（utils/UndoManager.ts）：
    - undoStack（最大50步）
    - redoStack
    - execute(command) 执行并压栈，清空 redoStack
    - undo() / redo() 出栈并执行反向操作
    - 支持 batch begin/end 操作合并
  - [ ] 集成到 canvasStore 中，所有元素变更通过 UndoManager 执行

- [ ] **Task 11: 前端 — Canvas 状态管理**
  - [ ] 创建 canvasStore（stores/canvasStore.ts）：
    - elements: CanvasElement[]（所有元素列表）
    - selectedIds: string[]（选中的元素ID）
    - activeTool: ToolType（当前工具：select/pen/line/rect/circle/text/eraser/image）
    - viewport: { x, y, zoom }（视口状态）
    - 所有 action 方法：addElement, updateElement, deleteElement, setSelected, setTool, setViewport
  - [ ] 创建白板编辑页面（features/whiteboard/WhiteboardPage.tsx）：
    - 整合 Canvas 组件 + 工具栏 + 属性面板
    - 加载白板数据（快照 + 增量操作恢复）
    - 连接 Socket.IO 协作

## Phase 6: 实时协作与 OT 算法 🔥🔥🔥

- [ ] **Task 12: 后端 — Socket.IO 事件系统**
  - [ ] 实现 Socket.IO 服务器初始化（sockets/index.ts）：
    - 配置 CORS（origin: 前端地址）
    - JWT 认证（connection 阶段验证 token，无效则拒绝连接）
    - 注册所有事件处理器
  - [ ] 实现白板协作事件（sockets/whiteboardHandler.ts）：
    - `join-whiteboard`：验证权限，用户加入 room，存入 Redis 在线集合，广播在线列表，推送当前白板状态（快照+增量方式：先读取最新快照，再应用后续操作日志，重建最新状态后推送）
    - `leave-whiteboard`：用户离开 room，更新 Redis 在线集合，广播在线列表
    - `element-op`：接收操作 → 调用 OT 服务处理 → 写入操作日志 → 广播给 room 内其他用户
    - `cursor-move`：节流接收（50ms），广播给 room 内其他用户
  - [ ] 实现断线重连逻辑：
    - `rejoin-whiteboard`：客户端发送 lastOperationTimestamp，服务端推送增量操作
    - Socket.IO 指数退避重连（客户端配置：initialDelay=1s, maxDelay=30s, factor=2）

- [ ] **Task 13: 后端 — OT 冲突解决算法 🔥🔥🔥**
  - [ ] 创建 OT 类型定义（ot/types.ts）：Operation, TransformResult, OperationLog, LamportClock
  - [ ] 实现 Lamport 逻辑时钟（ot/LamportClock.ts）：
    - 每个操作携带 lamportClock 序号
    - 服务端和客户端各自维护时钟，收到消息时更新为 max(local, received) + 1
  - [ ] 实现 `transform(op1, op2)` 函数（ot/transform.ts）🔥：
    - 输入：两个基于同一状态的操作 O1（先执行）、O2（后执行）
    - 输出：变换后的 O2'，基于 O1 执行后的状态
    - 变换规则矩阵：
      - add vs add：不变（元素ID不同）
      - add vs update：不变（元素ID不同）
      - update vs update（同元素）：
        - 不同属性 → 合并两个修改
        - 相同属性 → O2 覆盖 O1 的值
        - 位置/尺寸属性 → O2 的坐标需要根据 O1 的变换调整
      - delete vs update（同元素）：update 操作丢弃
      - delete vs delete（同元素）：后一个 delete 变为空操作
    - 函数为纯函数，无副作用
  - [ ] 实现 `compose(opA, opB)` 函数（ot/transform.ts）🔥：
    - 输入：操作 Oa 和基于 Oa 执行后状态的 Ob
    - 输出：合并后的操作 Oab
    - 合并规则：
      - 连续修改同一元素同一属性 → 取最终值
      - 连续修改同一元素不同属性 → 合并为一个多属性修改
      - add + delete 同一元素 → 空操作（抵消）
  - [ ] 实现 OT 冲突解决服务（ot/otService.ts）：
    - 操作队列：按 Lamport 时钟排序
    - 乱序处理：缓冲等待前序操作（超时200ms后请求重传）
    - 冲突检测：比较 baseVersion 与当前版本，不一致时调用 transform()
    - 版本更新：操作成功应用后元素版本号+1
    - 操作日志写入：操作完成时立即写入 MongoDB operations 集合
  - [ ] 创建模块统一导出（ot/index.ts）

- [ ] **Task 14: 前端 — 协作客户端**
  - [ ] 创建 Socket 服务层（services/socket.ts）：
    - Socket.IO 连接管理（connect/disconnect/reconnect）
    - 事件发送/接收封装
    - 指数退避重连配置
    - 连接状态变化通知（connecting/connected/disconnected/reconnecting）
  - [ ] 实现协作 Hook（hooks/useCollaboration.ts）：
    - 加入/离开白板：发送 join-whiteboard/leave-whiteboard
    - 接收远程操作：调用 canvasStore 更新本地元素，触发脏矩形标记
    - 发送本地操作：节流发送（16ms/rAF），携带 baseVersion 和 lamportClock
    - 节流光标位置发送（50ms throttle）
    - 断线重连后自动同步增量操作
  - [ ] 实现远程光标渲染（components/canvas/RemoteCursors.tsx）：
    - 在临时层 Canvas 上绘制其他用户光标
    - 光标样式：彩色箭头（SVG 路径）+ 用户名标签
    - 每个用户分配唯一颜色（从预定义调色板选取）
  - [ ] 实现在线用户列表（components/collaboration/OnlineUsers.tsx）：
    - 显示每个在线用户头像和颜色标识
    - 支持显示在线人数（如 "3人正在协作"）
  - [ ] 实现连接状态指示器（components/collaboration/ConnectionStatus.tsx）：
    - 绿色圆点：已连接
    - 黄色圆点：重连中 + "连接断开，正在重连..." 文字
    - 红色圆点：连接失败

- [ ] **Task 15: 后端 — Redis 适配器与数据持久化**
  - [ ] 安装并配置 @socket.io/redis-adapter
  - [ ] 实现 Redis Pub/Sub 广播（多实例 Socket.IO 通信）
  - [ ] 实现 Redis 在线用户集合管理（key: `whiteboard:{id}:online`，SADD/SREM/SCARD）
  - [ ] 实现 Redis 白板状态缓存（key: `whiteboard:{id}:state`，TTL=5分钟），白板读取优先从 Redis 获取
  - [ ] 实现 Redis Session 存储与验证（key: `session:{userId}`，TTL=7天）
  - [ ] 实现操作日志实时写入 MongoDB（services/operationLogService.ts）：
    - 每个操作写入 operations 集合，含 snapshotBefore/snapshotAfter
    - 写入延迟 P95 < 50ms
    - 使用 bulkWrite 批量写入优化
  - [ ] 实现定时快照服务（services/snapshotService.ts）：
    - 每10分钟自动生成白板完整快照，存入 snapshots 集合
    - 保留最近10个快照，超出数量的旧快照自动删除
    - 同时设置 TTL 索引 30天作为兜底清理策略（防止异常情况下无限增长）
    - 快照生成异步执行（setInterval），不阻塞操作处理
    - 生成快照后更新 whiteboards 集合的 currentSnapshotId 字段
  - [ ] 实现历史版本 API（routes/snapshotRoutes.ts）：
    - GET /api/whiteboards/:id/snapshots — 列出所有快照时间点
    - GET /api/whiteboards/:id/snapshots/:snapshotId — 预览指定快照
    - POST /api/whiteboards/:id/rollback — 回滚到指定快照

## Phase 7: 错误处理与边界情况

- [ ] **Task 16: 前端 — 错误处理体系**
  - [ ] 创建 ErrorBoundary 组件（components/ui/ErrorBoundary.tsx）：
    - 捕获子组件树中的未捕获异常
    - 显示友好错误页面（非白屏），含 "刷新页面" 按钮
    - Canvas 渲染错误不影响 React 组件树
  - [ ] 实现 axios 响应拦截器重试机制（services/api.ts）：
    - 网络错误/超时/5xx 错误自动重试，最多3次
    - 重试间隔递增：1s → 2s → 4s
    - 3次均失败后显示 toast 错误提示
  - [ ] 实现全局错误 Toast 组件（components/ui/Toast.tsx）：
    - 支持 success/error/warning/info 类型
    - 自动消失（3s），支持手动关闭
    - 使用 Zustand store 管理 toast 队列
  - [ ] 实现边界情况处理：
    - 空画布：正常渲染网格背景
    - 超长文本（>500字符）：Canvas 渲染时截断 + 省略号
    - 超大图片（>10MB）：前端 canvas 压缩后上传
    - 浏览器窗口失焦：暂停 rAF 渲染，恢复焦点后恢复
    - 多标签页：每个标签页独立 Socket 连接
    - 页面刷新：快照+增量恢复画布状态

- [ ] **Task 17: 后端 — 错误处理与校验**
  - [ ] 实现统一错误响应中间件（middleware/errorHandler.ts）：
    - 所有错误统一格式 `{ success: false, error: { code, message, details } }`
    - 错误码：VALIDATION_ERROR, AUTH_ERROR, NOT_FOUND, FORBIDDEN, CONFLICT, INTERNAL_ERROR
    - 生产环境不暴露内部错误详情
  - [ ] 实现请求参数校验中间件（middleware/validate.ts）：
    - 必填字段检查
    - 类型校验（string/number/email 格式）
    - 长度/范围限制
    - 校验失败返回 400 + 具体字段和原因
  - [ ] 所有 API 路由集成校验中间件和统一错误处理

## Phase 8: UI 组件与布局

- [ ] **Task 18: 前端 — 布局与导航**
  - [ ] 创建顶部导航栏组件（components/layout/Navbar.tsx），48px，白色背景，固定顶部，flex 布局
  - [ ] 创建左侧工具栏组件（components/layout/Toolbar.tsx），64px，浅灰背景（#F5F5F5），固定左侧，flex-col 布局
  - [ ] 实现工具按钮组件（components/ui/ToolButton.tsx），44x44px，hover/active/selected 状态，SVG 图标
  - [ ] 创建右侧属性面板组件（components/layout/PropertiesPanel.tsx）：
    - 280px，可折叠（toggle 按钮），白色背景，右侧固定
    - 选中元素时显示属性，未选中时显示 "选择元素以编辑属性" 空状态
    - 属性编辑器：X/Y/W/H 数值输入，锁比例按钮，填充色/描边色选择器，透明度滑块，描边宽度
  - [ ] 画布区域占满剩余空间，网格背景

- [ ] **Task 19: 前端 — 导出与图片功能**
  - [ ] 实现导出工具函数（utils/exportCanvas.ts）：
    - 创建离屏Canvas，将当前视口内元素渲染上去
    - 导出为 PNG（canvas.toBlob），触发浏览器下载
  - [ ] 后端图片上传 API（POST /api/upload），multer 中间件，限制10MB
  - [ ] 前端图片导入工具：点击上传 → 创建 Image 类型元素 → 支持拖拽调整尺寸（Shift 锁比例）

## Phase 9: 性能测试与工程化交付

- [ ] **Task 20: 性能测试与验证 🔥**
  - [ ] 前端性能测试：
    - 生成1000+随机元素脚本，测试渲染帧率 ≥ 60fps
    - 模拟50个 WebSocket 客户端同时发送操作，测试帧率 ≥ 45fps
    - Chrome Lighthouse 评分 ≥ 90
    - 页面 FCP < 2s
  - [ ] 后端性能测试：
    - 100 WebSocket 并发连接，测试 CPU < 70%，内存 < 512MB
    - 单操作端到端同步延迟 < 100ms（P95）
    - 操作日志写入延迟 < 50ms（P95）
  - [ ] 协作测试：
    - 3+浏览器窗口同时编辑同一白板，验证无数据不一致
    - 操作乱序模拟（延迟发送），验证 OT 正确处理
    - 断线重连测试，验证增量操作同步完整
  - [ ] 边界情况测试：空画布、超长文本、超大图片、多标签页、页面刷新恢复

- [ ] **Task 21: 工程化文档与脚本**
  - [ ] 创建 `docs/` 目录，编写技术文档：
    - `docs/architecture.md`：系统架构设计文档（前后端交互、数据流、模块划分、三层渲染架构图、OT 流程图）
    - `docs/api.md`：RESTful API 接口文档（所有端点、请求/响应格式、错误码、示例）
    - `docs/websocket.md`：WebSocket 消息协议定义（所有事件类型、payload 格式、时序图）
    - `docs/deployment.md`：部署指南（环境要求、配置步骤、Docker Compose 部署方案）
  - [ ] 创建 `scripts/` 目录，编写脚本：
    - `scripts/dev.sh`：一键启动开发环境（启动 MongoDB + Redis + 后端 + 前端）
    - `scripts/build.sh`：构建前端生产包 + 编译后端 TypeScript
    - `scripts/deploy.sh`：自动化部署脚本（Docker 构建 + 推送 + 部署）
  - [ ] 创建 `tests/` 目录骨架：
    - `tests/client/`：前端测试目录
    - `tests/server/`：后端测试目录（含 OT 算法单元测试）

## Task Dependencies

```
Phase 1: Task 1, Task 2 (并行)
  ↓
Phase 2: Task 3 → Task 4
  ↓
Phase 3: Task 5 → Task 6
  ↓
Phase 4: Task 7 (Canvas 引擎核心) → Task 8 (性能优化) → Task 9 (交互)
  ↓
Phase 5: Task 10, Task 11 (可并行)
  ↓
Phase 6: Task 12, Task 13 (可并行) → Task 14 → Task 15
  ↓
Phase 7: Task 16, Task 17 (可并行)
  ↓
Phase 8: Task 18, Task 19 (可并行)
  ↓
Phase 9: Task 20, Task 21 (Task 21 依赖 Task 20 完成后编写文档)
```

- Task 3 依赖 Task 2
- Task 4 依赖 Task 3
- Task 5 依赖 Task 2
- Task 6 依赖 Task 5
- Task 7 是 Task 8, 9 的前置
- Task 10, 11 依赖 Task 7, 8, 9
- Task 12, 13 依赖 Task 2 和 Task 5
- Task 14 依赖 Task 12, 13 和 Task 11
- Task 15 依赖 Task 12, 13
- Task 16 依赖 Task 11 (需要 canvasStore 和基础 UI 组件)
- Task 17 依赖 Task 2, 5, 12
- Task 18 依赖 Task 11 (需要 canvasStore)
- Task 19 依赖 Task 7, 8
- Task 20 依赖所有前置 Task
- Task 21 依赖 Task 20（系统功能完成后编写文档）

## 面试必问核心技术亮点总览

| 模块 | 文件 | 核心亮点 |
|------|------|----------|
| Canvas 引擎 | `client/src/canvas/` | 三层渲染架构、离屏Canvas预渲染、脏矩形增量渲染、视口裁剪、rAF批处理 |
| OT 算法 | `server/src/ot/` | transform() 操作变换、compose() 操作合并、Lamport 逻辑时钟、操作乱序处理 |
| 数据持久化 | `server/src/services/` | 操作日志实时写入、定时快照、快照+增量恢复、历史版本回滚 |
| 实时协作 | `server/src/sockets/` | Socket.IO room 广播、Redis Pub/Sub 多实例、指数退避重连 |
| 错误处理 | 全项目 | ErrorBoundary、自动重试(3次)、统一错误格式、边界情况全覆盖 |
| 性能指标 | 全项目 | FCP<2s、1000+元素60fps、50人并发45fps+、100用户CPU<70%、Lighthouse>90 |