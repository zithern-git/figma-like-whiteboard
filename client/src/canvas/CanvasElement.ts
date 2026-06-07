/**
 * Canvas 元素数据结构与类型定义
 *
 * 定义了白板中所有图形元素的统一数据结构，是 Canvas 渲染引擎的核心数据模型。
 * 所有图形类型（画笔、直线、矩形、圆形、文本、图片）都使用统一的接口，
 * 包含包围盒、样式属性、可选的类型特定属性，以及乐观锁版本控制字段。
 */

/** 二维坐标点 */
export interface Point {
  x: number
  y: number
}

/** 绘图工具类型 */
export type ToolType = 'select' | 'pen' | 'line' | 'rect' | 'circle' | 'text' | 'eraser' | 'image'

/** 支持的元素类型 */
export type ElementType = 'pen' | 'line' | 'rect' | 'circle' | 'text' | 'image'

/**
 * Canvas 元素统一数据结构
 *
 * 所有图形元素都使用此接口表示，通过 type 字段区分具体类型。
 * 包围盒（x, y, width, height）用于视口裁剪和碰撞检测，
 * 版本号（version）用于 OT 乐观锁冲突检测。
 */
export interface CanvasElement {
  id: string // 唯一标识（nanoid）
  type: ElementType // 元素类型
  x: number // 包围盒左上角 X 坐标
  y: number // 包围盒左上角 Y 坐标
  width: number // 包围盒宽度
  height: number // 包围盒高度
  rotation: number // 旋转角度（弧度，默认 0）
  opacity: number // 透明度 0-1（默认 1）
  fill: string // 填充色（hex 格式，默认 '#000000'）
  stroke: string // 描边色（hex 格式，默认 '#000000'）
  strokeWidth: number // 描边宽度（默认 2）
  points?: Point[] // 画笔/直线点序列
  text?: string // 文本内容
  fontSize?: number // 字号（默认 16）
  fontFamily?: string // 字体（默认 'Arial'）
  imageUrl?: string // 图片 URL
  version: number // 乐观锁版本号（从 1 开始自增）
  lockUserId?: string // 当前编辑者（乐观锁用）
  createdAt: number // 创建时间戳
  updatedAt: number // 最后更新时间戳
  createdBy: string // 创建者用户 ID
}

/** 视口状态：描述当前画布的平移和缩放状态 */
export interface Viewport {
  x: number // 视口 X 偏移（平移量）
  y: number // 视口 Y 偏移（平移量）
  zoom: number // 视口缩放比例
}

/** 脏矩形：用于增量渲染的矩形区域描述 */
export interface DirtyRect {
  x: number // 矩形左上角 X（屏幕坐标）
  y: number // 矩形左上角 Y（屏幕坐标）
  width: number // 矩形宽度
  height: number // 矩形高度
}

/** 离屏缓存条目：缓存复杂元素预渲染的位图 */
export interface OffscreenCacheEntry {
  canvas: OffscreenCanvas // 离屏 Canvas 实例
  elementId: string // 对应的元素 ID
  lastUsed: number // 最后使用时间戳（用于 LRU 淘汰）
  version: number // 缓存对应的元素版本号
}