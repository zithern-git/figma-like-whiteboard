# Checklist: 实时协作白板系统

> 标注说明：🔥 = 面试必问核心技术亮点

## 项目基础设施

* [ ] 前端项目使用 Vite 5 + React 18 + TypeScript 构建

* [ ] Tailwind CSS 3 配置正确，样式生效

* [ ] Zustand 4 状态管理正常运作

* [ ] React Router v6 路由配置正确，页面跳转无问题

* [ ] ESLint + Prettier 配置生效，代码风格统一

* [ ] 后端 Express 服务启动正常，无报错

* [ ] MongoDB 连接成功，模型可正常读写

* [ ] Redis 连接成功，Pub/Sub 和缓存功能正常

* [ ] 目录结构与 spec 保持一致

## 工程化目录

* [ ] `docs/` 目录存在并包含以下文件：

  * [ ] `docs/architecture.md`：架构设计文档（含三层渲染架构图、OT 流程图）

  * [ ] `docs/api.md`：RESTful API 接口文档（含请求/响应示例、错误码）

  * [ ] `docs/websocket.md`：WebSocket 消息协议定义（含时序图）

  * [ ] `docs/deployment.md`：部署指南（含 Docker Compose 方案）

* [ ] `scripts/` 目录存在并包含以下文件：

  * [ ] `scripts/dev.sh`：一键启动开发环境脚本

  * [ ] `scripts/build.sh`：构建脚本

  * [ ] `scripts/deploy.sh`：部署脚本

* [ ] `tests/` 目录存在并包含：

  * [ ] `tests/client/`：前端测试目录

  * [ ] `tests/server/`：后端测试目录（含 OT 算法单元测试）

## 用户认证

* [ ] 用户可通过邮箱和密码完成注册

* [ ] 注册后自动登录，token 存入 localStorage

* [ ] 用户可通过邮箱和密码登录

* [ ] JWT token 有效期7天，存储在请求头 Authorization 中

* [ ] 认证中间件正确拦截未认证请求，返回 401

* [ ] 参数校验中间件正确校验 email 格式和密码长度

* [ ] 路由守卫正确重定向未登录用户到登录页

* [ ] 刷新页面后可从 localStorage 恢复登录状态

## 白板管理

* [ ] 可创建白板，生成6位短ID

* [ ] 白板列表页正确显示用户拥有和参与的白板

* [ ] 可通过短ID加入他人白板

* [ ] 仅白板所有者可删除白板，非所有者返回 403

* [ ] 三种角色（owner/editor/viewer）权限控制正确

* [ ] 所有 API 返回统一格式

## 核心绘图引擎 🔥

* [ ] Canvas 引擎代码位于 `client/src/canvas/` 独立目录

* [ ] `client/src/components/canvas/` 仅包含 UI 组件

* [ ] Canvas 正确渲染网格背景（20px 间距，浅灰色）

* [ ] 视口变换（缩放/平移）正确，坐标映射无误

* [ ] 画笔工具可自由绘制路径（Catmull-Rom 平滑）

* [ ] 直线工具可绘制直线（支持箭头端点）

* [ ] 矩形工具可绘制矩形，支持圆角

* [ ] 圆形工具可绘制圆形/椭圆

* [ ] 文本工具可添加和编辑文本（fontSize, fontFamily, color, alignment, bold, italic）

* [ ] 图片工具可上传和放置图片

* [ ] 橡皮擦工具可擦除相交元素

## 三层渲染架构 🔥

* [ ] 背景层 Canvas（z-index 1）正确绘制网格和底色

* [ ] 主层 Canvas（z-index 2）正确绘所有静态元素

* [ ] 临时层 Canvas（z-index 3）正确绘制交互中的临时元素

* [ ] 三层 Canvas 尺寸完全对齐，CSS `position: absolute` 叠加

* [ ] 背景层仅在缩放/平移时重绘

* [ ] 主层使用离屏Canvas预渲染 + 脏矩形增量更新

* [ ] 临时层每帧全量重绘（仅含少量交互元素）

## 离屏Canvas渲染 🔥

* [ ] 复杂元素（画笔路径、文本）在离屏Canvas预渲染为位图缓存

* [ ] 主层渲染时直接 drawImage 绘制缓存，避免重复计算

* [ ] 元素内容变更时缓存失效并重新预渲染

* [ ] LRU 缓存淘汰策略生效（最多缓存50个元素）

## 脏矩形渲染算法 🔥

* [ ] 脏矩形列表正确追踪需要重绘的屏幕区域

* [ ] 多个脏矩形正确合并（union）减少绘制区域

* [ ] 合并后脏矩形 ≤ 4个，超过退化为全画布重绘

* [ ] 重绘时使用 save() + clip() 限定绘制区域

* [ ] 背景层和主层分别维护独立的脏矩形列表

## 性能指标 🔥

* [ ] 1000+静态元素渲染帧率 ≥ 60fps

* [ ] 50人同时绘制帧率 ≥ 45fps

* [ ] 首帧渲染时间 ≤ 16ms

* [ ] 页面首次加载时间（FCP）< 2s

* [ ] Lighthouse Performance 评分 > 90分

