import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error

    if (response && response.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
      return Promise.reject(error)
    }

    const shouldRetry =
      !response ||
      response.status >= 500 ||
      response.status === 408 ||
      error.code === 'ECONNABORTED'

    config.retryCount = config.retryCount || 0

    if (shouldRetry && config.retryCount < 3) {
      config.retryCount += 1
      const delay = Math.pow(2, config.retryCount - 1) * 1000
      await new Promise((resolve) => setTimeout(resolve, delay))
      return api(config)
    }

    return Promise.reject(error)
  }
)

export default api
