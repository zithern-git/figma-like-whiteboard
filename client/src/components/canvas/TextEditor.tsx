/**
 * 文本编辑覆盖层组件
 *
 * 双击文本元素时显示一个可编辑的 textarea。
 * 采用受控组件模式，输入实时同步到 store，Esc 取消，Blur/Enter 保存。
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
  }, [editingElementId, element])

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
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setTextValue(newValue)
    if (editingElementId) {
      store.updateElement(editingElementId, { text: newValue })
    }
  }, [editingElementId, store])

  // 保存并结束编辑
  const saveAndFinish = useCallback(() => {
    if (editingElementId) {
      store.updateElement(editingElementId, { text: textValue })
    }
    onFinish()
  }, [editingElementId, store, textValue, onFinish])

  // 取消编辑并恢复原文本
  const cancelAndFinish = useCallback(() => {
    if (editingElementId) {
      store.updateElement(editingElementId, { text: originalTextRef.current })
    }
    onFinish()
  }, [editingElementId, store, onFinish])

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
