import axios from 'axios'

export const TOKEN_KEY = 'janai_token'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export function getApiError(error) {
  if (error.response?.status === 429) return error.response.data?.message || 'Too many requests. Please wait and try again.'
  return error.response?.data?.message || (error.code === 'ECONNABORTED' ? 'The request took too long. Please try again.' : 'We could not connect right now. Please try again.')
}

export default api
