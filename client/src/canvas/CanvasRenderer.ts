/**
 * Canvas 渲染引擎核心 (CanvasRenderer) 🔥
 *
 * 白板系统的核心渲染引擎，负责管理三层 Canvas 架构、视口变换、渲染调度和性能优化。
 *
 * 三层渲染架构 🔥：
 * ┌─────────────────────────────────────┐
 * │  临时层 (Temp Layer) - z-index: 3   │  每帧全量重绘，绘制交互中的临时元素
 * │  主层   (Main Layer) - z-index: 2   │  离屏Canvas预渲染 + 脏矩形增量更新
 * │  背景层 (Bg Layer)   - z-index: 1   │  仅在缩放/平移时重绘，绘制网格和底色
 * └─────────────────────────────────────┘
 *
 * 核心技术点：
 * - 视口裁剪：仅渲染当前视口内的元素，包围盒与视口矩形相交检测
 * - requestAnimationFrame 调度：合并同一帧内的多次重绘请求
 * - 坐标转换：屏幕坐标 ↔ 世界坐标（考虑视口平移和缩放）
 *
 * 设计原则：
 * - 背景层 = 低频重绘（缩放/平移），高频重绘代价大
 * - 主层 = 增量重绘（脏矩形），避免全量重绘
 * - 临时层 = 高频重绘（每帧），但仅含少量交互元素
 */

import { CanvasElement, Viewport, DirtyRect } from './CanvasElement'
import { ShapeRenderer } from './ShapeRenderer'
import { DirtyRectManager } from './DirtyRectManager'
import { OffscreenCanvasManager } from './OffscreenCanvas'

/** 网格间距（像素） */
const GRID_SPACING = 20

/** 网格线颜色 */
const GRID_COLOR = '#E5E5E5'

/** 画布背景色 */
const BACKGROUND_COLOR = '#FFFFFF'

export class CanvasRenderer {
  // ========== Canvas 元素引用 ==========
  private bgCanvas: HTMLCanvasElement
  private mainCanvas: HTMLCanvasElement
  private tempCanvas: HTMLCanvasElement

  private bgCtx: CanvasRenderingContext2D
  private mainCtx: CanvasRenderingContext2D
  private tempCtx: CanvasRenderingContext2D

  // ========== 渲染状态 ==========
  /** 视口状态（平移 + 缩放） */
  private viewport: Viewport = { x: 0, y: 0, zoom: 1 }

  /** 所有元素列表 */
  private elements: CanvasElement[] = []

  /** 选中的元素 ID 集合 */
  private selectedIds: Set<string> = new Set()

  // ========== 性能优化组件 ==========
  /** 背景层脏矩形管理器 */
  private bgDirtyManager = new DirtyRectManager()

  /** 主层脏矩形管理器 */
  private mainDirtyManager = new DirtyRectManager()

  /** 离屏 Canvas 缓存管理器 */
  private offscreenManager = new OffscreenCanvasManager()

  // ========== 渲染调度 ==========
  /** 当前是否已调度了 rAF 回调 */
  private rafScheduled = false

  /** rAF 回调 ID */
  private rafId: number | null = null

  /** 需要重绘的层标志 */
  private needsRedraw = {
    bg: false,
    main: false,
    temp: false,
  }

  /** ResizeObserver 实例 */
  private resizeObserver: ResizeObserver | null = null

  /**
   * 构造函数
   *
   * 初始化三个 Canvas 元素的 2D 上下文，并设置 ResizeObserver 响应式尺寸管理。
   *
   * @param bgCanvas - 背景层 Canvas 元素
   * @param mainCanvas - 主层 Canvas 元素
   * @param tempCanvas - 临时层 Canvas 元素
   */
  constructor(
    bgCanvas: HTMLCanvasElement,
    mainCanvas: HTMLCanvasElement,
    tempCanvas: HTMLCanvasElement
  ) {
    this.bgCanvas = bgCanvas
    this.mainCanvas = mainCanvas
    this.tempCanvas = tempCanvas

    this.bgCtx = bgCanvas.getContext('2d')!
    this.mainCtx = mainCanvas.getContext('2d')!
    this.tempCtx = tempCanvas.getContext('2d')!

    this.setupResizeObserver()
    this.scheduleRender('bg')
  }

