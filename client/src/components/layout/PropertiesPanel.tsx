/**
 * 右侧属性面板组件 (PropertiesPanel)
 *
 * 设计：280px 宽，白色背景，固定在视口右侧，可折叠。
 * - 折叠态：仅 32px 宽的图标列
 * - 展开态：280px 宽，分节展示属性
 *
 * 关键设计决策：
 * - 折叠态由父组件控制（受控组件），用 localStorage 记忆用户偏好
 * - 内容按"变换 / 外观 / 类型特化"三段分组，与 Figma 右侧面板节奏一致
 * - 锁比例按钮：开启后 W/H 同比例缩放，避免输入一项破坏比例
 * - 文字 / 矩形 / 图片 的特化属性挂在最后，不破坏主流程
 *
 * 视觉细节：
 * - 顶部 header：标题 + 折叠按钮（pin/eye 风格）
 * - 中部：section 标题用 11px 大写小字 + 浅灰，符合设计师工具审美
 * - 输入框：36px 高，左对齐数字，hover/focus 有蓝色 ring
 * - 颜色 picker：24px 方形 swatch + 文本输入
 * - 滑块：12px 高 track + 12px 圆形 thumb，hover 放大
 */

import { ReactNode, useEffect, useState, useCallback, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { CanvasElement } from '@/canvas/CanvasElement'

// ============================================================
// Props
// ============================================================

export interface PropertiesPanelProps {
  /** 是否展开（受控） */
  expanded: boolean
  /** 切换展开态的回调 */
  onToggle: () => void
}

// ============================================================
// 常量
// ============================================================

const PANEL_WIDTH_EXPANDED = 280
const PANEL_WIDTH_COLLAPSED = 40

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

// ============================================================
// 工具小组件
// ============================================================

/** 数值输入框（带单位后缀和 ± 按钮） */
function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string>(String(Math.round(value)))
  useEffect(() => {
    setDraft(String(Math.round(value)))
  }, [value])

  return (
    <div
      className={[
        'h-7 flex items-center bg-white border border-[#E0E0E0] rounded-md',
        'focus-within:border-[#0D99FF] focus-within:ring-1 focus-within:ring-[#0D99FF]/30',
        'transition-colors',
        disabled ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft)
          if (Number.isFinite(v)) {
            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v))
            onChange(clamped)
          } else {
            setDraft(String(Math.round(value)))
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(String(Math.round(value)))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="w-full h-full px-2 text-[11px] text-[#1A1A1A] tabular-nums bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="pr-2 text-[10px] text-[#9E9E9E] select-none">{suffix}</span>}
    </div>
  )
}

/** 带前缀标签的输入行：X / Y / W / H */
function LabeledNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 text-[10px] font-medium text-[#9E9E9E] uppercase tracking-wide">{label}</span>
      <div className="flex-1">
        <NumberField
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          suffix={suffix}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

/** 颜色输入（swatch + hex 文本） */
function ColorField({ value, onChange, allowTransparent = false }: {
  value: string
  onChange: (v: string) => void
  allowTransparent?: boolean
}) {
  // 处理"transparent"：picker 不接受透明，用 hidden 标志位标记
  const isTransparent = value === 'transparent' || value === ''
  const pickerValue = isTransparent ? '#000000' : value
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative w-7 h-7 rounded-md border border-[#E0E0E0] overflow-hidden shrink-0 group cursor-pointer">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="选择颜色"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isTransparent
              ? 'linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%) 0 0/8px 8px, linear-gradient(45deg, transparent 25%, #ddd 25%, #ddd 75%, transparent 75%) 4px 4px/8px 8px'
              : pickerValue,
          }}
        />
        <div className="absolute inset-0 ring-1 ring-inset ring-black/5 rounded-md pointer-events-none" />
      </div>
      <input
        type="text"
        value={isTransparent ? '' : value}
        placeholder={isTransparent ? '透明' : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-7 px-2 text-[11px] text-[#1A1A1A] font-mono border border-[#E0E0E0] rounded-md focus:border-[#0D99FF] focus:ring-1 focus:ring-[#0D99FF]/30 outline-none transition-colors"
      />
      {allowTransparent && (
        <button
          type="button"
          onClick={() => onChange('transparent')}
          className="w-7 h-7 rounded-md border border-[#E0E0E0] text-[#9E9E9E] hover:text-[#5F5F5F] hover:border-[#B0B0B0] transition-colors text-[10px] font-medium"
          title="透明"
          aria-label="设为透明"
        >
          ⌀
        </button>
      )}
    </div>
  )
}

/**
 * 滑块（带当前值显示） 🔥
 *
 * 关键修复 v3（滑动条"有时只能点击不能拖动"）：
 * 完全接管 pointer 事件，不用 native input range 的 drag 行为。
 *
 * 之前 v2 的根因（v2 之前能拖但偶尔失灵）：
 * - v2 依赖 native input range 的 pointermove 自动更新 value
 * - 但 input 元素被 z-index 遮挡 / 父容器 width 过渡动画（属性面板 transition-[width] 300ms）
 *   会让 input 在拖动过程中瞬时失焦，native pointermove 不再派发
 * - 或者 document 的 pointerdown capture 阶段没正确设置 isDraggingRef
 * - 结果：鼠标松开时才收到一个 click 事件，input.value 跳到点击位置但 pointermove 路径全部丢失
 *
 * v3 修复：
 * - input 仅作为视觉占位（hidden，pointer-events-none，**只显示 thumb 和 fill**）
 * - pointerdown / pointermove / pointerup 全部在 document 上注册，根据鼠标 clientX 算 value
 * - 不依赖 native input 的 drag 行为，拖动期间宽度变化也不丢事件
 * - 键盘调节（左右上下箭头）通过 input 的 onKeyUp 调 onChange 提交最终值
 *
 * v3 之前 v2 的关键差异：
 *   - v2 仍依赖 native input（不可靠）
 *   - v3 input 不可见不可点，所有 pointer 事件走 document
 *
 * @param onChange PointerUp 时调用的回调（提交最终值）
 * @param onLiveChange 拖动期间的实时回调（不入栈不广播，仅更新画布预览）
 */
function SliderField({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onLiveChange,
  formatValue,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /**
   * 拖动期间（PointerMove）的实时回调。不入 undo 栈、不广播 socket。
   * 如果不提供，则拖动期间不会更新任何状态（仅松开时生效）。
   */
  onLiveChange?: (v: number) => string | number | void
  formatValue?: (v: number) => string
}) {
  // 关键修复 v3：完全用 DOM ref + defaultValue，零 React re-render
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null) // 保留仅供键盘调节
  // 关键修复：onChange / onLiveChange 是 inline 箭头函数，每次 render 都新引用。
  // 用 ref 缓存避免 useEffect 依赖反复 re-run。
  const onChangeRef = useRef(onChange)
  const onLiveChangeRef = useRef(onLiveChange)
  // 关键修复：用 ref 而非 state 跟踪拖动状态，避免触发 re-render
  const isDraggingRef = useRef(false)
  // 缓存最新 value 给 window listener 读取（避免 listener 闭包过期）
  const valueRef = useRef(value)
  const minRef = useRef(min)
  const maxRef = useRef(max)
  const stepRef = useRef(step)

  // 每帧同步 props 引用（不需要 dep，避免 useEffect 反复 re-run）
  if (onChangeRef.current !== onChange) onChangeRef.current = onChange
  if (onLiveChangeRef.current !== onLiveChange) onLiveChangeRef.current = onLiveChange
  valueRef.current = value
  minRef.current = min
  maxRef.current = max
  stepRef.current = step

  // 关键修复 v3：根据 clientX 计算 value 并对齐到 step
  function computeValueFromClientX(clientX: number): number {
    const track = trackRef.current
    if (!track) return valueRef.current
    const rect = track.getBoundingClientRect()
    const width = rect.width || 1
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / width))
    const raw = minRef.current + pct * (maxRef.current - minRef.current)
    const stepped = Math.round((raw - minRef.current) / stepRef.current) * stepRef.current + minRef.current
    return Math.max(minRef.current, Math.min(maxRef.current, stepped))
  }

  // 计算初始位置（用于 SSR / 首次 mount 时的 visual）
  const initialPct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  const initialDisplay = formatValue ? formatValue(value) : value.toFixed(2)

  // 关键修复：拖动期间不打断用户操作（外部 value 同步让位给拖动）
  // 拖动结束后（PointerUp）会通过 onChange prop 提交一次最终值，store 自然更新
  useEffect(() => {
    if (isDraggingRef.current) return
    if (inputRef.current) {
      inputRef.current.value = String(value)
    }
    updateVisual(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max])

  // 关键修复 v3：完全接管 pointer 事件
  // - document 阶段 pointerdown 时，根据鼠标位置计算 value 并启动拖动
  // - document pointermove 持续更新 value（不受 input 焦点/z-index 影响）
  // - document pointerup / pointercancel 提交最终值
  // - input 仅作键盘 + 屏幕阅读器可达性
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
      const v = computeValueFromClientX(e.clientX)
      if (inputRef.current) inputRef.current.value = String(v)
      updateVisual(v)
      onLiveChangeRef.current?.(v)
    }
    const onUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      if (inputRef.current) {
        onChangeRef.current(parseFloat(inputRef.current.value))
      }
    }
    const onDown = (e: PointerEvent) => {
      const track = trackRef.current
      if (!track) return
      // 关键修复 v3：判断事件目标是否在 track 内（更宽松：track 整个区域都可点）
      // - 包含 input（键盘可达性）
      // - 包含 thumb / fill（虽然 pointer-events-none，但捕获阶段仍可能命中）
      if (!track.contains(e.target as Node)) return
      isDraggingRef.current = true
      const v = computeValueFromClientX(e.clientX)
      if (inputRef.current) inputRef.current.value = String(v)
      updateVisual(v)
      onLiveChangeRef.current?.(v)
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
    }
    // 关键修复：capture phase 抢在 React/native input 之前，确保拿到事件
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      isDraggingRef.current = false
    }
  }, [])

  function updateVisual(v: number) {
    const pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
    if (fillRef.current) fillRef.current.style.width = `${pct}%`
    if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 6px)`
    if (displayRef.current) {
      displayRef.current.textContent = formatValue ? formatValue(v) : v.toFixed(2)
    }
  }

  return (
    <div className="space-y-1">
      <div ref={trackRef} className="relative h-5 flex items-center select-none">
        <div className="absolute inset-x-0 h-1 rounded-full bg-[#E5E5E5]" />
        <div
          ref={fillRef}
          className="absolute h-1 rounded-full bg-[#0D99FF]"
          style={{ width: `${initialPct}%` }}
        />
        {/*
          关键修复 v3：input 改为键盘可达性 + 屏幕阅读器，pointer-events-none。
          所有鼠标事件走 document 阶段的 trackRef handler，绕过 native input 的 drag 行为。
        */}
        <input
          ref={inputRef}
          type="range"
          min={min}
          max={max}
          step={step}
          defaultValue={value}
          tabIndex={0}
          aria-label="slider"
          onKeyUp={(e) => {
            // 键盘调节（左右上下箭头）：在 release 提交最终值
            if (
              e.key === 'ArrowLeft' ||
              e.key === 'ArrowRight' ||
              e.key === 'ArrowUp' ||
              e.key === 'ArrowDown' ||
              e.key === 'Home' ||
              e.key === 'End'
            ) {
              if (inputRef.current) {
                onChangeRef.current(parseFloat(inputRef.current.value))
              }
            }
          }}
          className="absolute inset-0 w-full opacity-0 cursor-pointer pointer-events-none"
        />
        <div
          ref={thumbRef}
          className="absolute w-3 h-3 rounded-full bg-white border-2 border-[#0D99FF] shadow-sm pointer-events-none"
          style={{ left: `calc(${initialPct}% - 6px)` }}
        />
      </div>
      <div
        ref={displayRef}
        className="text-[10px] text-[#9E9E9E] text-center tabular-nums"
      >
        {initialDisplay}
      </div>
    </div>
  )
}

/** Section 标题 */
function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <h4 className="text-[10px] font-semibold text-[#9E9E9E] uppercase tracking-[0.08em]">{children}</h4>
      {action}
    </div>
  )
}

/** 折叠按钮（pin 风格） */
function CollapseButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? '折叠属性面板' : '展开属性面板'}
      aria-label={expanded ? '折叠属性面板' : '展开属性面板'}
      className="w-6 h-6 flex items-center justify-center rounded text-[#9E9E9E] hover:text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" {...STROKE_ATTRS} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 200ms' }}>
        <polyline points="15 6 9 12 15 18" />
      </svg>
    </button>
  )
}

// ============================================================
// 主组件
// ============================================================

const STROKE_ATTRS = STROKE

export default function PropertiesPanel({ expanded, onToggle }: PropertiesPanelProps) {
  const store = useCanvasStore()
  const elements = store.elements
  const selectedIds = store.selectedIds

  const selectedElements = elements.filter((e) => selectedIds.has(e.id))
  const singleSelected: CanvasElement | null =
    selectedElements.length === 1 ? selectedElements[0] : null
  const isMulti = selectedElements.length > 1

  // ============ 锁比例（aspect ratio lock）============
  // 锁比例开启时，更新 W 自动按比例更新 H；更新 H 同理。
  // 不持久化到 store（每次选择新元素时根据 type 默认开启/关闭）
  // 关键修复：直接依赖 singleSelected 整个对象而非四个解构字段，保持与 useEffect 内类型守卫一致；
  // 配合可空性守卫避免 null 引用。
  const [aspectLocked, setAspectLocked] = useState(false)
  const aspectRatioRef = useRef<number | null>(null)
  useEffect(() => {
    if (singleSelected) {
      const ratio = singleSelected.width / singleSelected.height
      aspectRatioRef.current = Number.isFinite(ratio) && ratio > 0 ? ratio : null
      // 图片默认锁比例，其他默认不锁
      setAspectLocked(singleSelected.type === 'image')
    } else {
      aspectRatioRef.current = null
      setAspectLocked(false)
    }
  }, [singleSelected])

  /** 更新单个属性（PointerUp 提交：入栈 + 广播） */
  const updateProperty = useCallback(
    (key: string, value: number | string) => {
      if (!singleSelected) return
      store.updateElement(singleSelected.id, { [key]: value })
    },
    [singleSelected, store]
  )

  /**
   * 关键修复（滑动条拖动卡顿 / 拖动失败）：
   * 拖动期间的实时更新。**不**入 undo 栈、**不**广播 socket。
   *
   * 配合 SliderField 使用：
   * - onChange → updateProperty（PointerUp 时一次性提交）
   * - onLiveChange → updatePropertyLive（PointerMove 时实时预览）
   */
  const updatePropertyLive = useCallback(
    (key: string, value: number | string) => {
      if (!singleSelected) return
      store._updateElementLive(singleSelected.id, { [key]: value })
    },
    [singleSelected, store]
  )

  /** 更新尺寸时考虑锁比例 */
  const updateWidth = useCallback(
    (w: number) => {
      if (!singleSelected) return
      if (aspectLocked && aspectRatioRef.current) {
        const h = Math.max(1, w / aspectRatioRef.current)
        store.updateElement(singleSelected.id, { width: w, height: h })
      } else {
        store.updateElement(singleSelected.id, { width: w })
      }
    },
    [singleSelected, store, aspectLocked]
  )
  const updateHeight = useCallback(
    (h: number) => {
      if (!singleSelected) return
      if (aspectLocked && aspectRatioRef.current) {
        const w = Math.max(1, h * aspectRatioRef.current)
        store.updateElement(singleSelected.id, { width: w, height: h })
      } else {
        store.updateElement(singleSelected.id, { height: h })
      }
    },
    [singleSelected, store, aspectLocked]
  )

  /** 更新所有选中元素的属性（多选） */
  const updateMultiProperty = useCallback(
    (key: string, value: number | string) => {
      for (const id of selectedIds) {
        store.updateElement(id, { [key]: value })
      }
    },
    [selectedIds, store]
  )

  // ============================================================
  // 折叠态 UI
  // ============================================================
  if (!expanded) {
    return (
      <aside
        className="bg-white border-l border-[#E5E5E5] flex flex-col items-center py-2 shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
        style={{ width: PANEL_WIDTH_COLLAPSED }}
      >
        <button
          type="button"
          onClick={onToggle}
          title="展开属性面板"
          className="w-8 h-8 flex items-center justify-center rounded-md text-[#5F5F5F] hover:bg-[#F5F5F5] transition-colors"
          aria-label="展开属性面板"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" {...STROKE_ATTRS} style={{ transform: 'rotate(180deg)' }}>
            <polyline points="15 6 9 12 15 18" />
          </svg>
        </button>
        <span
          className="mt-2 text-[10px] font-semibold text-[#9E9E9E] uppercase tracking-[0.1em]"
          style={{ writingMode: 'vertical-rl' }}
        >
          属性
        </span>
      </aside>
    )
  }

  // ============================================================
  // 展开态 UI
  // ============================================================
  return (
    <aside
      className="bg-white border-l border-[#E5E5E5] flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
      style={{ width: PANEL_WIDTH_EXPANDED }}
    >
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-[#EFEFEF] shrink-0">
        <span className="text-[11px] font-semibold text-[#1A1A1A] uppercase tracking-[0.06em]">
          {singleSelected
            ? `${getTypeLabel(singleSelected.type)}属性`
            : isMulti
              ? `${selectedElements.length} 个元素`
              : '属性'}
        </span>
        <CollapseButton expanded={expanded} onClick={onToggle} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!singleSelected && !isMulti ? (
          <EmptyState />
        ) : singleSelected ? (
          <SingleElementEditor
            element={singleSelected}
            aspectLocked={aspectLocked}
            onToggleAspectLock={() => setAspectLocked((v) => !v)}
            updateProperty={updateProperty}
            updatePropertyLive={updatePropertyLive}
            updateWidth={updateWidth}
            updateHeight={updateHeight}
          />
        ) : (
          <MultiElementEditor
            store={store}
            onUpdateMulti={updateMultiProperty}
          />
        )}
      </div>
    </aside>
  )
}

// ============================================================
// 空状态
// ============================================================

function EmptyState() {
  // 关键修复：从 canvasStore 直接读取默认样式（store 通过 useCanvasStore 在组件内订阅）
  const strokeColor = useCanvasStore((s) => s.strokeColor)
  const fillColor = useCanvasStore((s) => s.fillColor)
  const strokeWidth = useCanvasStore((s) => s.strokeWidth)
  const setStrokeColor = useCanvasStore((s) => s.setStrokeColor)
  const setFillColor = useCanvasStore((s) => s.setFillColor)
  const setStrokeWidth = useCanvasStore((s) => s.setStrokeWidth)

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#F0F0F0] to-[#F8F8F8] flex items-center justify-center mb-3 shadow-[inset_0_1px_0_white]">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#B0B0B0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h7v7H4z" />
          <path d="M13 13h7v7h-7z" />
        </svg>
      </div>
      <p className="text-[12px] text-[#5F5F5F] font-medium">选择元素以编辑属性</p>
      <p className="text-[11px] text-[#9E9E9E] mt-1 max-w-[200px]">
        点击画布上的元素，或拖动框选多个元素
      </p>

      <div className="mt-6 w-full space-y-3">
        <div>
          <SectionTitle>默认描边色</SectionTitle>
          <ColorField value={strokeColor} onChange={setStrokeColor} />
        </div>
        <div>
          <SectionTitle>默认填充色</SectionTitle>
          <ColorField value={fillColor} onChange={setFillColor} allowTransparent />
        </div>
        <div>
          <SectionTitle>默认描边宽度</SectionTitle>
          <SliderField
            value={strokeWidth}
            min={0}
            max={20}
            step={0.5}
            onChange={setStrokeWidth}
            formatValue={(v) => `${v}px`}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 单元素编辑
// ============================================================

function SingleElementEditor({
  element,
  aspectLocked,
  onToggleAspectLock,
  updateProperty,
  /** 关键修复：拖动期间的实时更新（不入栈不广播） */
  updatePropertyLive,
  updateWidth,
  updateHeight,
}: {
  element: CanvasElement
  aspectLocked: boolean
  onToggleAspectLock: () => void
  updateProperty: (key: string, value: number | string) => void
  updatePropertyLive: (key: string, value: number | string) => void
  updateWidth: (w: number) => void
  updateHeight: (h: number) => void
}) {
  return (
    <>
      {/* ============ 变换 ============ */}
      <div>
        <SectionTitle>变换</SectionTitle>
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <LabeledNumberField
              label="X"
              value={element.x}
              onChange={(v) => updateProperty('x', v)}
            />
            <LabeledNumberField
              label="Y"
              value={element.y}
              onChange={(v) => updateProperty('y', v)}
            />
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <LabeledNumberField
              label="W"
              value={element.width}
              onChange={updateWidth}
              min={1}
            />
            <LabeledNumberField
              label="H"
              value={element.height}
              onChange={updateHeight}
              min={1}
            />
            <button
              type="button"
              onClick={onToggleAspectLock}
              title={aspectLocked ? '解锁比例' : '锁定比例'}
              aria-label={aspectLocked ? '解锁比例' : '锁定比例'}
              aria-pressed={aspectLocked}
              className={[
                'w-7 h-7 flex items-center justify-center rounded-md border transition-colors',
                aspectLocked
                  ? 'bg-[#0D99FF] border-[#0D99FF] text-white'
                  : 'bg-white border-[#E0E0E0] text-[#9E9E9E] hover:text-[#5F5F5F] hover:border-[#B0B0B0]',
              ].join(' ')}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {aspectLocked ? (
                  <>
                    <rect x="5" y="11" width="14" height="10" rx="1.5" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </>
                ) : (
                  <>
                    <rect x="5" y="11" width="14" height="10" rx="1.5" />
                    <path d="M8 11V7a4 4 0 0 1 7-2.5" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ============ 外观 ============ */}
      <div>
        <SectionTitle>外观</SectionTitle>
        <div className="space-y-2.5">
          <div>
            <label className="text-[10px] text-[#9E9E9E] mb-1 block">填充色</label>
            <ColorField
              value={element.fill}
              onChange={(v) => updateProperty('fill', v)}
              allowTransparent
            />
          </div>
          <div>
            <label className="text-[10px] text-[#9E9E9E] mb-1 block">描边色</label>
            <ColorField
              value={element.stroke}
              onChange={(v) => updateProperty('stroke', v)}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#9E9E9E] mb-1 block">
              描边宽度 <span className="text-[#5F5F5F]">{element.strokeWidth}px</span>
            </label>
            <SliderField
              value={element.strokeWidth}
              min={0}
              max={20}
              step={0.5}
              onChange={(v) => updateProperty('strokeWidth', v)}
              onLiveChange={(v) => updatePropertyLive('strokeWidth', v)}
              formatValue={() => ''}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#9E9E9E] mb-1 block">
              透明度 <span className="text-[#5F5F5F]">{Math.round((element.opacity ?? 1) * 100)}%</span>
            </label>
            <SliderField
              value={element.opacity ?? 1}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateProperty('opacity', v)}
              onLiveChange={(v) => updatePropertyLive('opacity', v)}
              formatValue={() => ''}
            />
          </div>
        </div>
      </div>

      {/* ============ 文字特有 ============ */}
      {element.type === 'text' && (
        <div>
          <SectionTitle>文本</SectionTitle>
          <div className="space-y-2.5">
            {/* 关键修复（文本颜色被删）：补回 ColorField 绑定 element.textColor。
                CanvasRenderer 渲染文字时优先用 element.textColor，其次用 element.fill。
                之前 canvas/PropertiesPanel.tsx（旧版）有 ColorField，改到 layout 后漏了。 */}
            <div>
              <label className="text-[10px] text-[#9E9E9E] mb-1 block">文字颜色</label>
              <ColorField
                value={element.textColor || element.fill || '#000000'}
                onChange={(v) => updateProperty('textColor', v)}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#9E9E9E] mb-1 block">字号</label>
              <NumberField
                value={element.fontSize || 16}
                onChange={(v) => updateProperty('fontSize', v)}
                min={8}
                max={200}
                suffix="px"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#9E9E9E] mb-1 block">字体</label>
              <select
                value={element.fontFamily || 'Arial'}
                onChange={(e) => updateProperty('fontFamily', e.target.value)}
                className="w-full h-7 px-2 text-[11px] text-[#1A1A1A] border border-[#E0E0E0] rounded-md bg-white focus:border-[#0D99FF] focus:ring-1 focus:ring-[#0D99FF]/30 outline-none"
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Courier New">Courier New</option>
                <option value="monospace">monospace</option>
                <option value="serif">serif</option>
                <option value="sans-serif">sans-serif</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#9E9E9E] mb-1 block">对齐</label>
              <div className="grid grid-cols-3 gap-1">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => updateProperty('textAlign', a)}
                    className={[
                      'h-7 text-[11px] rounded-md border transition-colors',
                      (element.textAlign || 'left') === a
                        ? 'bg-[#0D99FF] border-[#0D99FF] text-white'
                        : 'bg-white border-[#E0E0E0] text-[#5F5F5F] hover:border-[#B0B0B0]',
                    ].join(' ')}
                  >
                    {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ 矩形特有 ============ */}
      {element.type === 'rect' && (
        <div>
          <SectionTitle>矩形</SectionTitle>
          <div>
            <label className="text-[10px] text-[#9E9E9E] mb-1 block">
              圆角 <span className="text-[#5F5F5F]">{Math.round(element.cornerRadius || 0)}px</span>
            </label>
            <SliderField
              value={element.cornerRadius || 0}
              min={0}
              max={Math.max(50, Math.floor(Math.min(element.width, element.height) / 2))}
              step={1}
              onChange={(v) => updateProperty('cornerRadius', v)}
              onLiveChange={(v) => updatePropertyLive('cornerRadius', v)}
              formatValue={() => ''}
            />
          </div>
        </div>
      )}

      {/* ============ 图片特有 ============ */}
      {element.type === 'image' && (
        <div>
          <SectionTitle>图片</SectionTitle>
          <div className="space-y-2">
            {element.imageUrl && (
              <div className="w-full aspect-video rounded-md border border-[#E0E0E0] overflow-hidden bg-[#F5F5F5] flex items-center justify-center">
                <img src={element.imageUrl} alt="" className="max-w-full max-h-full object-contain" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-[#9E9E9E]">
              <div>
                <span>类型</span>
                <div className="text-[11px] text-[#1A1A1A] mt-0.5">栅格图</div>
              </div>
              <div>
                <span>尺寸</span>
                <div className="text-[11px] text-[#1A1A1A] mt-0.5 tabular-nums">
                  {Math.round(element.width)} × {Math.round(element.height)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ 旋转 ============ */}
      <div>
        <SectionTitle>旋转</SectionTitle>
        <SliderField
          value={(element.rotation * 180) / Math.PI}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => updateProperty('rotation', (v * Math.PI) / 180)}
          onLiveChange={(v) => updatePropertyLive('rotation', (v * Math.PI) / 180)}
          formatValue={(v) => `${Math.round(v)}°`}
        />
      </div>
    </>
  )
}

// ============================================================
// 多选编辑
// ============================================================

function MultiElementEditor({
  store,
  onUpdateMulti,
}: {
  store: ReturnType<typeof useCanvasStore.getState>
  onUpdateMulti: (key: string, value: number | string) => void
}) {
  return (
    <div>
      <SectionTitle>批量编辑</SectionTitle>
      <div className="space-y-2.5">
        <div>
          <label className="text-[10px] text-[#9E9E9E] mb-1 block">描边色</label>
          <ColorField
            value={store.strokeColor}
            onChange={(v) => {
              store.setStrokeColor(v)
              onUpdateMulti('stroke', v)
            }}
          />
        </div>
        <div>
          <label className="text-[10px] text-[#9E9E9E] mb-1 block">填充色</label>
          <ColorField
            value={store.fillColor}
            onChange={(v) => {
              store.setFillColor(v)
              onUpdateMulti('fill', v)
            }}
            allowTransparent
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 工具函数
// ============================================================

function getTypeLabel(type: string): string {
  const map: Record<string, string> = {
    rect: '矩形',
    circle: '圆形',
    line: '直线',
    pen: '画笔',
    text: '文本',
    image: '图片',
  }
  return map[type] || type
}
