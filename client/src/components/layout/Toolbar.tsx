/**
 * 左侧工具栏组件 (Toolbar)
 *
 * 设计：64px 宽，浅灰背景 (#F5F5F5)，垂直堆叠工具按钮。
 * - 工具按钮 44×44，垂直居中对齐
 * - 按钮之间有 4px 间距
 * - 中间用细分隔线区隔"工具"与"动作"
 *
 * 关键设计决策：
 * - 工具配置集中在文件顶部 TOOLS 数组，新增工具只改一处
 * - 图标全部用 SVG（细线风格），与 Figma 工具栏视觉一致
 * - 切换工具前的回调（onBeforeChange）用于自动保存正在编辑的文本
 *
 * 注意：
 * - 此组件不直接操作 canvasStore.setTool，
 *   而是通过 onToolChange(type) 把意图交给 WhiteboardPage，
 *   由 WhiteboardPage 负责 setTool + cleanupTextEditor 等副作用。
 *   这样 Toolbar 保持纯展示组件，副作用在 Page 层统一编排。
 */

import { ReactNode } from 'react'
import ToolButton from '@/components/ui/ToolButton'
import { ToolType } from '@/canvas/CanvasElement'

export interface ToolbarProps {
  /** 当前激活的工具 */
  activeTool: ToolType
  /** 工具切换回调（被点击的工具 type，调用方决定如何 setTool） */
  onToolChange: (tool: ToolType) => void
  /** 清空画布回调 */
  onClearCanvas?: () => void
  /** 导入图片回调（点击图片工具时调用，调用方打开文件选择器） */
  onImportImage?: () => void
}

/** 工具配置（图标用 SVG 节点，便于在 selected 态下通过父级 text color 自动着色） */
interface ToolConfig {
  type: ToolType
  label: string
  shortcut: string
  /** 24×24 viewBox 的 SVG 节点 */
  icon: ReactNode
}

const STROKE_ATTRS = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const TOOLS: ToolConfig[] = [
  {
    type: 'select',
    label: '选择',
    shortcut: 'V',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <path d="M5 3l5 16 2.5-7L19 9 5 3z" />
      </svg>
    ),
  },
  {
    type: 'pen',
    label: '画笔',
    shortcut: 'P',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <path d="M3 21c4-2 7-7 11-12" />
        <path d="M14 9l4-4 2 2-4 4" />
        <path d="M14 9l-3 3" />
        <circle cx="6" cy="18" r="1.2" />
      </svg>
    ),
  },
  {
    type: 'line',
    label: '直线',
    shortcut: 'L',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <line x1="4" y1="20" x2="20" y2="4" />
      </svg>
    ),
  },
  {
    type: 'rect',
    label: '矩形',
    shortcut: 'R',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <rect x="4" y="6" width="16" height="12" rx="1" />
      </svg>
    ),
  },
  {
    type: 'circle',
    label: '圆形',
    shortcut: 'O',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  {
    type: 'text',
    label: '文本',
    shortcut: 'T',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <line x1="6" y1="5" x2="18" y2="5" />
        <line x1="12" y1="5" x2="12" y2="19" />
      </svg>
    ),
  },
  {
    type: 'image',
    label: '图片',
    shortcut: 'I',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <rect x="3" y="5" width="18" height="14" rx="1.5" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M21 17l-5-5-9 7" />
      </svg>
    ),
  },
  {
    type: 'eraser',
    label: '橡皮擦',
    shortcut: 'E',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
        <path d="M16 4l4 4-9 9H7l-3-3 9-10z" />
        <path d="M9 13l3 3" />
        <line x1="3" y1="20" x2="17" y2="20" />
      </svg>
    ),
  },
]

/** 一根细分隔线 */
function Divider() {
  return <div className="w-7 h-px bg-[#DCDCDC] my-1.5" />
}

export default function Toolbar({ activeTool, onToolChange, onClearCanvas, onImportImage }: ToolbarProps) {
  return (
    <aside
      className="w-16 bg-[#F5F5F5] border-r border-[#E5E5E5] flex flex-col items-center py-2 shrink-0 select-none"
      role="toolbar"
      aria-label="绘图工具"
    >
      {/* 工具组 */}
      <div className="flex flex-col gap-1">
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.type}
            selected={activeTool === tool.type}
            onClick={() => {
              if (tool.type === activeTool) return
              if (tool.type === 'image') {
                // 图片工具：立即打开文件选择器；选择完成后由 useImageUpload
                // 在 addImageElement 之后切回 select 工具（避免重复 openFilePicker
                // 导致的"选完图又弹一次"问题）
                onImportImage?.()
                onToolChange(tool.type)
                return
              }
              onToolChange(tool.type)
            }}
            title={tool.label}
            shortcut={tool.shortcut}
          >
            {tool.icon}
          </ToolButton>
        ))}
      </div>

      <Divider />

      {/* 动作组：清空画布 */}
      {onClearCanvas && (
        <ToolButton
          onClick={onClearCanvas}
          title="清空画布"
          className="!text-[#B0B0B0] hover:!text-[#5F5F5F]"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_ATTRS}>
            <polyline points="4 7 4 5 20 5 20 7" />
            <path d="M9 5V3h6v2" />
            <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
            <line x1="10" y1="11" x2="10" y2="18" />
            <line x1="14" y1="11" x2="14" y2="18" />
          </svg>
        </ToolButton>
      )}

      {/* 底部 spacer，把内容推到顶部 */}
      <div className="flex-1" />
    </aside>
  )
}