* [ ] 100用户同时在线时服务器 CPU < 70%

* [ ] 100用户同时在线时服务器内存 < 512MB

* [ ] 单操作端到端同步延迟 < 100ms（P95）

* [ ] 操作日志写入延迟 < 50ms（P95）

* [ ] WebSocket 消息广播延迟 < 50ms（P95）

* [ ] 断线重连时间 < 5s

* [ ] 视口外元素不参与渲染（视口裁剪生效）

## 操作控制

* [ ] Ctrl+Z 撤销上一步操作

* [ ] Ctrl+Y 重做已撤销操作

* [ ] 撤销栈限制50步，超出后移除最早记录

* [ ] 支持 batch undo（连续同类型操作合并）

* [ ] 滚轮缩放以鼠标位置为中心

* [ ] 空格+拖拽画布平移

* [ ] 缩放范围 0.1x \~ 10x

* [ ] 缩放百分比实时显示

* [ ] V/P/L/R/O/T/E 快捷键切换工具

* [ ] Delete/Backspace 删除选中元素

* [ ] Ctrl+A 全选，Ctrl+D 复制选中元素

* [ ] Shift+拖拽等比例缩放

* [ ] Ctrl+Shift+E 导出为 PNG

* [ ] 导出图片内容完整，分辨率正确

* [ ] 清空画布功能可删除所有元素，生成可撤销的 clear-all 命令

* [ ] 清空后画布仅保留网格背景

## 实时协作

* [ ] Socket.IO 连接建立，JWT 认证通过

* [ ] 用户加入白板后进入对应 room

* [ ] 用户绘图操作实时同步给 room 内其他用户

* [ ] 远程用户光标实时显示（节流50ms）

* [ ] 在线用户列表实时更新

* [ ] 用户断线重连后自动恢复白板状态

* [ ] 增量操作同步（断线期间的操作不丢失）

* [ ] 连接状态指示器正确显示（绿色/黄色/红色）

* [ ] 重连时显示"连接断开，正在重连..."提示

## OT 冲突解决算法 🔥🔥🔥

* [ ] OT 算法代码位于 `server/src/ot/` 独立目录

* [ ] `server/src/ot/types.ts` 类型定义完整（Operation, TransformResult, OperationLog）

* [ ] `transform(op1, op2)` 函数正确实现 🔥：

  * [ ] add vs add/update：不变（元素ID不同）

  * [ ] update vs update（同元素不同属性）：合并两个修改

  * [ ] update vs update（同元素相同属性）：后者覆盖

  * [ ] update vs update（位置/尺寸属性）：O2 坐标根据 O1 变换调整

  * [ ] delete vs update（同元素）：update 操作丢弃

  * [ ] delete vs delete（同元素）：后一个 delete 变为空操作

  * [ ] 函数为纯函数，无副作用

* [ ] `compose(opA, opB)` 函数正确实现 🔥：

  * [ ] 连续修改同一元素同一属性：取最终值

  * [ ] 连续修改同一元素不同属性：合并为一个多属性修改

  * [ ] add + delete 同一元素：空操作（抵消）

* [ ] Lamport 逻辑时钟正确实现

* [ ] 操作乱序处理：缓冲等待前序操作，超时200ms后请求重传

* [ ] 基于版本的乐观锁版本号正确递增

* [ ] 无冲突时操作直接接受并广播

* [ ] 3个以上用户同时编辑无数据不一致

* [ ] 操作历史可追溯（查询任意时间范围内的操作日志）

* [ ] clear-all 操作在 OT 处理中直接清空所有元素，不与其他操作进行变换

* [ ] **禁止使用"最后写入胜出"策略**

## 数据持久化体系 🔥

* [ ] 操作日志实时写入 MongoDB operations 集合

* [ ] 操作日志包含 snapshotBefore 和 snapshotAfter

* [ ] 操作日志写入延迟 P95 < 50ms

* [ ] 使用 bulkWrite 批量写入优化操作日志

* [ ] 每10分钟自动生成白板完整快照

* [ ] 快照保留最近10个，旧快照自动删除，TTL 索引 30天兜底清理

* [ ] 新用户加入时优先加载最新快照，再应用后续操作

* [ ] 快照+增量恢复在 2 秒内完成

* [ ] 支持列出所有快照时间点（GET /api/whiteboards/:id/snapshots）

* [ ] 支持预览指定快照（GET /api/whiteboards/:id/snapshots/:snapshotId）

* [ ] 支持回滚到指定快照（POST /api/whiteboards/:id/rollback）

* [ ] 回滚操作本身也作为一条操作日志记录

## 错误处理与边界情况

* [ ] ErrorBoundary 组件正确捕获未捕获异常，显示友好错误页面

* [ ] Canvas 渲染错误不影响 React 组件树

* [ ] axios 拦截器重试机制：网络错误/超时/5xx 自动重试，最多3次

* [ ] 重试间隔递增：1s → 2s → 4s

* [ ] 3次均失败后显示 toast 错误提示

* [ ] WebSocket 指数退避重连：初始1s，最大30s，因子2x

