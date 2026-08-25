const BASE = '/api/v1'

let authToken = localStorage.getItem('vault_access') || ''

export function setToken(t) {
  authToken = t || ''
  if (t) localStorage.setItem('vault_access', t)
  else localStorage.removeItem('vault_access')
}
export function getToken() { return authToken }

async function j(method, url, body, isForm) {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  if (body && !isForm) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    let detail = res.status + ' ' + res.statusText
    try {
      const e = await res.json()
      if (e && e.detail) detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)
    } catch (_) { /* ignore */ }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  if (res.status === 204) return null
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

export const api = {
  signup: (d) => j('POST', '/auth/signup', d),
  login: (email, pass) => {
    const body = new URLSearchParams({ username: email, password: pass })
    return j('POST', '/auth/login', body, true)
  },
  me: () => j('GET', '/users/me'),
  createThread: () => j('POST', '/threads/'),
  listThreads: () => j('GET', '/threads/'),
  deleteThread: (id) => j('DELETE', '/threads/' + id),
  renameThread: (id, title) => j('PATCH', '/threads/' + id, { title }),
  history: (id) => j('GET', '/chat/' + id),
  uploadDoc: (threadId, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return j('POST', '/documents/upload/' + threadId, fd, true)
  },
  listDocs: (threadId) => j('GET', '/documents/' + threadId),
  deleteDoc: (id) => j('DELETE', '/documents/' + id),
  streamChat: (threadId, prompt, model) =>
    fetch(BASE + '/chat/' + threadId, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: 'Bearer ' + authToken } : {})
      },
      body: JSON.stringify({ prompt, model_name: model })
    })
}