  // ======================================================================
  // 响应式尺寸管理
  // ======================================================================

  /**
   * 设置 ResizeObserver 响应式尺寸管理
   *
   * 监听容器尺寸变化，自动调整 Canvas 的 width/height 属性以匹配 CSS 尺寸。
   * Canvas 的渲染尺寸（width/height 属性）必须与 CSS 显示尺寸一致，
   * 否则会出现模糊或像素错位。
   */
  private setupResizeObserver(): void {
    const container = this.bgCanvas.parentElement
    if (!container) return

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        this.resizeCanvas(width, height)
      }
    })

    this.resizeObserver.observe(container)
  }

  /**
   * 调整 Canvas 尺寸
   *
   * 同步调整三层 Canvas 的渲染尺寸。Canvas 属性重置会清空画布内容，
   * 因此调整后需要重新渲染所有层。
   *
   * @param width - 新宽度
   * @param height - 新高度
   */
  private resizeCanvas(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.floor(width * dpr)
    const h = Math.floor(height * dpr)

    // 避免不必要的重置
    if (this.bgCanvas.width === w && this.bgCanvas.height === h) return

    this.bgCanvas.width = w
    this.bgCanvas.height = h
    this.mainCanvas.width = w
    this.mainCanvas.height = h
    this.tempCanvas.width = w
    this.tempCanvas.height = h

    // 重置所有上下文的变换矩阵以适配 DPR
    this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.tempCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 尺寸变化后需要全量重绘
    this.bgDirtyManager.markFullRedraw()
    this.mainDirtyManager.markFullRedraw()
    this.scheduleRender('bg')
    this.scheduleRender('main')
  }

  // ======================================================================
  // 视口管理与坐标转换
  // ======================================================================

  /**
   * 设置视口状态
   *
   * 视口变化时背景层需要全量重绘（网格位置变化），
   * 主层需要全量重绘（元素世界坐标映射变化）。
   *
   * @param viewport - 新的视口状态
   */
  setViewport(viewport: Partial<Viewport>): void {
    Object.assign(this.viewport, viewport)
    this.bgDirtyManager.markFullRedraw()
    this.mainDirtyManager.markFullRedraw()
    this.scheduleRender('bg')
    this.scheduleRender('main')
  }

  /**
   * 获取当前视口状态
   */
  getViewport(): Viewport {
    return { ...this.viewport }
  }

  /**
   * 屏幕坐标 → 世界坐标 🔥
   *
   * 将鼠标事件的屏幕坐标转换为画布世界坐标。
   * 公式：worldX = (screenX - viewport.x) / zoom
   *       worldY = (screenY - viewport.y) / zoom
   *
   * 原理：Canvas 使用仿射变换矩阵实现视口变换，
   * 屏幕坐标需要逆变换回世界坐标以匹配元素位置。
   *
   * @param screenX - 屏幕 X 坐标
   * @param screenY - 屏幕 Y 坐标
   * @returns 世界坐标
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewport.x) / this.viewport.zoom,
      y: (screenY - this.viewport.y) / this.viewport.zoom,
    }
  }

  /**
   * 世界坐标 → 屏幕坐标
   *
   * 公式：screenX = worldX * zoom + viewport.x
   *       screenY = worldY * zoom + viewport.y
   *
   * @param worldX - 世界 X 坐标
   * @param worldY - 世界 Y 坐标
   * @returns 屏幕坐标
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX * this.viewport.zoom + this.viewport.x,
      y: worldY * this.viewport.zoom + this.viewport.y,
    }
  }

  // ======================================================================
  // 渲染调度 (requestAnimationFrame)
  // ======================================================================

  /**
   * 调度渲染 🔥
   *
   * 使用 requestAnimationFrame 进行渲染调度。
   * 同一帧内的多次重绘请求合并为一次执行，在 rAF 回调中统一处理。
   * 这样可以避免短时间内的多次重绘，减少不必要的渲染开销。
   *
   * @param layer - 需要重绘的层（'bg' | 'main' | 'temp'）
   */
  scheduleRender(layer: 'bg' | 'main' | 'temp'): void {
    this.needsRedraw[layer] = true

    if (!this.rafScheduled) {
      this.rafScheduled = true
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null
        this.rafScheduled = false
        this.performRender()
      })
    }
  }

  /**
   * 执行渲染
   *
   * 按顺序渲染背景层 → 主层 → 临时层。
   * 每层独立判断是否需要重绘，避免不必要的渲染。
   */
  private performRender(): void {
    if (this.needsRedraw.bg) {
      this.renderBackgroundLayer()
      this.needsRedraw.bg = false
    }
    if (this.needsRedraw.main) {
      this.renderMainLayer()
      this.needsRedraw.main = false
    }
    if (this.needsRedraw.temp) {
      this.renderTempLayer()
      this.needsRedraw.temp = false
    }
  }

  // ======================================================================
  // 背景层渲染
  // ======================================================================

  /**
   * 渲染背景层 🔥
   *
   * 背景层绘制网格背景和画布底色。
   * 仅在缩放/平移时重绘（bgDirtyManager 标记全量重绘），
   * 静态时不需要任何重绘，开销极小。
   */
  private renderBackgroundLayer(): void {
    const ctx = this.bgCtx
    const { width, height } = this.bgCanvas

    ctx.clearRect(0, 0, width, height)

    // 绘制画布底色
    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, width, height)

    // 绘制网格背景
    this.drawGrid(ctx, width, height)
  }

  /**
   * 绘制网格背景
   *
   * 网格随视口缩放和平移而变化，通过视口变换计算网格线位置。
   * 网格间距 = GRID_SPACING * zoom，仅在网格间距 >= 4px 时绘制（避免过密）。
   *
   * @param ctx - Canvas 2D 上下文
   * @param width - Canvas 宽度
   * @param height - Canvas 高度
   */
  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gridSize = GRID_SPACING * this.viewport.zoom
    if (gridSize < 4) return // 网格太密，跳过绘制

    const offsetX = this.viewport.x % gridSize
    const offsetY = this.viewport.y % gridSize

    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 0.5

    ctx.beginPath()

    // 垂直线
    for (let x = offsetX; x < width; x += gridSize) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }

    // 水平线
    for (let y = offsetY; y < height; y += gridSize) {
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
    }

    ctx.stroke()
  }

  // ======================================================================
  // 主层渲染（核心）
  // ======================================================================

  /**
   * 渲染主层 🔥
   *
   * 主层使用离屏 Canvas 预渲染 + 脏矩形增量更新策略：
   * 1. 获取合并后的脏矩形列表
   * 2. 对每个脏矩形使用 clip 限定绘制区域
   * 3. 仅渲染脏矩形内的元素（视口裁剪 + 脏矩形裁剪双重过滤）
   * 4. 复杂元素优先使用离屏缓存位图
   */
  private renderMainLayer(): void {
    const ctx = this.mainCtx
    const { width, height } = this.mainCanvas
    const dirtyRects = this.mainDirtyManager.getMergedRects()

    if (dirtyRects.length === 0) {
      // 脏矩形过多或全量重绘，清空整个主层
      ctx.clearRect(0, 0, width, height)
      this.renderAllElements(ctx, { x: 0, y: 0, width, height })
    } else {
      // 增量渲染：仅重绘脏矩形区域
      for (const rect of dirtyRects) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(rect.x, rect.y, rect.width, rect.height)
        ctx.clip() // 🔥 使用 clip 限定绘制区域，仅渲染脏矩形内内容
        ctx.clearRect(rect.x, rect.y, rect.width, rect.height)
        this.renderAllElements(ctx, rect)
        ctx.restore()
      }
    }

    this.mainDirtyManager.reset()
  }

  /**
   * 渲染所有可见元素
   *
   * 遍历元素列表，对每个元素执行：
   * 1. 视口裁剪：仅渲染当前视口内的元素（包围盒与视口矩形相交检测）
   * 2. 离屏缓存：复杂元素优先使用离屏 Canvas 缓存位图
   * 3. 直接渲染：简单元素直接调用 ShapeRenderer
   *
   * @param ctx - Canvas 2D 上下文
   * @param clipRect - 裁剪区域（用于脏矩形增量渲染）
   */
  private renderAllElements(
    ctx: CanvasRenderingContext2D,
    clipRect: DirtyRect
  ): void {
    const dpr = window.devicePixelRatio || 1

    // 将裁剪区域转换为世界坐标（用于视口裁剪）
    const worldClipTL = this.screenToWorld(clipRect.x / dpr, clipRect.y / dpr)
    const worldClipBR = this.screenToWorld(
      (clipRect.x + clipRect.width) / dpr,
      (clipRect.y + clipRect.height) / dpr
    )
    const worldClip = {
      x: worldClipTL.x,
      y: worldClipTL.y,
      width: worldClipBR.x - worldClipTL.x,
      height: worldClipBR.y - worldClipTL.y,
    }

    ctx.save()

    // 应用视口变换：平移 + 缩放
    ctx.translate(this.viewport.x, this.viewport.y)
    ctx.scale(this.viewport.zoom, this.viewport.zoom)

    for (const element of this.elements) {
      // 🔥 视口裁剪：跳过不在视口内的元素
      if (!this.isElementInViewport(element, worldClip)) continue

      // 🔥 离屏缓存：复杂元素优先使用缓存渲染
      if (this.shouldUseOffscreenCache(element)) {
        this.renderElementFromCache(ctx, element)
      } else {
        this.renderElementDirect(ctx, element)
      }
    }

    ctx.restore()
  }

  /**
   * 判断元素是否在视口内 🔥
   *
   * 使用包围盒与视口矩形相交检测（AABB 碰撞检测）：
   * 两个矩形相交当且仅当它们在所有轴上的投影都有重叠。
   *
   * @param element - 待判断的元素
   * @param viewport - 视口矩形（世界坐标）
   * @returns 是否在视口内
   */
  private isElementInViewport(
    element: CanvasElement,
    viewport: { x: number; y: number; width: number; height: number }
  ): boolean {
    return !(
      element.x + element.width < viewport.x ||
      element.x > viewport.x + viewport.width ||
      element.y + element.height < viewport.y ||
      element.y > viewport.y + viewport.height
    )
  }

  /**
   * 判断是否应该使用离屏缓存
   *
   * 复杂元素类型（画笔路径、文本、图片）使用离屏缓存，
   * 简单元素（矩形、圆形、直线）直接渲染。
   *
   * @param element - 元素
   */
  private shouldUseOffscreenCache(element: CanvasElement): boolean {
    return element.type === 'pen' || element.type === 'text' || element.type === 'image'
  }

  /**
   * 从离屏缓存渲染元素
   *
   * 从 OffscreenCanvasManager 获取缓存位图，使用 drawImage 绘制到主层。
   * 这种方式避免了每帧重新计算画笔路径、渲染字形等昂贵操作。
   *
   * @param ctx - Canvas 2D 上下文
   * @param element - 元素
   */
  private renderElementFromCache(
    ctx: CanvasRenderingContext2D,
    element: CanvasElement
  ): void {
    const cache = this.offscreenManager.getCache(element)
    if (cache.width > 0 && cache.height > 0) {
      ctx.save()
      ctx.globalAlpha = element.opacity
      ctx.drawImage(cache, element.x, element.y, element.width, element.height)
      ctx.restore()
    }
  }

  /**
   * 直接渲染元素
   *
   * 对于简单元素，直接调用 ShapeRenderer 渲染，无需离屏缓存。
   *
   * @param ctx - Canvas 2D 上下文
   * @param element - 元素
   */
  private renderElementDirect(
    ctx: CanvasRenderingContext2D,
    element: CanvasElement
  ): void {
    switch (element.type) {
      case 'rect':
        ShapeRenderer.renderRect(ctx, element)
        break
      case 'circle':
        ShapeRenderer.renderCircle(ctx, element)
        break
      case 'line':
        ShapeRenderer.renderLine(ctx, element)
        break
      case 'pen':
        ShapeRenderer.renderPen(ctx, element)
        break
      case 'text':
        ShapeRenderer.renderText(ctx, element)
        break
    }
  }

  // ======================================================================
  // 临时层渲染
  // ======================================================================

  /**
   * 渲染临时层
   *
   * 临时层每帧全量重绘，但仅包含少量交互元素：
   * - 正在拖拽的元素预览
   * - 选择框（选区边框）
   * - 多选手柄
   * - 远程光标
   *
   * 由于交互元素数量极少（通常 < 10 个），全量重绘开销可控。
   */
  private renderTempLayer(): void {
    const ctx = this.tempCtx
    const { width, height } = this.tempCanvas

    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(this.viewport.x, this.viewport.y)
    ctx.scale(this.viewport.zoom, this.viewport.zoom)

    // 绘制选中元素的选区边框
    this.renderSelectionBorders(ctx)

    ctx.restore()
  }

  /**
   * 绘制选中元素的选区边框
   *
   * 为每个选中的元素绘制蓝色虚线边框和控制手柄。
   *
   * @param ctx - Canvas 2D 上下文
   */
  private renderSelectionBorders(ctx: CanvasRenderingContext2D): void {
    if (this.selectedIds.size === 0) return

    ctx.strokeStyle = '#4A90D9'
    ctx.lineWidth = 2 / this.viewport.zoom // 线宽不受缩放影响
    ctx.setLineDash([5, 5])

    for (const id of this.selectedIds) {
      const element = this.elements.find((e) => e.id === id)
      if (!element) continue

      ctx.strokeRect(element.x - 2, element.y - 2, element.width + 4, element.height + 4)
    }

    ctx.setLineDash([])
  }

  // ======================================================================
  // 公共接口
  // ======================================================================

  /**
   * 设置元素列表
   *
   * 更新元素列表时标记主层需要全量重绘。
   *
   * @param elements - 新元素列表
   */
  setElements(elements: CanvasElement[]): void {
    this.elements = elements
    this.mainDirtyManager.markFullRedraw()
    this.scheduleRender('main')
  }

  /**
   * 添加元素
   *
   * 仅标记新元素包围盒为脏矩形，避免全量重绘。
   *
   * @param element - 新元素
   */
  addElement(element: CanvasElement): void {
    this.elements.push(element)
    this.markElementDirty(element)
    this.scheduleRender('main')
  }

  /**
   * 更新元素
   *
   * 标记旧包围盒和新包围盒为脏矩形，确保旧位置被清除。
   * 同时使离屏缓存失效。
   *
   * @param id - 元素 ID
   * @param updates - 需要更新的属性
   */
  updateElement(id: string, updates: Partial<CanvasElement>): void {
    const index = this.elements.findIndex((e) => e.id === id)
    if (index === -1) return

    const oldElement = this.elements[index]
    this.markElementDirty(oldElement)

    this.elements[index] = { ...oldElement, ...updates, updatedAt: Date.now() }

    this.markElementDirty(this.elements[index])
    this.offscreenManager.invalidateCache(id)
    this.scheduleRender('main')
  }

  /**
   * 删除元素
   *
   * 标记被删除元素的包围盒为脏矩形。
   *
   * @param id - 元素 ID
   */
  removeElement(id: string): void {
    const element = this.elements.find((e) => e.id === id)
    if (element) {
      this.markElementDirty(element)
    }
    this.elements = this.elements.filter((e) => e.id !== id)
    this.offscreenManager.invalidateCache(id)
    this.scheduleRender('main')
  }

  /**
   * 标记元素包围盒为脏矩形
   *
   * 将元素的世界坐标包围盒转换为屏幕坐标后标记为脏矩形。
   *
   * @param element - 发生变化的元素
   */
  private markElementDirty(element: CanvasElement): void {
    const screenPos = this.worldToScreen(element.x, element.y)
    const screenW = element.width * this.viewport.zoom
    const screenH = element.height * this.viewport.zoom

    this.mainDirtyManager.markDirty({
      x: screenPos.x,
      y: screenPos.y,
      width: screenW + 10, // 略大于元素包围盒，包含描边
      height: screenH + 10,
    })
  }

  /**
   * 设置选中元素
   *
   * 选区变化时，临时层需要重绘（更新选区边框）。
   *
   * @param ids - 选中的元素 ID 集合
   */
  setSelectedIds(ids: Set<string>): void {
    this.selectedIds = ids
    this.scheduleRender('temp')
  }

  /**
   * 获取离屏缓存管理器
   *
   * 供外部使用（如图片预加载）。
   */
  getOffscreenManager(): OffscreenCanvasManager {
    return this.offscreenManager
  }

  /**
   * 清理资源
   *
   * 取消 rAF 回调，断开 ResizeObserver。
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    this.offscreenManager.invalidateAll()
  }
}