/**
 * Canvas 渲染引擎核心 (CanvasRenderer)
 *
 * 统一渲染架构：所有绘制操作必须通过 CanvasRenderer 进行，
 * 任何外部组件不得直接操作 canvas 上下文。
 *
 * 核心设计原则：
 * - bgCtx/mainCtx/tempCtx 为私有属性，外部不可访问
 * - 所有临时绘制内容通过 addTemporaryDraw() 注册到渲染队列
 * - CanvasRenderer 统一在 rAF 中绘制所有内容
 * - 主层元素和临时层内容使用完全相同的坐标变换逻辑
 */

import { CanvasElement } from './CanvasElement'
import { saveViewport } from './viewportStorage'

interface Viewport {
  translateX: number
  translateY: number
  zoom: number
}

interface TemporaryDrawItem {
  id: string
  render: (ctx: CanvasRenderingContext2D) => void
  zIndex: number
}

/**
 * 元素包围盒（世界坐标，未旋转）
 *
 * 用于手柄绘制、命中检测、缩放计算。
 * 对于直线/画笔，根据 points 派生包围盒。
 */
export interface ElementBBox {
  x: number
  y: number
  width: number
  height: number
  /** 元素中心（旋转支点） */
  cx: number
  cy: number
}

/**
 * 命中检测结果：决定 useElementTransform 要做的变换类型
 */
export type HitArea =
  | { type: 'none' }
  /** 8 个缩放手柄之一 */
  | {
      type: 'scale'
      handle: 'tl' | 'tm' | 'tr' | 'ml' | 'mr' | 'bl' | 'bm' | 'br'
    }
  /** 1 个旋转手柄 */
  | { type: 'rotate' }
  /** 元素主体（移动） */
  | { type: 'move' }

export class CanvasRenderer {
  private readonly dpr: number = window.devicePixelRatio || 1
  private readonly bgCanvas: HTMLCanvasElement
  private readonly mainCanvas: HTMLCanvasElement
  private readonly tempCanvas: HTMLCanvasElement
  private readonly bgCtx: CanvasRenderingContext2D
  private readonly mainCtx: CanvasRenderingContext2D
  private readonly tempCtx: CanvasRenderingContext2D

  private viewport: Viewport = { translateX: 0, translateY: 0, zoom: 1 }
  /**
   * 关键修复：白板 ID，用于 viewport 持久化的 localStorage 命名空间。
   * 未设置时不持久化（兜底）。
   */
  private whiteboardId: string | undefined
  private elements: CanvasElement[] = []
  private selectedIds: Set<string> = new Set()
  private temporaryDrawQueue: TemporaryDrawItem[] = []

  // 正在编辑的文本元素 ID，渲染时跳过该元素
  private editingTextId: string | null = null

  // 关键修复：图片缓存，按 URL 缓存已加载的 HTMLImageElement，
  // 避免每次 renderElement 都重新加载
  private imageCache: Map<string, HTMLImageElement> = new Map()

  private animationFrameId: number | null = null
  private dirtyFlags = { main: true, temp: true, bg: true }
  /**
   * 关键修复：窗口失焦时暂停 rAF，节省 CPU/GPU。
   * - 用户切到其他标签页或最小化窗口时不需要继续渲染
   * - 恢复焦点时由 markDirty 触发首次重画
   * 状态：true = 渲染中；false = 暂停
   */
  private isRendering = true

  constructor(
    bgCanvas: HTMLCanvasElement,
    mainCanvas: HTMLCanvasElement,
    tempCanvas: HTMLCanvasElement,
    options: {
      /** 关键修复：白板 ID，用于 viewport 持久化的 localStorage 命名空间 */
      whiteboardId?: string
      /** 关键修复：初始 viewport（一般从 localStorage 恢复），覆盖默认 {0,0,1} */
      initialViewport?: Viewport
    } = {}
  ) {
    this.bgCanvas = bgCanvas
    this.mainCanvas = mainCanvas
    this.tempCanvas = tempCanvas

    this.bgCtx = bgCanvas.getContext('2d')!
    this.mainCtx = mainCanvas.getContext('2d')!
    this.tempCtx = tempCanvas.getContext('2d')!

    this.whiteboardId = options.whiteboardId
    // 关键修复：用传入的初始 viewport 覆盖默认（从 localStorage 恢复）
    if (options.initialViewport) {
      this.viewport = { ...options.initialViewport }
    }

    this.resize()
    window.addEventListener('resize', this.resize)
    // 关键修复：用 visibilitychange 替代 window.blur/focus。
    // - 之前监听 window.blur：用户右键 → 检查（DevTools 打开）时焦点切到 DevTools
    //   内部会触发 window.blur，导致 rAF 循环被取消，画布停止渲染，出现"白屏"。
    //   必须点击画布让焦点回到页面才能恢复。
    // - 改用 document.visibilitychange + document.hidden：只在标签页真正不可见时
    //   才暂停 rAF（切到别的标签页/最小化），DevTools 打开不会触发，rAF 继续运行。
    //   标签页后台时 Chrome 本身就会把 rAF 节流到 1Hz，所以不需要主动 cancel。
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.startRenderLoop()
  }

