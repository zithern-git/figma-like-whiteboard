/**
 * 脏矩形管理器 (DirtyRectManager) 🔥
 *
 * 实现脏矩形增量渲染算法，是 Canvas 性能优化的核心技术之一。
 *
 * 原理说明：
 * 当画布上有大量元素时，全量重绘会非常耗性能。
 * 脏矩形算法只重绘发生变化的区域（脏矩形），而非整个画布。
 *
 * 工作流程：
 * 1. 标记脏矩形：当元素发生变化时，将元素的包围盒记录为脏矩形
 * 2. 合并脏矩形：多个重叠的脏矩形合并为一个，减少绘制区域
 * 3. 裁剪渲染：使用 ctx.save() + ctx.clip() 限定绘制区域，仅重绘脏矩形内的内容
 * 4. 退化策略：当脏矩形数量超过 4 个时，退化为全画布重绘（避免 clip 开销过大）
 *
 * 设计要点：
 * - 背景层和主层分别维护独立的脏矩形管理器
 * - 背景层仅在缩放/平移时标记脏矩形
 * - 主层在元素增删改时标记脏矩形
 */

import { DirtyRect } from './CanvasElement'

/** 最大合并后脏矩形数量，超过则退化为全画布重绘 */
const MAX_DIRTY_RECTS = 4

export class DirtyRectManager {
  /** 脏矩形列表 */
  private rects: DirtyRect[] = []

  /** 是否已标记为全画布重绘（脏矩形过多时的退化策略） */
  private isFullRedraw = false

  /**
   * 标记一个脏矩形区域
   *
   * 当元素发生变化时调用，将元素包围盒或指定区域记录为脏矩形。
   * 如果已标记为全画布重绘，则跳过此操作。
   *
   * @param rect - 需要重绘的矩形区域
   */
  markDirty(rect: DirtyRect): void {
    if (this.isFullRedraw) return
    this.rects.push({ ...rect })
  }

  /**
   * 标记全画布需要重绘
   *
   * 用于缩放、平移等需要全画布更新的场景。
   */
  markFullRedraw(): void {
    this.isFullRedraw = true
    this.rects = []
  }

  /**
   * 合并脏矩形并获取最终需要重绘的区域列表 🔥
   *
   * 合并策略：
   * 1. 对脏矩形进行两两合并，重叠的矩形合并为一个（union）
   * 2. 合并后若矩形数量仍超过 MAX_DIRTY_RECTS（4个），退化为全画布重绘
   * 3. 返回合并后的矩形列表
   *
   * 合并算法：贪心合并，每次合并两个重叠面积最大的矩形，直到无法继续合并
   * 或矩形数量达到阈值。
   *
   * @returns 合并后需要重绘的矩形列表，或空数组（表示全画布重绘）
   */
  getMergedRects(): DirtyRect[] {
    if (this.isFullRedraw) return []

    if (this.rects.length === 0) return []

    const merged = this.mergeOverlappingRects([...this.rects])

    // 超过阈值则退化，返回空数组表示全画布重绘
    if (merged.length > MAX_DIRTY_RECTS) {
      return []
    }

    return merged
  }

  /**
   * 重置脏矩形状态
   *
   * 每次渲染完成后调用，清空脏矩形列表。
   */
  reset(): void {
    this.rects = []
    this.isFullRedraw = false
  }

  /**
   * 检查是否有脏矩形需要处理
   */
  get hasDirtyRects(): boolean {
    return this.isFullRedraw || this.rects.length > 0
  }

  /**
   * 合并重叠的矩形
   *
   * 使用贪心算法：每次找出重叠面积最大的两个矩形合并，
   * 重复直到没有重叠的矩形对或矩形数量达到阈值。
   *
   * @param rects - 待合并的矩形列表
   * @returns 合并后的矩形列表
   */
  private mergeOverlappingRects(rects: DirtyRect[]): DirtyRect[] {
    if (rects.length <= MAX_DIRTY_RECTS) return rects

    while (rects.length > MAX_DIRTY_RECTS) {
      let bestOverlap = 0
      let bestI = -1
      let bestJ = -1

      // 找出重叠面积最大的两个矩形
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const overlap = this.calculateOverlapArea(rects[i], rects[j])
          if (overlap > bestOverlap) {
            bestOverlap = overlap
            bestI = i
            bestJ = j
          }
        }
      }

      // 如果没有重叠的矩形对，无法继续合并
      if (bestOverlap === 0) break

      // 合并两个矩形
      const merged = this.unionRects(rects[bestI], rects[bestJ])
      rects.splice(Math.max(bestI, bestJ), 1)
      rects.splice(Math.min(bestI, bestJ), 1)
      rects.push(merged)
    }

    return rects
  }

  /**
   * 计算两个矩形的重叠面积
   *
   * 通过比较两个矩形在 X 和 Y 轴上的投影来计算重叠区域。
   *
   * @param a - 矩形 A
   * @param b - 矩形 B
   * @returns 重叠面积（像素）
   */
  private calculateOverlapArea(a: DirtyRect, b: DirtyRect): number {
    const overlapX = Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    )
    const overlapY = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    )
    return overlapX * overlapY
  }

  /**
   * 合并两个矩形（union）
   *
   * 结果矩形是刚好包含两个矩形的最小包围矩形。
   *
   * @param a - 矩形 A
   * @param b - 矩形 B
   * @returns 合并后的矩形
   */
  private unionRects(a: DirtyRect, b: DirtyRect): DirtyRect {
    const newX = Math.min(a.x, b.x)
    const newY = Math.min(a.y, b.y)
    const newWidth = Math.max(a.x + a.width, b.x + b.width) - newX
    const newHeight = Math.max(a.y + a.height, b.y + b.height) - newY
    return { x: newX, y: newY, width: newWidth, height: newHeight }
  }
}