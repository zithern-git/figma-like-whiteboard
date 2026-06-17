/**
 * 文本编辑覆盖层组件
 *
 * 双击文本元素时显示一个可编辑的 textarea。
 * 采用受控组件模式，输入实时同步到 store，Esc 取消，Blur/Enter 保存。
 *
 * 关键修复（文本编辑 undo bug）：把整次编辑作为单条 undo 步骤，
 * oldSnapshot 指向"进入编辑前的原始文本"，newSnapshot 指向最终文本。
 *
 * 实现思路：
 * 1. 进入编辑：originalTextRef 记原文本，setTextValue 设置初值
 * 2. 每次 keystroke：_updateElementLive(text: newValue)
 *    - 不入栈、不广播（实时预览）
 *    - 这里 _updateElementLive 不广播意味着 B 端不会看到 A 实时打字的过程，
 *      只在 A 保存时收到一次完整 op
 * 3. 保存：updateElement(text: finalValue, oldSnapshotOverride) 一次性入栈+广播
 *    - oldSnapshotOverride 显式传入 originalText 覆盖"操作前快照"
 *    - 这样 oldSnapshot 真正指向原始文本，undo 才有意义
 * 4. 取消：_replaceElementRaw 强制把 store 文本改回原始（不入栈不广播）
 *    - 等价于"什么都没发生"
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { CanvasRenderer } from '@/canvas/CanvasRenderer'
import { useCanvasStore } from '@/stores/canvasStore'

interface TextEditorProps {
  renderer: CanvasRenderer | null
  editingElementId: string | null
  onFinish: () => void
}

export function TextEditor({ renderer, editingElementId, onFinish }: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const store = useCanvasStore()
  const originalTextRef = useRef<string>('')

  // 受控组件的本地文本值
  const [textValue, setTextValue] = useState('')

  const element = editingElementId
    ? store.elements.find((e) => e.id === editingElementId)
    : null

  // 当进入编辑模式时，记录原文本并设置初始值
  useEffect(() => {
    if (element && editingElementId) {
      const initialText = element.text || ''
      originalTextRef.current = initialText
      setTextValue(initialText)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingElementId, element?.id])

  // 计算编辑框在屏幕上的位置
  const getPosition = useCallback(() => {
    if (!renderer || !element) return { left: 0, top: 0, width: 200, height: 40 }
    const screen = renderer.worldToScreen(element.x, element.y)
    const screenBR = renderer.worldToScreen(element.x + element.width, element.y + element.height)
    return {
      left: screen.x,
      top: screen.y,
      width: Math.max(screenBR.x - screen.x, 100),
      height: Math.max(screenBR.y - screen.y, 30),
    }
  }, [renderer, element])

  const pos = getPosition()

  // 自动聚焦并选中文本
  useEffect(() => {
    if (textareaRef.current && element && editingElementId) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [element, editingElementId])

  // 实时更新：输入时同步到 store（Canvas 会立即重绘，虽然该文本被隐藏）
  // 关键修复（文本编辑 undo bug）：用 _updateElementLive 而不是 updateElement：
  //   - 避免每个 keystroke 都入栈（输入 "hello" 不会产生 5 条 undo）
  //   - 避免每个 keystroke 都广播 socket（B 端不会被打字过程"刷屏"）
  // 最终保存时由 saveAndFinish 一次性 updateElement 入栈+广播
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setTextValue(newValue)
    if (editingElementId) {
      store._updateElementLive(editingElementId, { text: newValue })
    }
  }, [editingElementId, store])

  // 保存并结束编辑
  // 关键修复（文本编辑 undo bug）：
  // 1. textValue === originalTextRef.current 时不提交（避免 no-op undo 记录）
  // 2. 提交时显式把 originalTextRef.current 拼成 oldSnapshotOverride 传入
  //    - 不用 override 时，UpdateElementCommand 读 current（_updateElementLive 改完后的最新值）
  //      → oldSnapshot === newSnapshot，undo 是 no-op
  //    - 显式传入 originalText 后，oldSnapshot 真正指向"操作前状态"
  const saveAndFinish = useCallback(() => {
    if (editingElementId) {
      if (textValue === originalTextRef.current) {
        // 文本没变：直接结束，不提交 undo
      } else {
        const currentEl = useCanvasStore
          .getState()
          .elements.find((e) => e.id === editingElementId)
        if (currentEl) {
          // 关键修复：构造 oldSnapshot = current 但 text 替换为 originalText
          // 这样 UpdateElementCommand 的 oldSnapshot 真正指向"操作前状态"
          const oldSnap = { ...currentEl, text: originalTextRef.current }
          store.updateElement(editingElementId, { text: textValue }, oldSnap)
        }
      }
    }
    onFinish()
  }, [editingElementId, store, textValue, onFinish])

  // 取消编辑并恢复原文本
  // 关键修复（文本编辑 undo bug）：用 _replaceElementRaw 直接改回原文本，
  // 走 _raw 路径，不入栈、不广播，等价于"什么都没发生"。
  // 这样不会留下任何 undo 记录，B 端也不会收到任何 op。
  const cancelAndFinish = useCallback(() => {
    if (editingElementId) {
      const currentEl = useCanvasStore
        .getState()
        .elements.find((e) => e.id === editingElementId)
      if (currentEl) {
        useCanvasStore.getState()._replaceElementRaw({
          ...currentEl,
          text: originalTextRef.current,
        })
      }
    }
    onFinish()
  }, [editingElementId, onFinish])

  // 键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        saveAndFinish()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelAndFinish()
      }
    },
    [saveAndFinish, cancelAndFinish]
  )

  // 阻止编辑框内部事件冒泡到 canvas
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  if (!element || element.type !== 'text') return null

  return (
    <textarea
      ref={textareaRef}
      value={textValue}
      onChange={handleChange}
      onBlur={saveAndFinish}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        zIndex: 100,
        fontSize: `${element.fontSize || 16}px`,
        fontFamily: element.fontFamily || 'Arial',
        color: element.fill || '#000000',
        background: 'white',
        border: '1px solid #1890ff',
        outline: 'none',
        resize: 'none',
        padding: '4px 6px',
        margin: 0,
        lineHeight: 1.2,
        overflow: 'hidden',
      }}
    />
  )
}