* [ ] 后端参数校验中间件正确校验必填字段、类型、长度

* [ ] 校验失败返回 400 + 具体字段和原因

* [ ] 统一错误响应格式 `{ success: false, error: { code, message, details } }`

* [ ] 支持错误码：VALIDATION\_ERROR, AUTH\_ERROR, NOT\_FOUND, FORBIDDEN, CONFLICT, INTERNAL\_ERROR

* [ ] 空画布正常渲染网格背景

* [ ] 元素移出画布视口数据保留

* [ ] 超长文本（>500字符）Canvas 渲染时截断 + 省略号

* [ ] 超大图片（>10MB）前端压缩后上传

* [ ] 多标签页独立 Socket 连接

* [ ] 浏览器窗口失焦暂停渲染，恢复焦点后恢复

* [ ] 页面刷新通过快照+增量恢复画布状态

## Redis 集成

* [ ] Redis Pub/Sub 多实例广播正常

* [ ] Socket.IO Redis Adapter 正确转发事件

* [ ] 分布式 Session 存储和验证正常（key: `session:{userId}`，TTL=7天）

* [ ] 在线用户 Redis Set 增删正确（key: `whiteboard:{id}:online`）

* [ ] Redis 白板状态缓存生效（key: `whiteboard:{id}:state`，TTL=5分钟）

* [ ] Redis 缓存白板当前状态，加速读取

## UI 与布局

* [ ] 顶部导航栏 48px，白色背景，固定顶部

* [ ] 左侧工具栏 64px，浅灰背景（#F5F5F5），固定左侧

* [ ] 右侧属性面板 280px，可折叠，白色背景

* [ ] 画布区域占满剩余空间，网格背景

* [ ] 工具按钮 44x44px，hover/active/selected 状态正确

* [ ] 属性面板选中元素时显示属性，未选中时显示空状态

* [ ] 颜色选择器、透明度滑块、数值输入功能正常

* [ ] 锁比例按钮功能正确

## API 文档

* [ ] POST /api/auth/register — 用户注册

* [ ] POST /api/auth/login — 用户登录

* [ ] GET /api/auth/me — 获取当前用户

* [ ] POST /api/whiteboards — 创建白板

* [ ] GET /api/whiteboards — 获取白板列表

* [ ] GET /api/whiteboards/:id — 获取白板详情

* [ ] DELETE /api/whiteboards/:id — 删除白板

* [ ] POST /api/whiteboards/:id/join — 加入白板

* [ ] POST /api/upload — 上传图片

* [ ] GET /api/whiteboards/:id/snapshots — 列出快照

* [ ] GET /api/whiteboards/:id/snapshots/:snapshotId — 预览快照

* [ ] POST /api/whiteboards/:id/rollback — 回滚版本

* [ ] 所有 API 均有正确的错误响应格式

## WebSocket 协议

* [ ] `join-whiteboard` — 加入白板协作（含权限验证和状态推送）

* [ ] `leave-whiteboard` — 离开白板协作

* [ ] `element-op` — 元素操作同步（含 OT 处理）

* [ ] `cursor-move` — 光标位置同步（节流50ms）

* [ ] `rejoin-whiteboard` — 断线重连（含增量操作同步）

* [ ] `online-users` — 在线用户列表更新

* [ ] 所有事件 payload 格式定义清晰

## MongoDB 集合设计

* [ ] `users` 集合：{ email(唯一索引), password(hashed), name, avatar, createdAt, updatedAt }

* [ ] `whiteboards` 集合：{ shortId(唯一索引), name, ownerId, collaborators\[{userId, role}], elements: CanvasElement\[], currentSnapshotId, deleted, createdAt, updatedAt }

* [ ] `operations` 集合：{ whiteboardId, operation(完整Operation对象), snapshotBefore, snapshotAfter, serverTimestamp }，索引：{ whiteboardId: 1, serverTimestamp: 1 }

* [ ] `snapshots` 集合：{ whiteboardId, elements\[], operationSeq, timestamp, size }，索引：{ whiteboardId: 1, timestamp: -1 }，保留最近10个快照，TTL 索引 30天兜底清理

## Vibe Coding 能力验证

* [ ] 基础 CRUD 代码 100% 由 AI 生成

* [ ] UI 组件代码 100% 由 AI 生成

* [ ] OT 核心算法（transform/compose）AI 生成框架 + 人工优化

* [ ] Canvas 渲染引擎（三层架构、脏矩形）AI 生成框架 + 人工优化

* [ ] 开发周期控制在 12-14 小时

## 代码质量

* [ ] 关键算法（OT transform/compose、Canvas 三层渲染、脏矩形、离屏Canvas）有详细中文注释

* [ ] 无 console.log 残留

* [ ] ESLint 0 errors, 0 warnings

* [ ] TypeScript 编译无类型错误

* [ ] 前端无使用第三方 Canvas 库（仅原生 Canvas 2D API）

* [ ] 模块化设计，代码职责清晰

* [ ] Canvas 引擎与 UI 组件分离（`client/src/canvas/` vs `client/src/components/canvas/`）

* [ ] OT 算法独立模块化（`server/src/ot/` 目录）

