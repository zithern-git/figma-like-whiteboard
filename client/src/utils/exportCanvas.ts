/**
 * 画布导出工具 (exportCanvas)
 *
 * 将白板画布导出为 PNG 文件。
 *
 * 关键设计：
 * - 离屏渲染：创建独立的 HTMLCanvasElement，把元素按当前视口绘制上去，
 *   不影响用户当前看到的画布
 * - 两种模式：
 *     'viewport' → 导出当前视口看到的范围（最常用）
 *     'content'  → 导出所有元素的外接包围盒（适合"导出全部"）
 * - DPR 适配：可指定 devicePixelRatio，让导出的 PNG 在 Retina 屏上不糊
 * - 触发下载：自动创建 <a download> 元素并 click，无需用户操作
 *
 * 注意：
 * - 渲染逻辑与 CanvasRenderer.renderElement 保持一致（透明度反向语义：1 - opacity）
 * - 图片元素在导出前会等待所有图片加载完成，避免导出时拿到占位框
 */

import { CanvasElement, Viewport } from '@/canvas/CanvasElement'

// ============================================================
// 类型
// ============================================================

export type ExportMode = 'viewport' | 'content'

export interface ExportOptions {
  /** 所有画布元素（来自 canvasStore.elements） */
  elements: CanvasElement[]
  /** 当前视口（来自 renderer.getViewport()） */
  viewport: Viewport
  /** 视口宽度（CSS 像素，DOMRect.width） */
  width: number
  /** 视口高度 */
  height: number
  /** 导出模式 */
  mode?: ExportMode
  /** 背景色（默认白色 'white'） */
  background?: string
  /** devicePixelRatio（默认 window.devicePixelRatio） */
  dpr?: number
  /** content 模式下的额外留白（像素，默认 20） */
  padding?: number
  /** content 模式下的最小尺寸（避免单个元素算出 0 尺寸，默认 400x300） */
  minContentSize?: { width: number; height: number }
}

// ============================================================
// 入口：导出 + 下载
// ============================================================

/**
 * 将元素渲染到离屏 canvas 并返回 PNG Blob
 *
 * 工作流程：
 * 1. 计算导出范围（视口 / 内容包围盒）
 * 2. 创建离屏 canvas 并填背景
 * 3. 应用坐标变换（zoom + translate），把世界坐标映射到画布坐标
 * 4. 逐个元素调用 renderElement
 * 5. canvas.toBlob → return Blob
 */
export async function exportToPNG(options: ExportOptions): Promise<Blob> {
  const {
    elements,
    viewport,
    width,
    height,
    mode = 'viewport',
    background = '#FFFFFF',
    dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    padding = 20,
    minContentSize = { width: 400, height: 300 },
  } = options

  // 1. 计算导出范围（CSS 像素，未应用 dpr）
  const region = computeExportRegion(elements, viewport, width, height, mode, padding, minContentSize)

  // 2. 创建离屏 canvas（实际像素 = CSS × dpr）
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(region.width * dpr)
  canvas.height = Math.round(region.height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[exportCanvas] 2d context unavailable')

  // 应用 dpr：后续所有 drawXxx 仍用 CSS 坐标
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 3. 背景
  if (background && background !== 'transparent') {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, region.width, region.height)
  }

  // 4. 坐标变换：把世界坐标 (elements) 映射到画布坐标
  // - viewport 模式：起点为 (0,0)，缩放 = zoom
  // - content 模式：起点为 (-region.originX, -region.originY)，缩放 = 1
  //   配合 region.originX/originY 把元素平移到画布原点附近
  ctx.save()
  if (mode === 'viewport') {
    ctx.translate(-viewport.translateX, -viewport.translateY)
    ctx.scale(viewport.zoom, viewport.zoom)
  } else {
    ctx.translate(-region.originX, -region.originY)
    ctx.scale(1, 1)
  }

  // 5. 异步预加载所有图片，避免导出拿到占位框
  await preloadAllImages(elements)

  // 6. 逐个渲染元素
  for (const el of elements) {
    renderElement(ctx, el)
  }

  ctx.restore()

  // 7. 转 Blob
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('[exportCanvas] toBlob 返回空'))
      },
      'image/png'
    )
  })
}

/**
 * 触发浏览器下载 Blob
 *
 * 通过临时 <a download> 实现，不影响当前页面 URL。
 * 用完后立即移除（避免内存泄漏）。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // 关键：异步清理，浏览器需要时间处理下载
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * 一站式便捷函数：导出 + 下载
 *
 * 默认文件名：whiteboard-{时间戳}.png
 */
export async function exportAndDownload(options: ExportOptions, filename?: string): Promise<void> {
  const blob = await exportToPNG(options)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadBlob(blob, filename ?? `whiteboard-${ts}.png`)
}

// ============================================================
// 内部：导出范围
// ============================================================

interface Region {
  width: number
  height: number
  /** 世界坐标下的原点 X（仅 content 模式使用） */
  originX: number
  /** 世界坐标下的原点 Y（仅 content 模式使用） */
  originY: number
}

