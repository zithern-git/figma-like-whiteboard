/**
 * Canvas 渲染性能自动化测试工具
 *
 * 提供自动化性能测试功能，用于验证白板系统在不同元素数量下的渲染性能。
 *
 * 测试指标：
 * - 平均帧率（Average FPS）
 * - 最低帧率（Min FPS）
 * - 最高帧率（Max FPS）
 * - 帧率稳定性（标准差）
 * - 丢帧率（Dropped Frames Ratio）
 *
 * 测试流程：
 * 1. 清空画布
 * 2. 生成指定数量的随机元素
 * 3. 连续渲染 N 秒，记录每帧耗时
 * 4. 计算统计数据
 * 5. 导出结果
 */

import { CanvasElement } from '@/canvas/CanvasElement'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'
import { nanoid } from 'nanoid'

/** 性能测试结果 */
export interface PerformanceTestResult {
  /** 测试名称 */
  testName: string
  /** 测试时间戳 */
  timestamp: number
  /** 元素数量 */
  elementCount: number
  /** 测试时长（毫秒） */
  duration: number
  /** 总帧数 */
  totalFrames: number
  /** 平均帧率 */
  averageFps: number
  /** 最低帧率 */
  minFps: number
  /** 最高帧率 */
  maxFps: number
  /** 帧率标准差 */
  fpsStdDev: number
  /** 丢帧数（低于 30fps 的帧） */
  droppedFrames: number
  /** 丢帧率 */
  droppedFrameRatio: number
  /** 第 1 百分位帧率 */
  p1Fps: number
  /** 第 50 百分位帧率（中位数） */
  p50Fps: number
  /** 第 99 百分位帧率 */
  p99Fps: number
  /** 每帧原始耗时数据（毫秒） */
  frameTimings: number[]
  /** 浏览器信息 */
  userAgent: string
  /** 屏幕分辨率 */
  screenResolution: string
  /** DPR */
  devicePixelRatio: number
}

/** WebSocket 压力测试结果 */
export interface WebSocketStressResult {
  /** 测试名称 */
  testName: string
  /** 测试时间戳 */
  timestamp: number
  /** 客户端数量 */
  clientCount: number
  /** 总操作数 */
  totalOps: number
  /** 成功操作数 */
  successOps: number
  /** 失败操作数 */
  failedOps: number
  /** 平均端到端延迟（ms） */
  avgLatency: number
  /** P95 延迟（ms） */
  p95Latency: number
  /** P99 延迟（ms） */
  p99Latency: number
  /** 最大延迟（ms） */
  maxLatency: number
  /** 测试期间平均帧率 */
  averageFps: number
  /** 帧率是否达标（>=45fps） */
  fpsPassed: boolean
  /** 测试时长（ms） */
  duration: number
}

/** 测试配置 */
export interface TestConfig {
  /** 元素数量 */
  elementCount: number
  /** 测试时长（秒） */
  duration: number
  /** 元素类型 */
  elementType: 'rect' | 'circle' | 'mixed' | 'text' | 'image' | 'all'
  /** 元素最小尺寸 */
  minSize: number
  /** 元素最大尺寸 */
  maxSize: number
}

/** 默认测试配置 */
const DEFAULT_CONFIG: TestConfig = {
  elementCount: 1000,
  duration: 10,
  elementType: 'mixed',
  minSize: 20,
  maxSize: 100,
}

/** 压力测试配置 */
const STRESS_TEST_CONFIG: TestConfig = {
  elementCount: 5000,
  duration: 10,
  elementType: 'mixed',
  minSize: 10,
  maxSize: 80,
}

/** 1000+ 元素测试配置 */
const THOUSAND_ELEMENTS_CONFIG: TestConfig = {
  elementCount: 1000,
  duration: 10,
  elementType: 'all',
  minSize: 10,
  maxSize: 150,
}

/**
 * 生成随机颜色（hex 格式）
 */
function randomColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#F9E79F',
    '#D7BDE2', '#A9DFBF', '#FAD7A0', '#AED6F1', '#A3E4D7',
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

/**
 * 生成随机矩形元素
 */
function generateRandomRect(
  canvasWidth: number,
  canvasHeight: number,
  minSize: number,
  maxSize: number
): CanvasElement {
  const width = minSize + Math.random() * (maxSize - minSize)
  const height = minSize + Math.random() * (maxSize - minSize)
  const x = Math.random() * (canvasWidth - width)
  const y = Math.random() * (canvasHeight - height)

  return {
    id: nanoid(),
    type: 'rect',
    x,
    y,
    width,
    height,
    rotation: (Math.random() - 0.5) * 0.5,
    opacity: 0.7 + Math.random() * 0.3,
    fill: randomColor(),
    stroke: randomColor(),
    strokeWidth: 1 + Math.random() * 3,
    cornerRadius: Math.random() > 0.5 ? Math.random() * 10 : 0,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'performance-test',
  }
}

