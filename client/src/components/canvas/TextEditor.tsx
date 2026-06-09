/**
 * 文本编辑覆盖层组件
 *
 * 当前版本由 useDrawTool 通过 DOM 直接管理编辑框，
 * 此组件仅作为过渡占位，实际编辑功能已移至 useDrawTool。
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
  const isCancelledRef = useRef(false)

  const [textValue, setTextValue] = useState('')

  const element = editingElementId
    ? store.elements.find((e) => e.id === editingElementId)
    : null

  useEffect(() => {
    if (element && editingElementId) {
      originalTextRef.current = element.text || ''
      isCancelledRef.current = false
      setTextValue(element.text || '')
    } else {
      setTextValue('')
    }
  }, [editingElementId, element])

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

  useEffect(() => {
    if (textareaRef.current && element && editingElementId) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [element, editingElementId])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextValue(e.target.value)
  }, [])

  const handleFinish = useCallback(() => {
    if (isCancelledRef.current) {
      onFinish()
      return
    }
    if (!editingElementId) {
      onFinish()
      return
    }
    store.updateElement(editingElementId, { text: textValue })
    onFinish()
  }, [editingElementId, store, onFinish, textValue])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleFinish()
      }
      if (e.key === 'Escape') {
        isCancelledRef.current = true
        if (editingElementId) {
          store.updateElement(editingElementId, { text: originalTextRef.current })
        }
        onFinish()
      }
    },
    [onFinish, editingElementId, store, handleFinish]
  )

  const handleBlur = useCallback(() => {
    handleFinish()
  }, [handleFinish])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  if (!element || element.type !== 'text') return null

  return (
    <textarea
      ref={textareaRef}
      value={textValue}
      onChange={handleChange}
      onBlur={handleBlur}
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