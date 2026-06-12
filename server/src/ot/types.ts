/**
 * OT (Operational Transformation) 类型定义
 *
 * Phase 6.3 — 实时协作冲突解决
 *
 * 设计原则：
 * - 所有类型基于 Phase 6.1 的 ElementOpPayload 扩展
 * - 每个 op 携带 Lamport 时钟序号（用于全序排序与因果关系追踪）
 * - 基础版本号 baseVersion 表示 op 期望作用的状态版本
 * - 冲突解决时使用 transform() 重写 op
 * - 连续 op 合并时使用 compose() 压缩
 */

/** op 类型枚举（与 Phase 6.1 一致） */
export type OpType = 'add' | 'update' | 'delete' | 'clear-all'

/**
 * 位置/尺寸相关属性
 *
 * 当对同一元素做 update 时，update vs update 场景下需要根据
 * "先执行的 update" 是否改变了位置/尺寸来调整 "后执行的 update" 的坐标。
 */
export const POSITION_FIELDS = ['x', 'y', 'width', 'height'] as const
export type PositionField = (typeof POSITION_FIELDS)[number]

/**
 * add op 的 payload
 * - element.id: 元素唯一 ID（必填，OT 用它判定 op 作用对象）
 * - element 其余字段：类型 / 位置 / 尺寸 / 样式等
 */
export interface AddOpPayload {
  element: {
    id: string
    [key: string]: unknown
  }
}

/**
 * update op 的 payload
 * - id: 目标元素 ID
 * - updates: 部分字段更新
 */
export interface UpdateOpPayload {
  id: string
  updates: Record<string, unknown>
}

/**
 * delete op 的 payload
 * - id: 待删除元素 ID
 */
export interface DeleteOpPayload {
  id: string
}

/**
 * clear-all op 的 payload（清空白板）
 */
export interface ClearAllOpPayload {
  // 留空。clear-all 不带具体 ID。
  [key: string]: never
}

/** 区分 op payload 的联合类型 */
export type OpPayload = AddOpPayload | UpdateOpPayload | DeleteOpPayload | ClearAllOpPayload

/**
 * 核心 Operation 结构
 *
 * - id: 服务端分配的全局唯一 ID（持久化到 operations 集合时生成）
 * - clientOpId: 客户端 UUID（用于去重自己的回传）
 * - whiteboardId: 所属白板 shortId
 * - userId: 提交者
 * - opType: 操作类型
 * - payload: 操作负载
 * - baseVersion: 该 op 期望作用的白板状态版本号
 * - lamportClock: Lamport 逻辑时钟序号
 * - timestamp: 客户端生成时间（用于 UI 排序的兜底，不用于因果判定）
 * - prevOpId?: 上一个 op 的 id（可选，用于构建 op 链）
 */
export interface Operation {
  id?: string
  clientOpId: string
  whiteboardId: string
  userId: string
  opType: OpType
  payload: OpPayload
  /** 该 op 期望作用的白板状态版本号；服务端据此判定是否需要 transform */
  baseVersion: number
  /** Lamport 逻辑时钟序号 */
  lamportClock: number
  /** 客户端生成时间（毫秒） */
  timestamp: number
  /** 链式前驱 op（可选） */
  prevOpId?: string
}

/**
 * transform() 的返回结果
 *
 * - operation: 变换后的 op（基于 O1 执行后的状态仍然能正确生效）
 * - dropped: 是否被丢弃（如 update 目标元素已被 delete 抹掉）
 * - becameNoop: 是否退化为空操作（如 add + delete 同一元素相互抵消）
 */
export interface TransformResult {
  operation: Operation
  dropped: boolean
  becameNoop: boolean
}

/**
 * compose() 的返回结果
 *
 * - operation: 合并后的 op
 * - becameNoop: 是否退化为空操作
 */
export interface ComposeResult {
  operation: Operation
  becameNoop: boolean
}

/**
 * Lamport 逻辑时钟
 *
 * 维护一个单调递增的计数器。
 * - 本地事件（创建 op）→ tick = counter + 1；counter = tick
 * - 收到远端消息带 clock → counter = max(counter, received) + 1；返回新 counter 作为该 op 的生效 clock
 *
 * 这种"看一次 + 自增一次"的语义保证因果关系：若 A → B（事件 A 严格早于事件 B），
 * 则 lamport(B) > lamport(A)。平局时用 (clock, userId) 字典序打破。
 */
export interface LamportClock {
  /** 当前时钟值 */
  counter: number
  /** 自增并返回新值（用于本地新事件） */
  tick(): number
  /** 收到远端 clock，更新本地时钟并返回更新后的值（用于处理远端事件） */
  observe(remote: number): number
  /** 获取当前值（不修改） */
  peek(): number
}

/**
 * 操作日志条目（持久化到 MongoDB operations 集合）
 *
 * 与 Operation 的区别：
 * - 多了 _id（mongo 文档主键）
 * - 多了 createdAt（服务端落地时间，用于增量恢复）
 * - 多了 serverVersion（操作成功应用后白板的版本号）
 */
export interface OperationLog {
  _id?: string
  opId: string
  clientOpId: string
  whiteboardId: string
  userId: string
  opType: OpType
  payload: OpPayload
  baseVersion: number
  lamportClock: number
  timestamp: number
  prevOpId?: string
  /** 操作成功应用后白板达到的版本号（用于增量恢复） */
  serverVersion: number
  createdAt: Date
}
