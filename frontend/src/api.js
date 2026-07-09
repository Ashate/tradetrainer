import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

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

// 行情模块：分页加载K线
export const marketAPI = {
  getData: (symbol, interval, before, limit) =>
    api.get('/klines/market-data', { params: { symbol, interval, before, limit } }),
}

// 行情模块：画线CRUD
export const drawingsAPI = {
  list:         (symbol, interval) => api.get('/drawings/list', { params: { symbol, interval } }),
  create:       (data)             => api.post('/drawings/create', data),
  remove:       (id)               => api.delete(`/drawings/${id}`),
  updateColor:  (id, color)        => api.put(`/drawings/${id}/color`, null, { params: { color } }),
  updatePosition: (id, patch)      => api.put(`/drawings/${id}/position`, patch),
}

// 模拟交易模块
export const simulateAPI = {
  getAccount:    ()                  => api.get('/simulate/account'),
  updateAccount: (data)              => api.put('/simulate/account', data),
  startSession:  (data)              => api.post('/simulate/session/start', data),
  getSessionData:(sessionId, currentIdxTime) => api.get('/simulate/session/data', { params: { session_id: sessionId, current_idx_time: currentIdxTime } }),
  openOrder:     (data)              => api.post('/simulate/order/open', data),
  closeOrder:    (data)              => api.post('/simulate/order/close', data),
  cancelOrder:   (data)              => api.post('/simulate/order/cancel', data),
  updateSLTP:    (data)              => api.put('/simulate/order/update-sltp', data),
  advanceSession:(data)              => api.post('/simulate/session/advance', data),
  listTrades:    (skip, limit, sessionId) => api.get('/simulate/trades', { params: { skip, limit, session_id: sessionId } }),
  getStats:      ()                  => api.get('/simulate/stats'),
  listOrders:    (sessionId)         => api.get('/simulate/orders', { params: { session_id: sessionId } }),
}