function computeExportRegion(
  elements: CanvasElement[],
  _viewport: Viewport, // viewport 仅在 'viewport' 模式使用（外层已根据视口宽高直接返回）
  width: number,
  height: number,
  mode: ExportMode,
  padding: number,
  minContentSize: { width: number; height: number }
): Region {
  if (mode === 'viewport') {
    return { width, height, originX: 0, originY: 0 }
  }

  // content 模式：取所有元素的包围盒
  if (elements.length === 0) {
    return {
      width: minContentSize.width,
      height: minContentSize.height,
      originX: -minContentSize.width / 2,
      originY: -minContentSize.height / 2,
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const el of elements) {
    // 基于元素类型计算实际包围盒（与 CanvasRenderer.getElementBBox 一致）
    if ((el.type === 'line' || el.type === 'pen') && el.points && el.points.length > 0) {
      for (const p of el.points) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
    } else {
      if (el.x < minX) minX = el.x
      if (el.y < minY) minY = el.y
      if (el.x + el.width > maxX) maxX = el.x + el.width
      if (el.y + el.height > maxY) maxY = el.y + el.height
    }
  }

  // 旋转元素的包围盒需要扩展（粗略按元素中心 0.5*对角线扩展）
  for (const el of elements) {
    if (el.rotation) {
      const cx = el.x + el.width / 2
      const cy = el.y + el.height / 2
      const r = Math.sqrt(el.width * el.width + el.height * el.height) / 2
      minX = Math.min(minX, cx - r)
      minY = Math.min(minY, cy - r)
      maxX = Math.max(maxX, cx + r)
      maxY = Math.max(maxY, cy + r)
    }
  }

  const w = Math.max(minContentSize.width, maxX - minX + padding * 2)
  const h = Math.max(minContentSize.height, maxY - minY + padding * 2)
  return {
    width: w,
    height: h,
    originX: minX - padding,
    originY: minY - padding,
  }
}

// ============================================================
// 内部：元素渲染
// 与 CanvasRenderer.renderElement 保持一致（透明度反向语义、9 参数 drawImage）
// ============================================================

const imageCache = new Map<string, HTMLImageElement>()

async function preloadAllImages(elements: CanvasElement[]): Promise<void> {
  const urls = new Set<string>()
  for (const el of elements) {
    if (el.type === 'image' && el.imageUrl) urls.add(el.imageUrl)
  }
  if (urls.size === 0) return
  await Promise.all(Array.from(urls).map(loadImage))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached)
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageCache.set(url, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(`[exportCanvas] 图片加载失败: ${url}`))
    img.src = url
  })
}

function renderElement(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
  ctx.save()

  // 透明度：与 CanvasRenderer 保持一致（反向语义）
  if (element.opacity !== undefined && element.opacity !== 0) {
    ctx.globalAlpha = 1 - element.opacity
  }

  // 旋转：以元素中心为支点
  if (element.rotation) {
    const cx = element.x + element.width / 2
    const cy = element.y + element.height / 2
    ctx.translate(cx, cy)
    ctx.rotate(element.rotation)
    ctx.translate(-cx, -cy)
  }

  switch (element.type) {
    case 'rect': {
      const r = Math.min(element.cornerRadius || 0, element.width / 2, element.height / 2)
      ctx.strokeStyle = element.stroke || '#000000'
      ctx.fillStyle = element.fill || 'transparent'
      ctx.lineWidth = element.strokeWidth || 2
      ctx.beginPath()
      if (r > 0) {
        ctx.moveTo(element.x + r, element.y)
        ctx.lineTo(element.x + element.width - r, element.y)
        ctx.arcTo(element.x + element.width, element.y, element.x + element.width, element.y + r, r)
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
      if (element.fill !== 'transparent') ctx.fill()
      ctx.stroke()
      break
    }

    case 'circle': {
      ctx.strokeStyle = element.stroke || '#000000'
      ctx.fillStyle = element.fill || 'transparent'
      ctx.lineWidth = element.strokeWidth || 2
      ctx.beginPath()
      ctx.ellipse(
        element.x + element.width / 2,
        element.y + element.height / 2,
        element.width / 2,
        element.height / 2,
        0,
        0,
        Math.PI * 2
      )
      ctx.stroke()
      if (element.fill !== 'transparent') ctx.fill()
      break
    }

    case 'line': {
      ctx.strokeStyle = element.stroke || '#000000'
      ctx.lineWidth = element.strokeWidth || 2
      ctx.beginPath()
      if (element.points && element.points.length >= 2) {
        ctx.moveTo(element.points[0].x, element.points[0].y)
        ctx.lineTo(element.points[1].x, element.points[1].y)
      }
      ctx.stroke()
      break
    }

    case 'pen': {
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
      }
      ctx.stroke()
      break
    }

    case 'text': {
      const fontSize = element.fontSize || 16
      const fontFamily = element.fontFamily || 'Arial'
      const fontWeight = element.fontWeight || 'normal'
      const fontStyle = element.fontStyle || 'normal'
      const textAlign = element.textAlign || 'left'
      const textColor = element.textColor || element.fill || '#000000'

      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
      ctx.fillStyle = textColor
      ctx.textAlign = textAlign as CanvasTextAlign
      ctx.textBaseline = 'top'

      if (element.text) {
        let displayText = element.text
        if (displayText.length > 500) displayText = displayText.substring(0, 497) + '...'

        let anchorX = element.x
        if (textAlign === 'center') anchorX = element.x + element.width / 2
        else if (textAlign === 'right') anchorX = element.x + element.width

        const lines = displayText.split('\n')
        const lineHeight = fontSize * 1.4
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], anchorX, element.y + i * lineHeight)
        }
      }
      break
    }

    case 'image': {
      if (!element.imageUrl) break
      const img = imageCache.get(element.imageUrl)
      if (!img || img.naturalWidth === 0) break
      const sx = element.sourceX ?? 0
      const sy = element.sourceY ?? 0
      const sw = element.sourceWidth ?? img.naturalWidth
      const sh = element.sourceHeight ?? img.naturalHeight
      ctx.drawImage(img, sx, sy, sw, sh, element.x, element.y, element.width, element.height)
      break
    }
  }

  ctx.restore()
}
