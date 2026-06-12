/**
 * 远程光标渲染组件 (RemoteCursors)
 *
 * Phase 6.3 — 协作客户端
 *
 * 职责：
 * - 接收 useCollaboration 的 remoteCursors 列表
 * - 在 Canvas 临时层（temp canvas）上绘制其他用户的光标
 * - 光标样式：彩色 SVG 箭头 + 用户名标签
 *
 * 设计要点：
 * - 叠加在 Canvas 三层结构中的最上层（temp layer），不影响主画布的脏矩形管理
 * - 通过 rAF 统一刷新（不每帧都重绘，仅在 cursors 变化时重绘）
 * - 鼠标位置（世界坐标）→ 屏幕坐标（应用 viewport 变换）→ Canvas 2D 绘制
 *
 * 与 CanvasRenderer 的协作：
 * - 本组件不直接操作 Canvas 2D context
 * - 通过 onRenderCursors 回调让 CanvasRenderer 决定如何融入其渲染队列
 * - 若 CanvasRenderer 未集成该回调，则 fallback 到独立 Canvas 覆盖层
 */

import { useEffect, useRef, useCallback } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { RemoteCursor } from '@/hooks/useCollaboration'

interface RemoteCursorsProps {
  /** 远端光标列表（userId → RemoteCursor） */
  cursors: Map<string, RemoteCursor>
  /** 屏幕坐标转世界坐标的函数（由 CanvasRenderer 提供） */
  worldToScreen?: (wx: number, wy: number) => { x: number; y: number }
  /** 临时层 canvas 引用（可选） */
  tempCanvasRef?: React.RefObject<HTMLCanvasElement>
}

const CURSOR_SVG_PATH = 'M5.65,3.5 L17.5,15.35 L11.5,15.5 L9.5,21.5 L5.65,3.5 Z'

export default function RemoteCursors({
  cursors,
  worldToScreen,
  tempCanvasRef,
}: RemoteCursorsProps) {
  const rafRef = useRef<number | null>(null)
  const cursorListRef = useRef<RemoteCursor[]>([])

  // 每次 cursors 变化触发重绘
  useEffect(() => {
    cursorListRef.current = Array.from(cursors.values())
    scheduleRender()
  }, [cursors])

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      renderCursors()
    })
  }, [])

  const renderCursors = useCallback(() => {
    const list = cursorListRef.current
    if (list.length === 0) return
    const canvas = tempCanvasRef?.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 清空
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 获取当前 viewport
    const { viewport } = useCanvasStore.getState()
    const dpr = window.devicePixelRatio || 1

    for (const cursor of list) {
      // 世界坐标 → 屏幕坐标
      let sx: number
      let sy: number
      if (worldToScreen) {
        const s = worldToScreen(cursor.x, cursor.y)
        sx = s.x
        sy = s.y
      } else {
        sx = (cursor.x * viewport.zoom + viewport.translateX) * dpr
        sy = (cursor.y * viewport.zoom + viewport.translateY) * dpr
      }
      drawCursor(ctx, sx, sy, cursor.color, cursor.name)
    }
  }, [worldToScreen, tempCanvasRef])

  /**
   * 在 ctx 上绘制一个光标（彩色箭头 + 用户名标签）
   *
   * 坐标系说明：本方法在 temp canvas 的 CSS 像素下绘制；
   * 调用方在传入 sx/sy 前应自行乘以 dpr。
   */
  const drawCursor = useCallback(
    (ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string, name: string) => {
      // 鼠标指针
      ctx.save()
      ctx.fillStyle = color
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.5

      // 绘制 SVG 箭头路径（缩放到 18px）
      const path = new Path2D(CURSOR_SVG_PATH)
      ctx.save()
      ctx.translate(sx, sy)
      ctx.scale(1.2, 1.2)
      ctx.fill(path)
      ctx.stroke(path)
      ctx.restore()

      // 绘制用户名标签
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      const textWidth = ctx.measureText(name).width
      const padding = 6
      const labelX = sx + 14
      const labelY = sy + 14
      const labelW = textWidth + padding * 2
      const labelH = 20

      // 标签背景
      ctx.fillStyle = color
      ctx.beginPath()
      const r = 4
      ctx.moveTo(labelX + r, labelY)
      ctx.lineTo(labelX + labelW - r, labelY)
      ctx.arcTo(labelX + labelW, labelY, labelX + labelW, labelY + r, r)
      ctx.lineTo(labelX + labelW, labelY + labelH - r)
      ctx.arcTo(labelX + labelW, labelY + labelH, labelX + labelW - r, labelY + labelH, r)
      ctx.lineTo(labelX + r, labelY + labelH)
      ctx.arcTo(labelX, labelY + labelH, labelX, labelY + labelH - r, r)
      ctx.lineTo(labelX, labelY + r)
      ctx.arcTo(labelX, labelY, labelX + r, labelY, r)
      ctx.closePath()
      ctx.fill()

      // 标签文字
      ctx.fillStyle = '#FFFFFF'
      ctx.textBaseline = 'middle'
      ctx.fillText(name, labelX + padding, labelY + labelH / 2)

      ctx.restore()
    },
    []
  )

  // 视口变化时重绘（缩放/平移后光标位置需重新计算）
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.viewport !== prev.viewport) {
        scheduleRender()
      }
    })
    return unsub
  }, [scheduleRender])

  // 清理
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  // 本组件不直接渲染 DOM；实际绘制在 temp canvas 上
  // 返回 null 让 React 知道这是一个"逻辑组件"
  return null
}
