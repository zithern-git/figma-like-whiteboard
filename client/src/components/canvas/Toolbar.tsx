/**
 * 左侧工具栏组件
 *
 * 提供绘图工具切换和常用操作按钮。
 * 工具栏采用垂直布局，图标 + 文字标签的形式。
 *
 * 当内容超过可视高度时自动出现垂直滚动条；未超出时不可滚动。
 */

import { useCanvasStore } from '@/stores/canvasStore'
import { ToolType } from '@/canvas/CanvasElement'

interface ToolbarProps {
  onToolChange?: () => void
}

/** 工具配置 */
const TOOLS: { type: ToolType; label: string; icon: string; shortcut: string }[] = [
  { type: 'select', label: '选择', icon: '↖', shortcut: 'V' },
  { type: 'pen', label: '画笔', icon: '✎', shortcut: 'P' },
  { type: 'line', label: '直线', icon: '/', shortcut: 'L' },
  { type: 'rect', label: '矩形', icon: '□', shortcut: 'R' },
  { type: 'circle', label: '圆形', icon: '○', shortcut: 'O' },
  { type: 'text', label: '文本', icon: 'T', shortcut: 'T' },
  { type: 'image', label: '图片', icon: '🖼', shortcut: 'I' },
  { type: 'eraser', label: '橡皮擦', icon: '⌫', shortcut: 'E' },
]

export default function Toolbar({ onToolChange }: ToolbarProps) {
  const activeTool = useCanvasStore((s) => s.activeTool)
  const setTool = useCanvasStore((s) => s.setTool)

  /** 切换工具 */
  const handleToolClick = (tool: ToolType) => {
    if (tool !== activeTool) {
      // 切换工具前，如果外部提供了回调（用于自动保存正在编辑的文本），先调用
      onToolChange?.()
      setTool(tool)
    }
  }

  /** 清空画布 */
  const handleClear = () => {
    if (confirm('确定要清空画布吗？此操作不可撤销。')) {
      useCanvasStore.getState().clearAllElements()
    }
  }

  return (
    <div className="w-14 bg-white border-r border-gray-200 flex flex-col items-center py-2 shrink-0 select-none overflow-y-auto min-h-0">
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
  )
}
