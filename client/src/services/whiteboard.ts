import api from './api'

export interface WhiteboardData {
  id: string
  shortId: string
  name: string
  ownerId: string
  collaborators: { userId: string; role: string }[]
  createdAt: string
  updatedAt: string
}

export interface WhiteboardResponse {
  success: boolean
  data: WhiteboardData | WhiteboardData[]
}

export const whiteboardService = {
  async create(name: string): Promise<WhiteboardData> {
    const response = await api.post<{ success: boolean; data: WhiteboardData }>(
      '/whiteboards',
      { name }
    )
    return response.data.data
  },

  async getList(): Promise<WhiteboardData[]> {
    const response = await api.get<{
      success: boolean
      data: WhiteboardData[]
    }>('/whiteboards')
    return response.data.data
  },

  async getById(id: string): Promise<WhiteboardData> {
    const response = await api.get<{ success: boolean; data: WhiteboardData }>(
      `/whiteboards/${id}`
    )
    return response.data.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/whiteboards/${id}`)
  },

  async join(shortId: string): Promise<WhiteboardData> {
    const response = await api.post<{ success: boolean; data: WhiteboardData }>(
      `/whiteboards/${shortId}/join`,
      { shortId }
    )
    return response.data.data
  },
}