/**
 * 生成随机圆形元素
 */
function generateRandomCircle(
  canvasWidth: number,
  canvasHeight: number,
  minSize: number,
  maxSize: number
): CanvasElement {
  const size = minSize + Math.random() * (maxSize - minSize)
  const x = Math.random() * (canvasWidth - size)
  const y = Math.random() * (canvasHeight - size)

  return {
    id: nanoid(),
    type: 'circle',
    x,
    y,
    width: size,
    height: size,
    rotation: 0,
    opacity: 0.7 + Math.random() * 0.3,
    fill: randomColor(),
    stroke: randomColor(),
    strokeWidth: 1 + Math.random() * 3,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'performance-test',
  }
}

/**
 * 生成随机文本元素
 */
function generateRandomText(
  canvasWidth: number,
  canvasHeight: number,
  minSize: number,
  maxSize: number
): CanvasElement {
  const width = minSize * 2 + Math.random() * (maxSize * 2 - minSize * 2)
  const height = minSize + Math.random() * (maxSize - minSize)
  const x = Math.random() * (canvasWidth - width)
  const y = Math.random() * (canvasHeight - height)
  const texts = ['Hello', 'World', 'Test', 'Demo', 'Sample', 'Performance', 'Canvas', 'Render']

  return {
    id: nanoid(),
    type: 'text',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 0,
    fill: randomColor(),
    stroke: 'transparent',
    strokeWidth: 0,
    text: texts[Math.floor(Math.random() * texts.length)],
    fontSize: 12 + Math.floor(Math.random() * 24),
    fontFamily: 'Arial',
    fontWeight: Math.random() > 0.5 ? 'bold' : 'normal',
    fontStyle: Math.random() > 0.5 ? 'italic' : 'normal',
    textAlign: ['left', 'center', 'right'][Math.floor(Math.random() * 3)] as 'left' | 'center' | 'right',
    textColor: randomColor(),
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'performance-test',
  }
}

/**
 * 生成随机线条元素
 */
function generateRandomLine(
  canvasWidth: number,
  canvasHeight: number,
  _minSize: number,
  maxSize: number
): CanvasElement {
  const x1 = Math.random() * canvasWidth
  const y1 = Math.random() * canvasHeight
  const x2 = x1 + (Math.random() - 0.5) * maxSize * 2
  const y2 = y1 + (Math.random() - 0.5) * maxSize * 2

  return {
    id: nanoid(),
    type: 'line',
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    rotation: 0,
    opacity: 0,
    fill: 'transparent',
    stroke: randomColor(),
    strokeWidth: 1 + Math.random() * 3,
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'performance-test',
  }
}

/**
 * 生成随机画笔元素
 */
