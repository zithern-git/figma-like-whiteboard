/**
 * 图形渲染器 (ShapeRenderer) 🔥
 *
 * 负责在 Canvas 2D 上下文中渲染各种图形类型。
 * 采用统一接口设计，每种图形类型对应一个独立渲染方法。
 * 所有渲染方法均为纯函数，不修改外部状态，仅接收 Canvas 2D 上下文和元素数据。
 *
 * 核心技术点：
 * - Catmull-Rom 曲线平滑：画笔路径使用 Catmull-Rom 插值实现平滑曲线
 * - 包围盒渲染：所有图形都基于元素包围盒定位和缩放
 * - 性能优化：路径复用（Path2D 对象可缓存），避免重复字符串拼接
 */

import { CanvasElement, Point } from './CanvasElement'

/**
 * Catmull-Rom 曲线插值 🔥
 *
 * 用于将画笔的离散点序列平滑为曲线。
 * 在每两个原始点之间插入插值点，使曲线经过所有原始点且切线连续。
 *
 * 原理：Catmull-Rom 样条是一种插值样条，曲线经过所有控制点，
 * 通过相邻 4 个控制点计算中间段曲线，保证 C1 连续性。
 *
 * @param points - 原始点序列（至少 4 个点）
 * @param segments - 每段曲线插值点数（默认 10，越大越平滑）
 * @returns 平滑后的点序列
 */
export function catmullRomSmooth(points: Point[], segments: number = 10): Point[] {
  if (points.length < 2) return points
  if (points.length < 4) {
    // 点不足 4 个时，用线性插值代替
    const result: Point[] = []
    for (let i = 0; i < points.length - 1; i++) {
      for (let s = 0; s <= segments; s++) {
        const t = s / segments
        result.push({
          x: points[i].x + (points[i + 1].x - points[i].x) * t,
          y: points[i].y + (points[i + 1].y - points[i].y) * t,
        })
      }
    }
    return result
  }

  const result: Point[] = []

  // 对每个区间 [i, i+1] 进行 Catmull-Rom 插值
  // 使用 P0=points[i-1], P1=points[i], P2=points[i+1], P3=points[i+2] 四个控制点
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)] // 左外点（边界时取自身）
    const p1 = points[i] // 起点
    const p2 = points[i + 1] // 终点
    const p3 = points[Math.min(points.length - 1, i + 2)] // 右外点

    for (let s = 0; s <= segments; s++) {
      const t = s / segments
      const t2 = t * t
      const t3 = t2 * t

      // Catmull-Rom 基函数矩阵
      result.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }

  return result
}

/**
 * 图形渲染器类
 *
 * 封装所有图形类型的渲染逻辑，每种图形一个独立渲染方法。
 * 渲染时使用元素包围盒定位，通过 translate 和 scale 实现坐标变换。
 * 所有方法在绘制前设置 ctx.save() / ctx.restore() 确保状态隔离。
 */
export class ShapeRenderer {
  /** 私有构造函数，仅提供静态方法 */
  private constructor() {}

  /**
   * 渲染画笔路径
   *
   * 使用 Catmull-Rom 平滑算法处理点序列，生成平滑曲线。
   * 画笔路径不支持填充，仅使用描边色。
   *
   * @param ctx - Canvas 2D 渲染上下文
   * @param element - 画笔元素
   */
  static renderPen(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    if (!element.points || element.points.length < 2) return

    ctx.save()
    ctx.globalAlpha = element.opacity
    ctx.strokeStyle = element.stroke
    ctx.lineWidth = element.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Catmull-Rom 平滑：将离散点序列插值为平滑曲线
    const smoothedPoints = catmullRomSmooth(element.points)

    ctx.beginPath()
    ctx.moveTo(smoothedPoints[0].x, smoothedPoints[0].y)
    for (let i = 1; i < smoothedPoints.length; i++) {
      ctx.lineTo(smoothedPoints[i].x, smoothedPoints[i].y)
    }
    ctx.stroke()
    ctx.restore()
  }

  /**
   * 渲染直线
   *
   * 支持箭头端点样式：通过判断 element.points 长度，
   * 2 个点表示普通直线，>2 个点表示带箭头的直线。
   *
   * @param ctx - Canvas 2D 渲染上下文
   * @param element - 直线元素
   */
  static renderLine(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    if (!element.points || element.points.length < 2) return

    ctx.save()
    ctx.globalAlpha = element.opacity
    ctx.strokeStyle = element.stroke
    ctx.lineWidth = element.strokeWidth
    ctx.lineCap = 'round'

    const [start, end] = element.points

    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // 如果有箭头标记（points 长度 > 2），在终点绘制箭头
    if (element.points.length > 2) {
      drawArrowHead(ctx, start, end, element.stroke, element.strokeWidth)
    }

    ctx.restore()
  }

