/**
 * 前端 Canvas 渲染器单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CanvasRenderer } from '../../client/src/canvas/CanvasRenderer'
import { CanvasElement } from '../../client/src/canvas/CanvasElement'

describe('CanvasRenderer', () => {
  let renderer: CanvasRenderer
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new CanvasRenderer(container, 800, 600)
  })

  it('should initialize with correct dimensions', () => {
    expect(renderer).toBeDefined()
  })

  it('should set and get elements', () => {
    const elements: CanvasElement[] = [
      {
        id: 'test-1',
        type: 'rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        fill: '#FF6B6B',
        stroke: '#000000',
        strokeWidth: 2,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'test',
      },
    ]

    renderer.setElements(elements)
    expect(renderer.getElements()).toHaveLength(1)
  })

  it('should handle empty elements', () => {
    renderer.setElements([])
    expect(renderer.getElements()).toHaveLength(0)
  })

  it('should handle 1000+ elements', () => {
    const elements: CanvasElement[] = []
    for (let i = 0; i < 1000; i++) {
      elements.push({
        id: `el-${i}`,
        type: 'rect',
        x: Math.random() * 800,
        y: Math.random() * 600,
        width: 20 + Math.random() * 80,
        height: 20 + Math.random() * 80,
        rotation: 0,
        opacity: 1,
        fill: '#4ECDC4',
        stroke: '#000000',
        strokeWidth: 2,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'test',
      })
    }

    renderer.setElements(elements)
    expect(renderer.getElements()).toHaveLength(1000)
  })

  it('should handle element updates', () => {
    const elements: CanvasElement[] = [
      {
        id: 'test-1',
        type: 'rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        fill: '#FF6B6B',
        stroke: '#000000',
        strokeWidth: 2,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'test',
      },
    ]

    renderer.setElements(elements)

    const updated = [...elements]
    updated[0] = { ...updated[0], x: 50, y: 50, version: 2 }
    renderer.setElements(updated)

    const result = renderer.getElements()
    expect(result[0].x).toBe(50)
    expect(result[0].y).toBe(50)
  })
})
