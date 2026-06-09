/**
 * 左侧工具栏组件
 *
 * 提供绘图工具切换、性能测试入口和常用操作按钮。
 * 工具栏采用垂直布局，图标 + 文字标签的形式。
 */

import { useState } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { ToolType } from '@/canvas/CanvasElement'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'
import {
  runStandardTest,
  runStressTest,
  exportResultToJSON,
  formatResultText,
  PerformanceTestResult,
} from '@/utils/performanceTest'

interface ToolbarProps {
  renderer?: CanvasRenderer | null
}

/** 工具配置 */
const TOOLS: { type: ToolType; label: string; icon: string; shortcut: string }[] = [
  { type: 'select', label: '选择', icon: '↖', shortcut: 'V' },
  { type: 'pen', label: '画笔', icon: '✎', shortcut: 'P' },
  { type: 'line', label: '直线', icon: '/', shortcut: 'L' },
  { type: 'rect', label: '矩形', icon: '□', shortcut: 'R' },
  { type: 'circle', label: '圆形', icon: '○', shortcut: 'O' },
  { type: 'text', label: '文本', icon: 'T', shortcut: 'T' },
  { type: 'eraser', label: '橡皮擦', icon: '⌫', shortcut: 'E' },
]

export default function Toolbar({ renderer }: ToolbarProps) {
  const activeTool = useCanvasStore((s) => s.activeTool)
  const setTool = useCanvasStore((s) => s.setTool)

  // 性能测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testProgress, setTestProgress] = useState(0)
  const [currentFps, setCurrentFps] = useState(0)
  const [testResult, setTestResult] = useState<PerformanceTestResult | null>(null)
  const [showResult, setShowResult] = useState(false)

  /** 切换工具 */
  const handleToolClick = (tool: ToolType) => {
    setTool(tool)
  }

  /** 运行标准性能测试（1000 个元素） */
  const handleStandardTest = async () => {
    if (!renderer || isTesting) return
    setIsTesting(true)
    setTestProgress(0)
    setCurrentFps(0)
    setTestResult(null)
    setShowResult(false)

    try {
      const result = await runStandardTest(renderer, (progress, fps) => {
        setTestProgress(progress)
        setCurrentFps(fps)
      })
      setTestResult(result)
      setShowResult(true)
    } catch {
      alert('性能测试失败')
    } finally {
      setIsTesting(false)
    }
  }

  /** 运行压力测试（5000 个元素） */
  const handleStressTest = async () => {
    if (!renderer || isTesting) return
    setIsTesting(true)
    setTestProgress(0)
    setCurrentFps(0)
    setTestResult(null)
    setShowResult(false)

    try {
      const result = await runStressTest(renderer, (progress, fps) => {
        setTestProgress(progress)
        setCurrentFps(fps)
      })
      setTestResult(result)
      setShowResult(true)
    } catch {
      alert('压力测试失败')
    } finally {
      setIsTesting(false)
    }
  }

  /** 导出测试结果 */
  const handleExportResult = () => {
    if (testResult) {
      exportResultToJSON(testResult)
    }
  }

  /** 清空画布 */
  const handleClear = () => {
    if (confirm('确定要清空画布吗？此操作不可撤销。')) {
      useCanvasStore.getState().clearAllElements()
    }
  }

  return (
    <>
      <div className="w-14 bg-white border-r border-gray-200 flex flex-col items-center py-2 shrink-0 select-none">
        {/* 工具按钮 */}
        <div className="flex flex-col gap-1">
          {TOOLS.map((tool) => (
            <button
              key={tool.type}
              onClick={() => handleToolClick(tool.type)}
              className={`w-10 h-10 flex flex-col items-center justify-center rounded text-xs transition-colors ${
                activeTool === tool.type
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={`${tool.label} (${tool.shortcut})`}
            >
              <span className="text-sm">{tool.icon}</span>
              <span className="text-[10px] scale-75">{tool.label}</span>
            </button>
          ))}
        </div>

        <div className="w-8 h-px bg-gray-200 my-2" />

        {/* 性能测试按钮 */}
        <div className="flex flex-col gap-1">
          <button
            onClick={handleStandardTest}
            disabled={isTesting}
            className={`w-10 h-10 flex flex-col items-center justify-center rounded text-xs transition-colors ${
              isTesting
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-orange-600 hover:bg-orange-50'
            }`}
            title="性能测试 (1000 个元素)"
          >
            <span className="text-sm">⚡</span>
            <span className="text-[10px] scale-75">测试</span>
          </button>

          <button
            onClick={handleStressTest}
            disabled={isTesting}
            className={`w-10 h-10 flex flex-col items-center justify-center rounded text-xs transition-colors ${
              isTesting
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-red-600 hover:bg-red-50'
            }`}
            title="压力测试 (5000 个元素)"
          >
            <span className="text-sm">🔥</span>
            <span className="text-[10px] scale-75">压力</span>
          </button>
        </div>

        <div className="w-8 h-px bg-gray-200 my-2" />

        {/* 清空画布 */}
        <button
          onClick={handleClear}
          className="w-10 h-10 flex flex-col items-center justify-center rounded text-xs text-gray-600 hover:bg-gray-100 transition-colors"
          title="清空画布"
        >
          <span className="text-sm">🗑</span>
          <span className="text-[10px] scale-75">清空</span>
        </button>
      </div>

      {/* 性能测试进度条 */}
      {isTesting && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg z-50 min-w-[200px]">
          <div className="text-sm font-medium mb-2">
            {testProgress < 100 ? '性能测试中...' : '测试完成'}
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2 mb-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-100"
              style={{ width: `${testProgress}%` }}
            />
          </div>
          <div className="text-xs text-gray-300 flex justify-between">
            <span>进度: {testProgress.toFixed(1)}%</span>
            <span>当前 FPS: {currentFps.toFixed(1)}</span>
          </div>
        </div>
      )}

      {/* 测试结果对话框 */}
      {showResult && testResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">性能测试结果</h2>
              <button
                onClick={() => setShowResult(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* 核心指标 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {testResult.averageFps.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-500">平均 FPS</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {testResult.maxFps.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-500">最高 FPS</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {testResult.minFps.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-500">最低 FPS</div>
                </div>
              </div>

              {/* 详细数据 */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">元素数量:</span>
                  <span className="font-medium">{testResult.elementCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">测试时长:</span>
                  <span className="font-medium">{(testResult.duration / 1000).toFixed(1)} 秒</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">总帧数:</span>
                  <span className="font-medium">{testResult.totalFrames.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">帧率标准差:</span>
                  <span className="font-medium">{testResult.fpsStdDev.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">丢帧率:</span>
                  <span className="font-medium">{(testResult.droppedFrameRatio * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">P50 (中位数):</span>
                  <span className="font-medium">{testResult.p50Fps.toFixed(1)} FPS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">P99:</span>
                  <span className="font-medium">{testResult.p99Fps.toFixed(1)} FPS</span>
                </div>
              </div>

              {/* 达标状态 */}
              <div className="flex gap-2">
                <div
                  className={`flex-1 text-center py-2 rounded text-sm font-medium ${
                    testResult.averageFps >= 60
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  60 FPS {testResult.averageFps >= 60 ? '✅ 达标' : '❌ 未达标'}
                </div>
                <div
                  className={`flex-1 text-center py-2 rounded text-sm font-medium ${
                    testResult.averageFps >= 30
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  30 FPS {testResult.averageFps >= 30 ? '✅ 达标' : '❌ 未达标'}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={handleExportResult}
                className="flex-1 bg-blue-600 text-white py-2 rounded text-sm hover:bg-blue-700 transition-colors"
              >
                导出 JSON
              </button>
              <button
                onClick={() => {
                  const text = formatResultText(testResult)
                  navigator.clipboard.writeText(text)
                  alert('结果已复制到剪贴板')
                }}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded text-sm hover:bg-gray-200 transition-colors"
              >
                复制文本
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
