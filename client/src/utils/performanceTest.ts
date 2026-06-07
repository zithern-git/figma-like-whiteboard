/**
 * Canvas 渲染性能自动化测试工具 🔥
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

/** 测试配置 */
export interface TestConfig {
  /** 元素数量 */
  elementCount: number
  /** 测试时长（秒） */
  duration: number
  /** 元素类型 */
  elementType: 'rect' | 'circle' | 'mixed'
  /** 元素最小尺寸 */
  minSize: number
  /** 元素最大尺寸 */
  maxSize: number
}

/** 默认测试配置 */
const DEFAULT_CONFIG: TestConfig = {
  elementCount: 1000,
  duration: 10,
  elementType: 'rect',
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
 * 生成测试元素列表
 */
function generateTestElements(
  config: TestConfig,
  canvasWidth: number,
  canvasHeight: number
): CanvasElement[] {
  const elements: CanvasElement[] = []

  for (let i = 0; i < config.elementCount; i++) {
    if (config.elementType === 'mixed') {
      // 混合类型：50% 矩形 + 50% 圆形
      if (Math.random() > 0.5) {
        elements.push(generateRandomRect(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      } else {
        elements.push(generateRandomCircle(canvasWidth, canvasHeight, config.minSize, config.maxSize))
      }
    } else if (config.elementType === 'circle') {
      elements.push(generateRandomCircle(canvasWidth, canvasHeight, config.minSize, config.maxSize))
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

  // 将耗时转换为帧率
  const fpsValues = timings.map((t) => 1000 / t)

  // 排序用于计算百分位
  const sorted = [...fpsValues].sort((a, b) => a - b)

  const averageFps = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length
  const minFps = sorted[0]
  const maxFps = sorted[sorted.length - 1]

  // 标准差
  const variance = fpsValues.reduce((sum, fps) => sum + Math.pow(fps - averageFps, 2), 0) / fpsValues.length
  const stdDev = Math.sqrt(variance)

  // 百分位
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
 * 执行性能测试 🔥
 *
 * @param renderer - Canvas 渲染器实例
 * @param config - 测试配置
 * @param onProgress - 进度回调（0-100）
 * @returns 测试结果
 */
export async function runPerformanceTest(
  renderer: CanvasRenderer,
  config: TestConfig = DEFAULT_CONFIG,
  onProgress?: (progress: number, currentFps: number) => void
): Promise<PerformanceTestResult> {
  const canvas = renderer['mainCanvas'] as HTMLCanvasElement
  const canvasWidth = canvas.width / (window.devicePixelRatio || 1)
  const canvasHeight = canvas.height / (window.devicePixelRatio || 1)

  // 1. 清空画布
  renderer.setElements([])

  // 2. 生成测试元素
  const elements = generateTestElements(config, canvasWidth, canvasHeight)
  renderer.setElements(elements)

  // 3. 预热渲染（1秒）
  await warmup(renderer, 1000)

  // 4. 正式测试
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
        // 记录帧数据
        frameTimings.push(frameTime)
        frameCount++

        // 检测丢帧（低于 30fps = 33.3ms）
        if (frameTime > 33.3) {
          droppedFrames++
        }

        // 触发进度回调
        const progress = Math.min(100, (elapsed / duration) * 100)
        const currentFps = 1000 / frameTime
        onProgress?.(progress, currentFps)

        // 强制重绘以产生负载
        renderer['mainDirtyManager'].markFullRedraw()
        renderer.scheduleRender('main')

        requestAnimationFrame(measureFrame)
      } else {
        // 测试结束，计算结果
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
 * 预热渲染
 *
 * 在正式测试前进行短暂渲染，使浏览器进入稳定状态。
 */
function warmup(renderer: CanvasRenderer, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const startTime = performance.now()

    function frame(currentTime: number) {
      if (currentTime - startTime < duration) {
        renderer['mainDirtyManager'].markFullRedraw()
        renderer.scheduleRender('main')
        requestAnimationFrame(frame)
      } else {
        resolve()
      }
    }

    requestAnimationFrame(frame)
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
 * 运行压力测试（5000 个元素）
 */
export function runStressTest(
  renderer: CanvasRenderer,
  onProgress?: (progress: number, currentFps: number) => void
): Promise<PerformanceTestResult> {
  return runPerformanceTest(renderer, STRESS_TEST_CONFIG, onProgress)
}

/**
 * 导出测试结果为 JSON 文件
 *
 * @param result - 测试结果
 */
export function exportResultToJSON(result: PerformanceTestResult): void {
  const data = {
    ...result,
    // 不导出原始帧数据（文件太大）
    frameTimings: undefined,
    // 添加汇总统计
    summary: {
      pass60fps: result.averageFps >= 60,
      pass30fps: result.averageFps >= 30,
      stability: result.fpsStdDev / result.averageFps, // 变异系数
      grade: getPerformanceGrade(result.averageFps),
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
 *
 * @param fps - 平均帧率
 * @returns 等级（S/A/B/C/D）
 */
function getPerformanceGrade(fps: number): string {
  if (fps >= 60) return 'S'
  if (fps >= 50) return 'A'
  if (fps >= 40) return 'B'
  if (fps >= 30) return 'C'
  return 'D'
}

/**
 * 格式化测试结果为人类可读文本
 *
 * @param result - 测试结果
 * @returns 格式化后的文本
 */
export function formatResultText(result: PerformanceTestResult): string {
  const grade = getPerformanceGrade(result.averageFps)
  const pass60 = result.averageFps >= 60 ? '✅' : '❌'
  const pass30 = result.averageFps >= 30 ? '✅' : '❌'

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