  // ============================================================
  // 公共API - 外部组件只能调用这些方法
  // ============================================================

  /**
   * 添加临时绘制内容（用于工具预览、选区边框等）
   * @param id 唯一标识，用于更新或移除
   * @param render 绘制函数，接收已应用视口变换的上下文
   * @param zIndex 绘制顺序，数值越大越靠上
   */
  addTemporaryDraw(id: string, render: (ctx: CanvasRenderingContext2D) => void, zIndex = 0) {
    this.removeTemporaryDraw(id)
    this.temporaryDrawQueue.push({ id, render, zIndex })
    this.temporaryDrawQueue.sort((a, b) => a.zIndex - b.zIndex)
    this.markDirty('temp')
  }

  /**
   * 移除临时绘制内容
   */
  removeTemporaryDraw(id: string) {
    this.temporaryDrawQueue = this.temporaryDrawQueue.filter(item => item.id !== id)
    this.markDirty('temp')
  }

  /**
   * 清空所有临时绘制内容
   */
  clearAllTemporaryDraw() {
    this.temporaryDrawQueue = []
    this.markDirty('temp')
  }

  /**
   * 坐标转换：屏幕坐标 → 世界坐标
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewport.translateX) / this.viewport.zoom,
      y: (screenY - this.viewport.translateY) / this.viewport.zoom
    }
  }

  /**
   * 坐标转换：世界坐标 → 屏幕坐标
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX * this.viewport.zoom + this.viewport.translateX,
      y: worldY * this.viewport.zoom + this.viewport.translateY
    }
  }

  /**
   * 设置元素列表
   *
   * 关键修复：必须同时标记 main（元素本体）和 temp（选区边框+手柄）两层为脏。
   * 选区边框和手柄读自 this.elements 当前位置，元素被 update（缩放/移动/旋转）后
   * 手柄必须跟随重画，否则鼠标会与新位置的手柄失联。
   */
  setElements(elements: CanvasElement[]) {
    this.elements = elements
    this.markDirty('main')
    this.markDirty('temp')
  }

  /**
   * 设置选中元素ID
   */
  setSelectedIds(ids: Set<string>) {
    this.selectedIds = ids
    this.markDirty('temp')
  }

  /**
   * 设置正在编辑的文本元素 ID
   */
  setEditingTextId(id: string | null) {
    this.editingTextId = id
    this.markDirty('main')
  }

  /**
   * 设置视口
   */
  setViewport(viewport: Partial<Viewport>) {
    this.viewport = { ...this.viewport, ...viewport }
    this.markDirty('all')
    // 关键修复：viewport 变化时自动持久化到 localStorage（按 whiteboardId 命名空间），
    // 刷新页面后能恢复到用户上次的视图位置。saveViewport 内部用 rAF 节流，
    // 拖动时每帧都调用 setViewport 也只会触发一次写入，不会卡顿。
    if (this.whiteboardId) {
      saveViewport(this.whiteboardId, this.viewport)
    }
  }

  /**
   * 获取当前视口
   */
  getViewport(): Viewport {
    return { ...this.viewport }
  }