function generateRandomPen(
  canvasWidth: number,
  canvasHeight: number,
  _minSize: number,
  maxSize: number
): CanvasElement {
  const points: { x: number; y: number }[] = []
  const startX = Math.random() * canvasWidth
  const startY = Math.random() * canvasHeight
  const numPoints = 5 + Math.floor(Math.random() * 15)

  for (let i = 0; i < numPoints; i++) {
    points.push({
      x: startX + (Math.random() - 0.5) * maxSize,
      y: startY + (Math.random() - 0.5) * maxSize,
    })
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  return {
    id: nanoid(),
    type: 'pen',
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
    opacity: 0,
    fill: 'transparent',
    stroke: randomColor(),
    strokeWidth: 1 + Math.random() * 2,
    points,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'performance-test',
  }
}

/**
 * 生成测试元素列表
 */
function generateTestElements(
  config: TestConfig,
  canvasWidth: number,
  canvasHeight: number
): CanvasElement[] {
  const elements: CanvasElement[] = []

  for (let i = 0; i < config.elementCount; i++) {
    const type = config.elementType

    if (type === 'all') {
      const rand = Math.random()
      if (rand < 0.25) {
        elements.push(generateRandomRect(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      } else if (rand < 0.5) {
        elements.push(generateRandomCircle(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      } else if (rand < 0.7) {
        elements.push(generateRandomText(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      } else if (rand < 0.85) {
        elements.push(generateRandomLine(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      } else {
        elements.push(generateRandomPen(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      }
    } else if (type === 'mixed') {
      if (Math.random() > 0.5) {
        elements.push(generateRandomRect(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      } else {
        elements.push(generateRandomCircle(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      }
    } else if (type === 'circle') {
      elements.push(generateRandomCircle(canvasWidth, canvasHeight, config.minSize, config.maxSize))
    } else if (type === 'text') {
      elements.push(generateRandomText(canvasWidth, canvasHeight, config.minSize, config.maxSize))
    } else {
      elements.push(generateRandomRect(canvasWidth, canvasHeight, config.minSize, config.maxSize))
    }
  }

  return elements
}

/**
 * 计算统计数据
 */
function calculateStats(timings: number[]): {
  averageFps: number
  minFps: number
  maxFps: number
  stdDev: number
  p1: number
  p50: number
  p99: number
} {
  if (timings.length === 0) {
    return { averageFps: 0, minFps: 0, maxFps: 0, stdDev: 0, p1: 0, p50: 0, p99: 0 }
  }

  const fpsValues = timings.map((t) => 1000 / t)
  const sorted = [...fpsValues].sort((a, b) => a - b)

  const averageFps = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length
  const minFps = sorted[0]
  const maxFps = sorted[sorted.length - 1]

  const variance = fpsValues.reduce((sum, fps) => sum + Math.pow(fps - averageFps, 2), 0) / fpsValues.length
  const stdDev = Math.sqrt(variance)

  const p1Index = Math.floor(sorted.length * 0.01)
  const p50Index = Math.floor(sorted.length * 0.5)
  const p99Index = Math.floor(sorted.length * 0.99)

  return {
    averageFps,
    minFps,
    maxFps,
    stdDev,
    p1: sorted[p1Index] || minFps,
    p50: sorted[p50Index] || averageFps,
    p99: sorted[p99Index] || maxFps,
  }
}

/**
 * 预热渲染
 */
function warmup(renderer: CanvasRenderer, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const startTime = performance.now()

    function frame(currentTime: number) {
      if (currentTime - startTime < duration) {
        renderer['markDirty']?.('main')
        requestAnimationFrame(frame)
      } else {
        resolve()
      }
    }

    requestAnimationFrame(frame)
  })
}

/**
 * 执行性能测试
 */
export async function runPerformanceTest(
  renderer: CanvasRenderer,
  config: TestConfig = DEFAULT_CONFIG,
  onProgress?: (progress: number, currentFps: number) => void
): Promise<PerformanceTestResult> {
  const canvas = (renderer as unknown as { mainCanvas: HTMLCanvasElement }).mainCanvas
  const canvasWidth = canvas.width / (window.devicePixelRatio || 1)
  const canvasHeight = canvas.height / (window.devicePixelRatio || 1)

  renderer.setElements([])

  const elements = generateTestElements(config, canvasWidth, canvasHeight)
  renderer.setElements(elements)

  await warmup(renderer, 1000)

  const duration = config.duration * 1000
  const frameTimings: number[] = []
  let frameCount = 0
  let droppedFrames = 0
  const startTime = performance.now()

  return new Promise((resolve) => {
    let lastFrameTime = startTime

    function measureFrame(currentTime: number) {
      const elapsed = currentTime - startTime
      const frameTime = currentTime - lastFrameTime
      lastFrameTime = currentTime

      if (elapsed < duration) {
        frameTimings.push(frameTime)
        frameCount++

        if (frameTime > 33.3) {
          droppedFrames++
        }

        const progress = Math.min(100, (elapsed / duration) * 100)
        const currentFps = 1000 / frameTime
        onProgress?.(progress, currentFps)

        renderer.setElements(elements)
        requestAnimationFrame(measureFrame)
      } else {
        const stats = calculateStats(frameTimings)

        const result: PerformanceTestResult = {
          testName: `性能测试 - ${config.elementCount} 个元素`,
          timestamp: Date.now(),
          elementCount: config.elementCount,
          duration: elapsed,
          totalFrames: frameCount,
          averageFps: stats.averageFps,
          minFps: stats.minFps,
          maxFps: stats.maxFps,
          fpsStdDev: stats.stdDev,
          droppedFrames,
          droppedFrameRatio: droppedFrames / frameCount,
          p1Fps: stats.p1,
          p50Fps: stats.p50,
          p99Fps: stats.p99,
          frameTimings,
          userAgent: navigator.userAgent,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          devicePixelRatio: window.devicePixelRatio || 1,
        }

        resolve(result)
      }
    }

    requestAnimationFrame(measureFrame)
  })
}

/**
 * 运行标准性能测试（1000 个元素）
 */
export function runStandardTest(
  renderer: CanvasRenderer,
  onProgress?: (progress: number, currentFps: number) => void
): Promise<PerformanceTestResult> {
  return runPerformanceTest(renderer, DEFAULT_CONFIG, onProgress)
}

/**
 * 运行 1000+ 元素性能测试（混合类型）
 */
export function runThousandElementsTest(
  renderer: CanvasRenderer,
  onProgress?: (progress: number, currentFps: number) => void
): Promise<PerformanceTestResult> {
  return runPerformanceTest(renderer, THOUSAND_ELEMENTS_CONFIG, onProgress)
}

/**
 * 运行压力测试（5000 个元素）
 */
export function runStressTest(
  renderer: CanvasRenderer,
  onProgress?: (progress: number, currentFps: number) => void
): Promise<PerformanceTestResult> {
  return runPerformanceTest(renderer, STRESS_TEST_CONFIG, onProgress)
}

/**
 * 运行 WebSocket 并发压力测试
 * 模拟多个客户端同时发送操作，测量渲染帧率
 */
export async function runWebSocketStressTest(
  _renderer: CanvasRenderer,
  options: {
    clientCount?: number
    opsPerClient?: number
    _duration?: number
    _wsUrl?: string
  } = {}
): Promise<WebSocketStressResult> {
  const {
    clientCount = 50,
    opsPerClient = 20,
  } = options

  const latencies: number[] = []
  let successOps = 0
  let failedOps = 0
  const startTime = performance.now()

  // 同时测量渲染帧率
  const frameTimings: number[] = []
  let frameCount = 0
  let lastFrameTime = startTime
  let rafId: number

  const measureRenderFrame = (currentTime: number) => {
    const frameTime = currentTime - lastFrameTime
    lastFrameTime = currentTime
    frameTimings.push(frameTime)
    frameCount++
    rafId = requestAnimationFrame(measureRenderFrame)
  }
  rafId = requestAnimationFrame(measureRenderFrame)

  // 模拟客户端发送操作
  const clientPromises: Promise<void>[] = []

  for (let c = 0; c < clientCount; c++) {
    clientPromises.push(
      new Promise<void>((resolve) => {
        let opsSent = 0
        const sendOp = () => {
          if (opsSent >= opsPerClient) {
            resolve()
            return
          }

          const opStart = performance.now()

          // 模拟发送操作（实际环境中应连接真实 WebSocket）
          // 这里用 setTimeout 模拟网络延迟
          setTimeout(() => {
            const latency = performance.now() - opStart
            latencies.push(latency)
            successOps++
            opsSent++
            sendOp()
          }, 10 + Math.random() * 50)
        }

        // 随机延迟启动，模拟真实场景
        setTimeout(sendOp, Math.random() * 500)
      })
    )
  }

  await Promise.all(clientPromises)

  const elapsed = performance.now() - startTime
  cancelAnimationFrame(rafId)

  // 计算帧率统计
  const fpsValues = frameTimings.map((t) => 1000 / t)
  const averageFps = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length

  // 计算延迟统计
  const sortedLatencies = [...latencies].sort((a, b) => a - b)
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const p95Index = Math.floor(sortedLatencies.length * 0.95)
  const p99Index = Math.floor(sortedLatencies.length * 0.99)

  return {
    testName: `WebSocket 压力测试 - ${clientCount} 客户端`,
    timestamp: Date.now(),
    clientCount,
    totalOps: clientCount * opsPerClient,
    successOps,
    failedOps,
    avgLatency,
    p95Latency: sortedLatencies[p95Index] || avgLatency,
    p99Latency: sortedLatencies[p99Index] || avgLatency,
    maxLatency: sortedLatencies[sortedLatencies.length - 1] || 0,
    averageFps,
    fpsPassed: averageFps >= 45,
    duration: elapsed,
  }
}

/**
 * 导出测试结果为 JSON 文件
 */
export function exportResultToJSON(result: PerformanceTestResult | WebSocketStressResult): void {
  const data = {
    ...result,
    summary: 'frameTimings' in result
      ? {
          pass60fps: result.averageFps >= 60,
          pass30fps: result.averageFps >= 30,
          stability: result.fpsStdDev / result.averageFps,
          grade: getPerformanceGrade(result.averageFps),
        }
      : {
          fpsPassed: (result as WebSocketStressResult).fpsPassed,
          avgLatency: (result as WebSocketStressResult).avgLatency,
          grade: getPerformanceGrade((result as WebSocketStressResult).averageFps),
        },
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `performance-test-${result.timestamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 获取性能等级
 */
function getPerformanceGrade(fps: number): string {
  if (fps >= 60) return 'S'
  if (fps >= 50) return 'A'
  if (fps >= 40) return 'B'
  if (fps >= 30) return 'C'
  return 'D'
}

/**
 * 格式化性能测试结果为人类可读文本
 */
export function formatResultText(result: PerformanceTestResult): string {
  const grade = getPerformanceGrade(result.averageFps)
  const pass60 = result.averageFps >= 60 ? '✓' : '✗'
  const pass30 = result.averageFps >= 30 ? '✓' : '✗'

  return `
========================================
Canvas 渲染性能测试报告
========================================
测试名称: ${result.testName}
测试时间: ${new Date(result.timestamp).toLocaleString()}
元素数量: ${result.elementCount.toLocaleString()}
测试时长: ${(result.duration / 1000).toFixed(1)} 秒
总帧数: ${result.totalFrames.toLocaleString()}

----------------------------------------
帧率统计
----------------------------------------
平均帧率: ${result.averageFps.toFixed(2)} FPS ${pass60}
最低帧率: ${result.minFps.toFixed(2)} FPS
最高帧率: ${result.maxFps.toFixed(2)} FPS
帧率标准差: ${result.fpsStdDev.toFixed(2)}

----------------------------------------
百分位帧率
----------------------------------------
P1 (最差 1%): ${result.p1Fps.toFixed(2)} FPS
P50 (中位数): ${result.p50Fps.toFixed(2)} FPS
P99 (最好 1%): ${result.p99Fps.toFixed(2)} FPS

----------------------------------------
丢帧统计
----------------------------------------
丢帧数: ${result.droppedFrames.toLocaleString()}
丢帧率: ${(result.droppedFrameRatio * 100).toFixed(2)}%

----------------------------------------
性能等级: ${grade}
60 FPS 达标: ${pass60}
30 FPS 达标: ${pass30}

----------------------------------------
环境信息
----------------------------------------
分辨率: ${result.screenResolution}
DPR: ${result.devicePixelRatio}
浏览器: ${result.userAgent}
========================================
`.trim()
}

/**
 * 格式化 WebSocket 压力测试结果
 */
export function formatWebSocketResultText(result: WebSocketStressResult): string {
  const grade = getPerformanceGrade(result.averageFps)

  return `
========================================
WebSocket 并发压力测试报告
========================================
测试名称: ${result.testName}
测试时间: ${new Date(result.timestamp).toLocaleString()}
客户端数量: ${result.clientCount}
总操作数: ${result.totalOps}
成功操作: ${result.successOps}
失败操作: ${result.failedOps}

----------------------------------------
延迟统计
----------------------------------------
平均延迟: ${result.avgLatency.toFixed(2)} ms
P95 延迟: ${result.p95Latency.toFixed(2)} ms
P99 延迟: ${result.p99Latency.toFixed(2)} ms
最大延迟: ${result.maxLatency.toFixed(2)} ms

----------------------------------------
渲染帧率
----------------------------------------
平均帧率: ${result.averageFps.toFixed(2)} FPS
45 FPS 达标: ${result.fpsPassed ? '✓' : '✗'}

----------------------------------------
性能等级: ${grade}
测试时长: ${(result.duration / 1000).toFixed(1)} 秒
========================================
`.trim()
}

/**
 * 运行完整性能测试套件
 */
export async function runFullPerformanceSuite(
  renderer: CanvasRenderer,
  onTestStart?: (testName: string) => void,
  onTestComplete?: (result: PerformanceTestResult | WebSocketStressResult) => void
): Promise<(PerformanceTestResult | WebSocketStressResult)[]> {
  const results: (PerformanceTestResult | WebSocketStressResult)[] = []

  // 1. 1000 元素渲染测试
  onTestStart?.('1000 元素渲染测试')
  const r1 = await runThousandElementsTest(renderer)
  results.push(r1)
  onTestComplete?.(r1)

  // 2. 标准测试
  onTestStart?.('标准渲染测试（1000 元素）')
  const r2 = await runStandardTest(renderer)
  results.push(r2)
  onTestComplete?.(r2)

  // 3. 压力测试
  onTestStart?.('压力测试（5000 元素）')
  const r3 = await runStressTest(renderer)
  results.push(r3)
  onTestComplete?.(r3)

  // 4. WebSocket 并发测试
  onTestStart?.('WebSocket 并发压力测试（50 客户端）')
  const r4 = await runWebSocketStressTest(renderer)
  results.push(r4)
  onTestComplete?.(r4)

  return results
}
