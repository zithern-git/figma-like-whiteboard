import { create } from 'zustand'
import { whiteboardService, WhiteboardData } from '@/services/whiteboard'

interface WhiteboardState {
  whiteboards: WhiteboardData[]
  currentWhiteboard: WhiteboardData | null
  isLoading: boolean
  fetchWhiteboards: () => Promise<void>
  fetchWhiteboardById: (id: string) => Promise<void>
  createWhiteboard: (name: string) => Promise<WhiteboardData>
  deleteWhiteboard: (id: string) => Promise<void>
  joinWhiteboard: (shortId: string) => Promise<WhiteboardData>
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  whiteboards: [],
  currentWhiteboard: null,
  isLoading: false,

  fetchWhiteboards: async () => {
    set({ isLoading: true })
    try {
      const whiteboards = await whiteboardService.getList()
      set({ whiteboards })
    } finally {
      set({ isLoading: false })
    }
  },

  fetchWhiteboardById: async (id: string) => {
    set({ isLoading: true })
    try {
      const whiteboard = await whiteboardService.getById(id)
      set({ currentWhiteboard: whiteboard })
    } catch (error) {
      console.error('获取白板详情失败:', error)
      set({ currentWhiteboard: null })
    } finally {
      set({ isLoading: false })
    }
  },

  createWhiteboard: async (name: string) => {
    const whiteboard = await whiteboardService.create(name)
    set({ whiteboards: [whiteboard, ...get().whiteboards] })
    return whiteboard
  },

  deleteWhiteboard: async (id: string) => {
    await whiteboardService.delete(id)
    set({
      whiteboards: get().whiteboards.filter((wb) => wb.id !== id),
    })
  },

  joinWhiteboard: async (shortId: string) => {
    const whiteboard = await whiteboardService.join(shortId)
    const exists = get().whiteboards.find((wb) => wb.id === whiteboard.id)
    if (!exists) {
      set({ whiteboards: [whiteboard, ...get().whiteboards] })
    }
    return whiteboard
  },
}))