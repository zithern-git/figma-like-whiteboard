/**
 * Canvas 核心渲染引擎 - 模块统一导出
 *
 * 本模块是白板系统的核心渲染引擎，提供：
 * - CanvasElement.ts: 元素数据结构与类型定义
 * - CanvasRenderer.ts: 渲染引擎核心（三层架构、视口变换、rAF 调度）
 * - ShapeRenderer.ts: 图形渲染器（画笔、直线、矩形、圆形、文本、图片）
 * - DirtyRectManager.ts: 脏矩形管理器（追踪、合并、裁剪）
 * - OffscreenCanvas.ts: 离屏 Canvas 管理器（预渲染缓存、LRU 淘汰）
 */

export { CanvasRenderer } from './CanvasRenderer'
export { ShapeRenderer, catmullRomSmooth } from './ShapeRenderer'
export { DirtyRectManager } from './DirtyRectManager'
export { OffscreenCanvasManager } from './OffscreenCanvas'
export type {
  Point,
  ToolType,
  ElementType,
  CanvasElement,
  Viewport,
  DirtyRect,
  OffscreenCacheEntry,
} from './CanvasElement'