import axios from 'axios'

const api = axios.create({ baseURL: '/api' })   // APP请将baseURL换成 'https://域名或IP/api'

api.interceptors.request.use(config => {
  const token = localStorage.getItem('tt_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tt_token')
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

export default api

export const authAPI = {
  login:    (username, password) => api.post('/auth/login', new URLSearchParams({ username, password })),
  register: (data) => api.post('/auth/register', data),
}

export const klinesAPI = {
  symbols:      (market) => api.get('/klines/symbols', { params: { market } }),
  intervals:    (symbol) => api.get('/klines/intervals', { params: { symbol } }),
  sessionStart: (symbol, interval) => api.get('/klines/session-start', { params: { symbol, interval } }),
  load:         (symbol, interval, start_index, current_index) =>
                  api.get('/klines/load', { params: { symbol, interval, start_index, current_index } }),
}

export const sessionsAPI = {
  create: (data) => api.post('/sessions/create', data),
  end:    (data) => api.post('/sessions/end', data),
  list:   (skip, limit) => api.get('/sessions/list', { params: { skip, limit } }),
}

export const tradesAPI = {
  open:   (data) => api.post('/trades/open', data),
  close:  (data) => api.post('/trades/close', data),
  list:   (session_id) => api.get(`/trades/session/${session_id}`),
}

export const casesAPI = {
  create: (data) => api.post('/cases/create', data),
  list:   (params) => api.get('/cases/list', { params }),
}

export const statsAPI = {
  overview: () => api.get('/stats/overview'),
}

export const importAPI = {
  csv: (symbol, market, interval, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/import/csv', fd, { params: { symbol, market, interval } })
  }
}

// 新增：获取完整训练数据（一次性）
export const trainAPI = {
  getData:      (symbol, interval) => api.get('/klines/train-data', { params: { symbol, interval } }),
  symbolsByMkt: ()                 => api.get('/klines/symbols-by-market'),
}
