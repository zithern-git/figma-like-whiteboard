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

export class CanvasRenderer {
  private readonly dpr: number = window.devicePixelRatio || 1
  private readonly bgCanvas: HTMLCanvasElement
  private readonly mainCanvas: HTMLCanvasElement
  private readonly tempCanvas: HTMLCanvasElement
  private readonly bgCtx: CanvasRenderingContext2D
  private readonly mainCtx: CanvasRenderingContext2D
  private readonly tempCtx: CanvasRenderingContext2D

  private viewport: Viewport = { translateX: 0, translateY: 0, zoom: 1 }
  private elements: CanvasElement[] = []
  private selectedIds: Set<string> = new Set()
  private temporaryDrawQueue: TemporaryDrawItem[] = []

  // 正在编辑的文本元素 ID，渲染时跳过该元素
  private editingTextId: string | null = null

  private animationFrameId: number | null = null
  private dirtyFlags = { main: true, temp: true, bg: true }

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

    this.resize()
    window.addEventListener('resize', this.resize)
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
   */
  setElements(elements: CanvasElement[]) {
    this.elements = elements
    this.markDirty('main')
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
      if (this.dirtyFlags.bg) {
        this.renderBackground()
        this.dirtyFlags.bg = false
      }

      if (this.dirtyFlags.main) {
        this.renderMainLayer()
        this.dirtyFlags.main = false
      }

      if (this.dirtyFlags.temp) {
        this.renderTempLayer()
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

    switch (element.type) {
      case 'rect':
        ctx.strokeStyle = element.stroke || '#000000'
        ctx.fillStyle = element.fill || 'transparent'
        ctx.lineWidth = element.strokeWidth || 2
        ctx.strokeRect(element.x, element.y, element.width, element.height)
        if (element.fill !== 'transparent') {
          ctx.fillRect(element.x, element.y, element.width, element.height)
        }
        break

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

      case 'text':
        ctx.fillStyle = element.fill || '#000000'
        ctx.font = `${element.fontSize || 16}px ${element.fontFamily || 'Arial'}`
        ctx.textBaseline = 'top'
        if (element.text) {
          ctx.fillText(element.text, element.x, element.y)
        }
        break
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

    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }
}
