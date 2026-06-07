/**
 * 离屏 Canvas 管理器 (OffscreenCanvas) 🔥
 *
 * 实现离屏 Canvas 预渲染缓存机制，是 Canvas 性能优化的核心技术之一。
 *
 * 原理说明：
 * 对于复杂元素（如画笔路径、文本），渲染过程涉及大量计算
 * （路径生成、字形渲染等）。如果每次重绘都重新计算，会严重拖慢帧率。
 *
 * 解决方案：
 * 1. 将复杂元素渲染到离屏 Canvas 上，生成位图缓存
 * 2. 主层渲染时直接使用 drawImage(offscreenCanvas, ...) 绘制位图
 * 3. 避免每帧重复执行昂贵的渲染计算
 *
 * 缓存管理：
 * - 使用 LRU（Least Recently Used）淘汰策略，最多缓存 50 个元素
 * - 当缓存满时，淘汰最久未使用的缓存条目
 * - 元素内容变更时使缓存失效（版本号不匹配）
 *
 * LRU 实现原理：
 * 维护每个缓存条目的最后使用时间戳，淘汰时选择时间戳最小的条目。
 * 每次命中缓存时更新该条目的最后使用时间戳。
 */

import { CanvasElement, OffscreenCacheEntry } from './CanvasElement'
import { ShapeRenderer } from './ShapeRenderer'

/** 最大缓存元素数量 */
const MAX_CACHE_SIZE = 50

export class OffscreenCanvasManager {
  /** 缓存条目列表（按最后使用时间排序） */
  private cache: OffscreenCacheEntry[] = []

  /** 图片缓存：URL -> HTMLImageElement */
  private imageCache: Map<string, HTMLImageElement> = new Map()

  /**
   * 获取元素的离屏渲染缓存
   *
   * 命中缓存的条件：
   * 1. 缓存中存在该元素
   * 2. 缓存的版本号与元素当前版本号一致
   *
   * 命中缓存时更新 lastUsed 时间戳（LRU 刷新）。
   * 未命中时创建新的离屏缓存并渲染。
   *
   * @param element - 需要渲染的元素
   * @returns 离屏 Canvas 实例
   */
  getCache(element: CanvasElement): OffscreenCanvas {
    const existing = this.cache.find((c) => c.elementId === element.id)

    if (existing && existing.version === element.version) {
      // 缓存命中：更新 LRU 时间戳
      existing.lastUsed = Date.now()
      return existing.canvas
    }

    // 缓存未命中或版本过期：创建新的离屏缓存
    return this.createCache(element)
  }

  /**
   * 创建离屏渲染缓存
   *
   * 在离屏 Canvas 上渲染单个元素，生成位图缓存。
   * 创建前检查 LRU 是否需要淘汰旧条目。
   *
   * @param element - 需要渲染的元素
   * @returns 离屏 Canvas 实例
   */
  private createCache(element: CanvasElement): OffscreenCanvas {
    // LRU 淘汰：超过最大缓存数时移除最旧条目
    this.evictIfNeeded()

    // 创建离屏 Canvas，尺寸与元素包围盒一致
    const canvas = new OffscreenCanvas(
      Math.max(element.width, 1),
      Math.max(element.height, 1)
    )
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    // 在离屏 Canvas 上渲染元素（坐标相对于元素包围盒左上角）
    const offsetElement = {
      ...element,
      x: 0,
      y: 0,
    }

    this.renderElementToOffscreen(ctx, offsetElement)

    // 缓存条目
    const entry: OffscreenCacheEntry = {
      canvas,
      elementId: element.id,
      lastUsed: Date.now(),
      version: element.version,
    }

    this.cache.push(entry)
    return canvas
  }

  /**
   * 将元素渲染到离屏 Canvas 上
   *
   * 根据元素类型调用对应的 ShapeRenderer 方法。
   *
   * @param ctx - 离屏 Canvas 2D 上下文
   * @param element - 待渲染的元素（坐标已偏移到原点）
   */
  private renderElementToOffscreen(
    ctx: OffscreenCanvasRenderingContext2D,
    element: CanvasElement
  ): void {
    // 转换为 CanvasRenderingContext2D 兼容接口
    const ctx2d = ctx as unknown as CanvasRenderingContext2D

    switch (element.type) {
      case 'pen':
        ShapeRenderer.renderPen(ctx2d, element)
        break
      case 'line':
        ShapeRenderer.renderLine(ctx2d, element)
        break
      case 'rect':
        ShapeRenderer.renderRect(ctx2d, element)
        break
      case 'circle':
        ShapeRenderer.renderCircle(ctx2d, element)
        break
      case 'text':
        ShapeRenderer.renderText(ctx2d, element)
        break
      case 'image':
        ShapeRenderer.renderImage(ctx2d, element, this.imageCache)
        break
    }
  }

  /**
   * LRU 淘汰策略 🔥
   *
   * 当缓存数量超过 MAX_CACHE_SIZE 时，淘汰最久未使用的条目。
   * 按 lastUsed 升序排序，移除第一个（最旧的）。
   */
  private evictIfNeeded(): void {
    if (this.cache.length >= MAX_CACHE_SIZE) {
      // 按最后使用时间升序排序，移除最旧的
      this.cache.sort((a, b) => a.lastUsed - b.lastUsed)
      this.cache.shift()
    }
  }

  /**
   * 使指定元素的缓存失效
   *
   * 当元素内容变更时调用，移除对应缓存条目。
   *
   * @param elementId - 元素 ID
   */
  invalidateCache(elementId: string): void {
    this.cache = this.cache.filter((c) => c.elementId !== elementId)
  }

  /**
   * 使所有缓存失效
   *
   * 用于全量重置场景（如清空画布）。
   */
  invalidateAll(): void {
    this.cache = []
  }

  /**
   * 预加载图片并缓存
   *
   * 异步加载图片到内存缓存中，供 renderImage 使用。
   *
   * @param url - 图片 URL
   * @returns Promise<HTMLImageElement>
   */
  async loadImage(url: string): Promise<HTMLImageElement> {
    const existing = this.imageCache.get(url)
    if (existing) return existing

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.imageCache.set(url, img)
        resolve(img)
      }
      img.onerror = reject
      img.src = url
    })
  }

  /**
   * 获取当前缓存数量
   */
  get cacheSize(): number {
    return this.cache.length
  }
}