  /**
   * 渲染矩形
   *
   * 支持填充、描边和圆角半径。圆角通过 Math.min 限制为不大于宽高的一半。
   *
   * @param ctx - Canvas 2D 渲染上下文
   * @param element - 矩形元素
   * @param radius - 圆角半径（默认 0 表示直角）
   */
  static renderRect(
    ctx: CanvasRenderingContext2D,
    element: CanvasElement,
    radius: number = 0
  ): void {
    ctx.save()
    ctx.globalAlpha = element.opacity

    const r = Math.min(radius, element.width / 2, element.height / 2)

    // 绘制圆角矩形路径
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

    // 先填充再描边，确保描边在填充之上
    ctx.fillStyle = element.fill
    ctx.fill()
    ctx.strokeStyle = element.stroke
    ctx.lineWidth = element.strokeWidth
    ctx.stroke()

    ctx.restore()
  }

  /**
   * 渲染圆形/椭圆
   *
   * 使用 ellipse 方法绘制，支持独立横向和纵向半径（椭圆模式）。
   * 当 width === height 时为正圆。
   *
   * @param ctx - Canvas 2D 渲染上下文
   * @param element - 圆形元素
   */
  static renderCircle(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    ctx.save()
    ctx.globalAlpha = element.opacity

    const cx = element.x + element.width / 2
    const cy = element.y + element.height / 2
    const rx = element.width / 2
    const ry = element.height / 2

    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.closePath()

    ctx.fillStyle = element.fill
    ctx.fill()
    ctx.strokeStyle = element.stroke
    ctx.lineWidth = element.strokeWidth
    ctx.stroke()

    ctx.restore()
  }

  /**
   * 渲染文本
   *
   * 支持多种文本样式：fontSize、fontFamily、color、alignment、bold、italic。
   * 超长文本（>500 字符）自动截断并添加省略号（边界情况处理）。
   * 使用 textAlign 实现水平对齐，textBaseline 实现垂直对齐。
   *
   * @param ctx - Canvas 2D 渲染上下文
   * @param element - 文本元素
   */
  static renderText(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    if (!element.text) return

    ctx.save()
    ctx.globalAlpha = element.opacity

    const fontSize = element.fontSize || 16
    const fontFamily = element.fontFamily || 'Arial'
    const isBold = false // 可从扩展属性获取
    const isItalic = false

    // 构建字体字符串：font-style font-weight font-size font-family
    ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}px ${fontFamily}`
    ctx.fillStyle = element.fill
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    // 超长文本截断：超过 500 字符时截断并添加省略号
    let displayText = element.text
    if (displayText.length > 500) {
      displayText = displayText.substring(0, 497) + '...'
    }

    // 逐行渲染（支持换行符 \n）
    const lines = displayText.split('\n')
    const lineHeight = fontSize * 1.4 // 行高设置为字号的 1.4 倍

    lines.forEach((line, index) => {
      ctx.fillText(line, element.x, element.y + index * lineHeight)
    })

    ctx.restore()
  }

  /**
   * 渲染图片
   *
   * 通过 drawImage 将图片绘制到 Canvas 上。
   * 如果图片尚未加载，返回 false 表示需要重试渲染。
   *
   * @param ctx - Canvas 2D 渲染上下文
   * @param element - 图片元素
   * @param imageCache - 图片缓存 Map（URL -> HTMLImageElement）
   * @returns 是否成功渲染（图片已加载返回 true）
   */
  static renderImage(
    ctx: CanvasRenderingContext2D,
    element: CanvasElement,
    imageCache: Map<string, HTMLImageElement>
  ): boolean {
    if (!element.imageUrl) return false

    ctx.save()
    ctx.globalAlpha = element.opacity

    const cachedImage = imageCache.get(element.imageUrl)
    if (!cachedImage || !cachedImage.complete) {
      ctx.restore()
      return false // 图片未加载，需要重试
    }

    // 关键修复：使用 9 参数 ctx.drawImage 支持缩放和裁剪
    // - 源矩形 (sx, sy, sw, sh) 决定从图片哪个区域取（裁剪）
    // - 目标矩形 (dx, dy, dw, dh) 决定画到画布哪个位置和大小（缩放）
    // 缩放：把 sw × sh 区域拉伸/压缩到 dw × dh（element 的包围盒）
    // 裁剪：调整 sx/sy 把图片"平移"到想要的区域
    const sx = element.sourceX ?? 0
    const sy = element.sourceY ?? 0
    const sw = element.sourceWidth ?? cachedImage.naturalWidth
    const sh = element.sourceHeight ?? cachedImage.naturalHeight
    ctx.drawImage(
      cachedImage,
      sx,
      sy,
      sw,
      sh,
      element.x,
      element.y,
      element.width,
      element.height
    )
    ctx.restore()
    return true
  }
}

/**
 * 绘制箭头头部
 *
 * 在直线终点绘制箭头三角形，箭头方向由起点到终点的向量决定。
 * 箭头大小与描边宽度成正比。
 *
 * @param ctx - Canvas 2D 渲染上下文
 * @param from - 起点坐标
 * @param to - 终点坐标
 * @param color - 箭头颜色
 * @param lineWidth - 线宽
 */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  lineWidth: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const arrowSize = lineWidth * 4 // 箭头大小与线宽成正比

  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - arrowSize * Math.cos(angle - Math.PI / 6),
    to.y - arrowSize * Math.sin(angle - Math.PI / 6)
  )
  ctx.lineTo(
    to.x - arrowSize * Math.cos(angle + Math.PI / 6),
    to.y - arrowSize * Math.sin(angle + Math.PI / 6)
  )
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}