  /**
   * 销毁渲染器
   */
  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
    }
    window.removeEventListener('resize', this.resize)
    // 关键修复：清理 visibilitychange 监听器，避免内存泄漏
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  /**
   * 外部触发尺寸同步。
   *
   * 使用场景：Canvas 容器尺寸在非 window.resize 场景下发生变化
   * （如属性面板折叠 / 展开改变了相邻布局）。
   * 调用方应通过 ResizeObserver 监听容器尺寸并在变化时调用此方法。
   */
  public handleResize(): void {
    this.resize()
  }

  /**
   * 原子化的 resize + redraw。
   *
   * 与 handleResize() 的区别：handleResize() 内部调用 markDirty('all')，
   * 但 markDirty 只是设置 dirty flag，实际重绘发生在渲染 rAF 循环的下一次迭代。
   * 这之间存在一帧（约 16ms）的"画布已清空但还没重绘"间隙，
   * 在折叠/展开属性面板这种连续触发的场景下会表现为闪烁。
   *
   * 此方法在同一个 JS 任务里完成 resize() + 主动调用各层 render 方法，
   * 让浏览器下一帧 paint 时直接看到新尺寸的完整内容，没有空白帧。
   *
   * 注意：调用方仍应通过 rAF 批处理（避免每像素 resize），本方法只消除
   * 同一 rAF 内的 resize-redraw 间隙，不替代 rAF 批处理。
   */
  public resizeAndRender(): void {
    this.resize()
    // 主动重绘三层（与 startRenderLoop 内部一致），绕过 dirty flag 的下一帧延迟
    this.renderBackground()
    this.renderMainLayer()
    this.renderTempLayer()
    this.dirtyFlags.bg = false
    this.dirtyFlags.main = false
    this.dirtyFlags.temp = false
  }

  /**
   * 关键修复：标签页可见性变化处理。
   *
   * 之前监听 window.blur：DevTools 打开会让焦点离开页面，触发 window.blur，
   * rAF 被取消，画布停止渲染（白屏）。改用 document.visibilitychange：
   * - document.hidden === true：标签页切到后台 / 窗口最小化，暂停 rAF 节能
   * - document.hidden === false：标签页恢复前台，重启 rAF 并触发重画
   * - DevTools 打开/关闭：document.hidden 不变，rAF 不受影响
   */
  private handleVisibilityChange = () => {
    if (document.hidden) {
      // 关键修复：标签页切到后台时暂停 rAF 节能
      this.isRendering = false
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId)
        this.animationFrameId = null
      }
    } else {
      // 关键修复：标签页恢复前台时重启 rAF 并重画
      if (!this.isRendering) {
        this.isRendering = true
        this.markDirty('all')
        this.startRenderLoop()
      }
    }
  }

  /**
   * 加载图片（带缓存）
   *
   * 关键修复：同一个 URL 只创建一个 HTMLImageElement 实例，
   * 加载完成后自动 markDirty('main') 触发重画，避免图片加载后画面不更新。
   *
   * 关键修复（图片上传后整体操作变慢）：
   * - 问题：图片元素 addImageElement(dataUrl) 后 store 里有几十~100KB base64 字符串，
   *   任何后续操作（拖动/移动非图片元素）都会触发 Canvas 重绘，
   *   重绘时 `ctx.drawImage(img, ...)` 默认是**同步解码**——大图片（base64 或
   *   大 httpUrl）decode 阻塞主线程 100~300ms，导致所有操作都卡顿。
   * - 修复：显式设置 `img.decoding = 'async'`，告诉浏览器异步解码图片。
   *   浏览器在后台 decode，`ctx.drawImage` 在 decode 未完成时**立即返回不绘制**
   *   （不阻塞主线程）。decode 完成后通过 `img.decode().then(markDirty)` 触发重绘。
   * - 关键：监听 `load` 事件作为兜底（某些浏览器/老旧环境不支持 `decode()` API）。
   */
  private loadImage(url: string): HTMLImageElement {
    let img = this.imageCache.get(url)
    if (img) return img
    img = new Image()
    // 关键修复：跨域支持（如使用 CDN 图片）
    // 同源图片（默认行为）不会污染 canvas，drawImage 安全。
    // 跨域图片需要 crossOrigin='anonymous' + 服务端正确的 CORS 头才能 drawImage。
    // 这里我们所有图片都是同源（/uploads/...），保留 crossOrigin 是为了未来
    // 支持 CDN/外链图片的可能性。
    img.crossOrigin = 'anonymous'
    // 关键修复（图片上传后操作卡顿）：强制异步解码，避免 drawImage 阻塞主线程。
    // 默认值是 'auto'，浏览器可能选择同步解码，阻塞主线程 100~300ms。
    // 'async' 让浏览器后台 decode，drawImage 不阻塞。
    img.decoding = 'async'
    img.dataset.loaded = 'false'
    img.addEventListener(
      'load',
      () => {
        if (img.dataset.loaded !== 'true') {
          img.dataset.loaded = 'true'
          this.markDirty('main')
        }
      },
      { once: true }
    )
    img.addEventListener(
      'error',
      () => {
        this.markDirty('main')
      },
      { once: true }
    )
    img.src = url
    this.imageCache.set(url, img)
    // 关键修复（图片上传后操作卡顿）：显式调用 img.decode() 启动异步解码。
    // - decode() 返回 Promise，resolve 时图片已解码完成（bitmap 已就位）
    // - decode 完成后 markDirty('main') 触发 Canvas 重绘，drawImage 立即绘制（不阻塞）
    // - 如果 decode 失败（图片 404 / 损坏），catch 里 markDirty 触发重绘占位框
    // - 注意：load 事件 + decode() 是冗余的，load 触发时 decode 也会 resolve；
    //   这里用 dataset.loaded 防止重复 markDirty。
    if (typeof img.decode === 'function') {
      img
        .decode()
        .then(() => {
          if (img.dataset.loaded !== 'true') {
            img.dataset.loaded = 'true'
            this.markDirty('main')
          }
        })
        .catch(() => {
          // decode 失败（图片 404 / CORS / 损坏）→ 触发重绘显示占位框
          this.markDirty('main')
        })
    }
    return img
  }

  /**
   * 获取元素的包围盒（世界坐标，未旋转）
   *
   * 对于 pen/line 类型，基于 points 派生包围盒；
   * 其他类型直接返回 x/y/width/height。
   * 返回的中心点用于旋转支点计算。
   */
  getElementBBox(element: CanvasElement): ElementBBox {
    if ((element.type === 'line' || element.type === 'pen') && element.points && element.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of element.points) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
      }
    }
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      cx: element.x + element.width / 2,
      cy: element.y + element.height / 2,
    }
  }

  /**
   * 命中检测：判断世界坐标点落在选中元素的哪个区域
   *
   * 优先级：旋转手柄 > 缩放手柄（8 个）> 元素主体 > 无命中
   *
   * 仅对**单个**选中的元素生效；多选时只检测元素主体。
   * 对于已旋转的元素，先把点击点反旋转到元素本地坐标系再检测。
   */
  hitTest(element: CanvasElement, worldX: number, worldY: number, isOnlySelection: boolean): HitArea {
    const bbox = this.getElementBBox(element)
    const z = this.viewport.zoom

    // 关键修复：反旋转点击点到元素本地坐标系，让 hitTest 始终基于未旋转 bbox
    let lx = worldX
    let ly = worldY
    if (element.rotation) {
      const cos = Math.cos(-element.rotation)
      const sin = Math.sin(-element.rotation)
      const dx = worldX - bbox.cx
      const dy = worldY - bbox.cy
      lx = bbox.cx + dx * cos - dy * sin
      ly = bbox.cy + dx * sin + dy * cos
    }

    // 多选不显示缩放/旋转手柄
    if (!isOnlySelection) {
      if (
        lx >= bbox.x &&
        lx <= bbox.x + bbox.width &&
        ly >= bbox.y &&
        ly <= bbox.y + bbox.height
      ) {
        return { type: 'move' }
      }
      return { type: 'none' }
    }

    // 手柄在屏幕空间保持固定大小（缩放时看起来不会变）
    const HANDLE = 8 / z
    const ROTATE_OFFSET = 24 / z // 旋转手柄距离顶边的偏移

    // 关键修复：旋转手柄命中区扩大到 bbox 顶边（包含连接线），
    // 这样用户点手柄或连接线都能触发旋转，不会因为落在空白区被清空选区
    const rotateX = bbox.cx
    const rotateY = bbox.y - ROTATE_OFFSET
    if (
      lx >= rotateX - HANDLE &&
      lx <= rotateX + HANDLE &&
      ly >= rotateY - HANDLE &&
      ly <= bbox.y
    ) {
      return { type: 'rotate' }
    }

    // 8 个缩放手柄的位置
    const handles: Array<{ key: 'tl' | 'tm' | 'tr' | 'ml' | 'mr' | 'bl' | 'bm' | 'br'; hx: number; hy: number }> = [
      { key: 'tl', hx: bbox.x, hy: bbox.y },
      { key: 'tm', hx: bbox.cx, hy: bbox.y },
      { key: 'tr', hx: bbox.x + bbox.width, hy: bbox.y },
      { key: 'ml', hx: bbox.x, hy: bbox.cy },
      { key: 'mr', hx: bbox.x + bbox.width, hy: bbox.cy },
      { key: 'bl', hx: bbox.x, hy: bbox.y + bbox.height },
      { key: 'bm', hx: bbox.cx, hy: bbox.y + bbox.height },
      { key: 'br', hx: bbox.x + bbox.width, hy: bbox.y + bbox.height },
    ]
    for (const h of handles) {
      if (
        lx >= h.hx - HANDLE &&
        lx <= h.hx + HANDLE &&
        ly >= h.hy - HANDLE &&
        ly <= h.hy + HANDLE
      ) {
        return { type: 'scale', handle: h.key }
      }
    }

    // 元素主体
    if (
      lx >= bbox.x &&
      lx <= bbox.x + bbox.width &&
      ly >= bbox.y &&
      ly <= bbox.y + bbox.height
    ) {
      return { type: 'move' }
    }
    return { type: 'none' }
  }

  // ============================================================
  // 私有方法 - 内部渲染逻辑
  // ============================================================

  private resize = () => {
    const container = this.bgCanvas.parentElement!
    const cssWidth = container.clientWidth
    const cssHeight = container.clientHeight

    // 设置Canvas实际像素尺寸
    this.bgCanvas.width = cssWidth * this.dpr
    this.bgCanvas.height = cssHeight * this.dpr
    this.mainCanvas.width = cssWidth * this.dpr
    this.mainCanvas.height = cssHeight * this.dpr
    this.tempCanvas.width = cssWidth * this.dpr
    this.tempCanvas.height = cssHeight * this.dpr

    // 设置CSS显示尺寸
    this.bgCanvas.style.width = `${cssWidth}px`
    this.bgCanvas.style.height = `${cssHeight}px`
    this.mainCanvas.style.width = `${cssWidth}px`
    this.mainCanvas.style.height = `${cssHeight}px`
    this.tempCanvas.style.width = `${cssWidth}px`
    this.tempCanvas.style.height = `${cssHeight}px`

    // 应用DPR缩放，所有绘制使用CSS坐标
    this.bgCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.mainCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.tempCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    this.markDirty('all')
  }

  private startRenderLoop() {
    const render = () => {
      // 关键修复：被暂停时直接退出，不再 requestAnimationFrame
      if (!this.isRendering) {
        this.animationFrameId = null
        return
      }

      // 关键修复：用 try/catch 包裹每层渲染
      // 单帧渲染错误不应中断 rAF 循环，避免后续帧无法重画
      try {
        if (this.dirtyFlags.bg) {
          this.renderBackground()
          this.dirtyFlags.bg = false
        }
      } catch (err) {
        console.error('[CanvasRenderer] renderBackground error:', err)
        this.dirtyFlags.bg = false // 避免每帧都抛
      }

      try {
        if (this.dirtyFlags.main) {
          this.renderMainLayer()
          this.dirtyFlags.main = false
        }
      } catch (err) {
        // 关键修复：Canvas 渲染错误不影响 React 组件树
        // 也不让一帧错误卡住整个 rAF
        console.error('[CanvasRenderer] renderMainLayer error:', err)
        this.dirtyFlags.main = false
      }

      try {
        if (this.dirtyFlags.temp) {
          this.renderTempLayer()
          this.dirtyFlags.temp = false
        }
      } catch (err) {
        console.error('[CanvasRenderer] renderTempLayer error:', err)
        this.dirtyFlags.temp = false
      }

      this.animationFrameId = requestAnimationFrame(render)
    }

    this.animationFrameId = requestAnimationFrame(render)
  }

  private markDirty(layer: 'bg' | 'main' | 'temp' | 'all') {
    if (layer === 'all') {
      this.dirtyFlags.bg = true
      this.dirtyFlags.main = true
      this.dirtyFlags.temp = true
    } else {
      this.dirtyFlags[layer] = true
    }
  }

  private renderBackground() {
    const { width, height } = this.bgCanvas
    this.bgCtx.clearRect(0, 0, width / this.dpr, height / this.dpr)

    // 绘制网格
    this.bgCtx.strokeStyle = '#e0e0e0'
    this.bgCtx.lineWidth = 1

    const gridSize = 20 * this.viewport.zoom
    const offsetX = this.viewport.translateX % gridSize
    const offsetY = this.viewport.translateY % gridSize

    for (let x = offsetX; x < width / this.dpr; x += gridSize) {
      this.bgCtx.beginPath()
      this.bgCtx.moveTo(x, 0)
      this.bgCtx.lineTo(x, height / this.dpr)
      this.bgCtx.stroke()
    }

    for (let y = offsetY; y < height / this.dpr; y += gridSize) {
      this.bgCtx.beginPath()
      this.bgCtx.moveTo(0, y)
      this.bgCtx.lineTo(width / this.dpr, y)
      this.bgCtx.stroke()
    }
  }

  private renderMainLayer() {
    const { width, height } = this.mainCanvas
    this.mainCtx.clearRect(0, 0, width / this.dpr, height / this.dpr)

    this.mainCtx.save()
    this.mainCtx.translate(this.viewport.translateX, this.viewport.translateY)
    this.mainCtx.scale(this.viewport.zoom, this.viewport.zoom)

    // 渲染所有元素
    for (const element of this.elements) {
      // 关键修复：正在编辑的文本元素不渲染，避免编辑框和原文本重叠
      if (element.type === 'text' && element.id === this.editingTextId) {
        continue
      }
      this.renderElement(this.mainCtx, element)
    }

    this.mainCtx.restore()
  }

  private renderTempLayer() {
    const { width, height } = this.tempCanvas
    this.tempCtx.clearRect(0, 0, width / this.dpr, height / this.dpr)

    this.tempCtx.save()
    this.tempCtx.translate(this.viewport.translateX, this.viewport.translateY)
    this.tempCtx.scale(this.viewport.zoom, this.viewport.zoom)

    // 渲染所有临时绘制内容
    for (const item of this.temporaryDrawQueue) {
      item.render(this.tempCtx)
    }

    // 渲染选中元素边框
    for (const element of this.elements) {
      if (this.selectedIds.has(element.id)) {
        this.renderSelectionBorder(this.tempCtx, element)
      }
    }

    this.tempCtx.restore()
  }

  private renderElement(ctx: CanvasRenderingContext2D, element: CanvasElement) {
    ctx.save()

    // 关键修复：应用透明度（之前 opacity 字段写了但渲染时没用，右侧滑块不生效）
    // 关键修复：语义反转 — opacity=0 完全不透明，opacity=1 完全透明；
    // 因此 ctx.globalAlpha = 1 - opacity。
    if (element.opacity !== undefined && element.opacity !== 0) {
      ctx.globalAlpha = 1 - element.opacity
    }

    // 关键修复：应用旋转（以元素中心为支点）
    if (element.rotation) {
      const cx = element.x + element.width / 2
      const cy = element.y + element.height / 2
      ctx.translate(cx, cy)
      ctx.rotate(element.rotation)
      ctx.translate(-cx, -cy)
    }

    switch (element.type) {
      case 'rect': {
        // 关键修复：支持圆角半径 cornerRadius，半径自动限制在宽高一半以内
        const r = Math.min(element.cornerRadius || 0, element.width / 2, element.height / 2)
        ctx.strokeStyle = element.stroke || '#000000'
        ctx.fillStyle = element.fill || 'transparent'
        ctx.lineWidth = element.strokeWidth || 2
        ctx.beginPath()
        if (r > 0) {
          // 圆角矩形路径（与 ShapeRenderer.renderRect 保持一致）
          ctx.moveTo(element.x + r, element.y)
          ctx.lineTo(element.x + element.width - r, element.y)
          ctx.arcTo(
            element.x + element.width,
            element.y,
            element.x + element.width,
            element.y + r,
            r
          )
          ctx.lineTo(element.x + element.width, element.y + element.height - r)
          ctx.arcTo(
            element.x + element.width,
            element.y + element.height,
            element.x + element.width - r,
            element.y + element.height,
            r
          )
          ctx.lineTo(element.x + r, element.y + element.height)
          ctx.arcTo(element.x, element.y + element.height, element.x, element.y + element.height - r, r)
          ctx.lineTo(element.x, element.y + r)
          ctx.arcTo(element.x, element.y, element.x + r, element.y, r)
        } else {
          ctx.rect(element.x, element.y, element.width, element.height)
        }
        ctx.closePath()
        if (element.fill !== 'transparent') {
          ctx.fill()
        }
        ctx.stroke()
        break
      }

      case 'circle':
        ctx.strokeStyle = element.stroke || '#000000'
        ctx.fillStyle = element.fill || 'transparent'
        ctx.lineWidth = element.strokeWidth || 2
        ctx.beginPath()
        ctx.ellipse(
          element.x + element.width / 2,
          element.y + element.height / 2,
          element.width / 2,
          element.height / 2,
          0, 0, Math.PI * 2
        )
        ctx.stroke()
        if (element.fill !== 'transparent') {
          ctx.fill()
        }
        break

      case 'line':
        ctx.strokeStyle = element.stroke || '#000000'
        ctx.lineWidth = element.strokeWidth || 2
        ctx.beginPath()
        if (element.points && element.points.length >= 2) {
          ctx.moveTo(element.points[0].x, element.points[0].y)
          ctx.lineTo(element.points[1].x, element.points[1].y)
        }
        ctx.stroke()
        break

      case 'pen':
        ctx.strokeStyle = element.stroke || '#000000'
        ctx.lineWidth = element.strokeWidth || 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        if (element.points && element.points.length > 0) {
          ctx.moveTo(element.points[0].x, element.points[0].y)
          for (let i = 1; i < element.points.length; i++) {
            ctx.lineTo(element.points[i].x, element.points[i].y)
          }
          ctx.stroke()
        }
        break

      case 'text': {
        const fontSize = element.fontSize || 16
        const fontFamily = element.fontFamily || 'Arial'
        const fontWeight = element.fontWeight || 'normal'
        const fontStyle = element.fontStyle || 'normal'
        const textAlign = element.textAlign || 'left'
        // 关键修复：文字颜色优先用 textColor，其次用 fill
        const textColor = element.textColor || element.fill || '#000000'

        // 关键修复：完整构造 font 字符串（含 weight + style）
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
        ctx.fillStyle = textColor
        ctx.textAlign = textAlign
        ctx.textBaseline = 'top'

        if (element.text) {
          // 关键修复：根据对齐方式计算 x 锚点
          // - left:  以 element.x 为左端
          // - center: 以元素中心为中点
          // - right: 以 element.x + element.width 为右端
          let anchorX = element.x
          if (textAlign === 'center') {
            anchorX = element.x + element.width / 2
          } else if (textAlign === 'right') {
            anchorX = element.x + element.width
          }

          // 关键修复：超长文本截断（>500 字符）边界情况处理
          // - 截断首段后加省略号
          // - 防止超长文本导致 fillText 卡顿和性能问题
          let displayText = element.text
          if (displayText.length > 500) {
            displayText = displayText.substring(0, 497) + '...'
          }

          // 关键修复：支持多行（按 \n 拆分）
          const lines = displayText.split('\n')
          const lineHeight = fontSize * 1.4
          for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], anchorX, element.y + i * lineHeight)
          }
        }
        break
      }

      case 'image': {
        // 关键修复：使用 ctx.drawImage 9 参数形式，支持裁剪 + 缩放
        if (!element.imageUrl) break
        const img = this.loadImage(element.imageUrl)
        if (!img.complete || img.naturalWidth === 0) {
          // 图片还没加载好，绘制占位框
          // 关键修复（v4 混合方案）：区分"等待上传"和"加载中"
          // - blobUrl (blob:http://...): A 端上传中 / B 端无法访问 → "等待上传..."
          // - httpUrl (/uploads/...): HTTP 加载中 → "加载中..."
          // 之前两者都显示"加载中..."，B 端 blobUrl 永远不可访问 → 用户看到"永远加载中"
          // 修复后 B 端看到"等待上传..."，知道图片正在被上传，避免困惑
          const isBlobUrl = element.imageUrl.startsWith('blob:')
          const placeholderText = isBlobUrl ? '等待上传…' : '加载中…'
          ctx.save()
          ctx.fillStyle = '#f3f4f6'
          ctx.fillRect(element.x, element.y, element.width, element.height)
          ctx.strokeStyle = '#d1d5db'
          ctx.lineWidth = 1 / this.viewport.zoom
          ctx.setLineDash([5 / this.viewport.zoom, 5 / this.viewport.zoom])
          ctx.strokeRect(element.x, element.y, element.width, element.height)
          ctx.fillStyle = '#9ca3af'
          ctx.font = `${12 / this.viewport.zoom}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(
            placeholderText,
            element.x + element.width / 2,
            element.y + element.height / 2
          )
          ctx.restore()
          // 关键修复（图片上传后操作卡顿）：
          // **移除**之前 `img.addEventListener('load', () => this.markDirty('main'))`
          // 这段代码。
          // 原因：
          //   - Canvas 重绘频率高（拖动 30+ fps / 移动 / 缩放 都会触发）
          //   - 每次重绘都会执行 renderElement → 走到这段代码
          //   - 之前会用 `img.addEventListener('load', ..., { once: true })` 重复注册
          //   - 30+ fps 下累计几十个 load 监听器
          //   - 图片加载完成时所有监听器都触发 → 几十次 markDirty('main')
          //   - 每次 markDirty 触发 next rAF 重绘 → 几十次 rAF 重绘
          //   - **drawImage 同步解码 + 几十次重绘 = 主线程卡顿 100~500ms**
          //   - 这就是用户反馈"图片上传后所有操作都变慢"的核心原因之一。
          // 修复：
          //   - load / decode 监听器**只在 loadImage 首次创建 img 时注册一次**（imageCache 唯一实例）
          //   - 后续 Canvas 重绘不再重复注册
          //   - 图片加载完成后由 imageCache 中的 img 实例统一触发一次 markDirty
          break
        }

        // 源矩形（裁剪/缩放）：
        // 默认取整张图片（0,0,naturalWidth,naturalHeight）
        // 用户可通过 sourceX/sourceY/sourceWidth/sourceHeight 调整
        const sx = element.sourceX ?? 0
        const sy = element.sourceY ?? 0
        const sw = element.sourceWidth ?? img.naturalWidth
        const sh = element.sourceHeight ?? img.naturalHeight
        // 目标矩形：element 的包围盒
        const dx = element.x
        const dy = element.y
        const dw = element.width
        const dh = element.height

        // 关键修复：使用 9 参数 drawImage 实现裁剪 + 缩放
        // 缩放：将 sw × sh 的源区域拉伸/压缩到 dw × dh 的目标区域
        // 裁剪：sx/sy 指定从图片哪个位置开始取
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
        break
      }
    }

    ctx.restore()
  }

  private renderSelectionBorder(ctx: CanvasRenderingContext2D, element: CanvasElement) {
    ctx.save()
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 1 / this.viewport.zoom
    ctx.setLineDash([5 / this.viewport.zoom, 5 / this.viewport.zoom])

    let x, y, w, h

    if (element.type === 'line' && element.points && element.points.length >= 2) {
      x = Math.min(element.points[0].x, element.points[1].x) - 5
      y = Math.min(element.points[0].y, element.points[1].y) - 5
      w = Math.abs(element.points[1].x - element.points[0].x) + 10
      h = Math.abs(element.points[1].y - element.points[0].y) + 10
    } else {
      x = element.x - 5
      y = element.y - 5
      w = element.width + 10
      h = element.height + 10
    }

    // 关键修复：让选区边框跟随元素旋转
    if (element.rotation) {
      const bbox = this.getElementBBox(element)
      ctx.translate(bbox.cx, bbox.cy)
      ctx.rotate(element.rotation)
      ctx.translate(-bbox.cx, -bbox.cy)
    }

    ctx.strokeRect(x, y, w, h)
    ctx.restore()

    // 关键修复：单选时绘制 8 个缩放手柄 + 1 个旋转手柄
    if (this.selectedIds.size === 1) {
      this.drawTransformHandles(ctx, element)
    }
  }

  /**
   * 绘制 8 个缩放手柄 + 1 个旋转手柄
   *
   * - 手柄在屏幕空间保持固定大小（缩放时看起来不会变）
   * - 旋转手柄位于顶边中点上方，连线连接到包围盒
   * - 旋转手柄带圆形外观以区别于方形缩放手柄
   * - 跟随元素旋转（手柄在元素本地坐标系中绘制，绘制前应用旋转）
   */
  private drawTransformHandles(ctx: CanvasRenderingContext2D, element: CanvasElement) {
    const bbox = this.getElementBBox(element)
    const z = this.viewport.zoom
    const HALF = 4 / z // 手柄边长的一半（屏幕空间 8px）
    const ROTATE_OFFSET = 24 / z

    ctx.save()

    // 关键修复：让手柄跟随元素旋转（应用与元素相同的旋转）
    if (element.rotation) {
      ctx.translate(bbox.cx, bbox.cy)
      ctx.rotate(element.rotation)
      ctx.translate(-bbox.cx, -bbox.cy)
    }

    ctx.setLineDash([]) // 手柄边框用实线

    // 绘制从包围盒顶边中点到旋转手柄的连线
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 1 / z
    ctx.beginPath()
    ctx.moveTo(bbox.cx, bbox.y)
    ctx.lineTo(bbox.cx, bbox.y - ROTATE_OFFSET)
    ctx.stroke()

    // 旋转手柄（圆形）
    const rotX = bbox.cx
    const rotY = bbox.y - ROTATE_OFFSET
    ctx.fillStyle = '#FFFFFF'
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 1.5 / z
    ctx.beginPath()
    ctx.arc(rotX, rotY, HALF + 1 / z, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 8 个缩放手柄（方形）
    const handles: Array<{ hx: number; hy: number }> = [
      { hx: bbox.x, hy: bbox.y },
      { hx: bbox.cx, hy: bbox.y },
      { hx: bbox.x + bbox.width, hy: bbox.y },
      { hx: bbox.x, hy: bbox.cy },
      { hx: bbox.x + bbox.width, hy: bbox.cy },
      { hx: bbox.x, hy: bbox.y + bbox.height },
      { hx: bbox.cx, hy: bbox.y + bbox.height },
      { hx: bbox.x + bbox.width, hy: bbox.y + bbox.height },
    ]
    ctx.fillStyle = '#FFFFFF'
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 1.5 / z
    for (const h of handles) {
      ctx.beginPath()
      ctx.rect(h.hx - HALF, h.hy - HALF, HALF * 2, HALF * 2)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()
  }
}
