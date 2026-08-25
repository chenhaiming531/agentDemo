import React, { useEffect, useState } from 'react'
import AuthPage from './components/AuthPage.jsx'
import ChatPage from './components/ChatPage.jsx'
import { api, getToken, setToken } from './api.js'

export default function App() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    async function boot() {
      if (!getToken()) { setBooting(false); return }
      try {
        const me = await api.me()
        setUser({ email: me.email, username: me.username })
      } catch (e) {
        setToken(null)
      }
      setBooting(false)
    }
    boot()
  }, [])

  if (booting) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>正在打开 Vault…</div>
      </div>
    )
  }

  return user ? (
    <ChatPage user={user} onLogout={() => { setToken(null); setUser(null) }} />
  ) : (
    <AuthPage onAuthed={(u) => setUser(u)} />
  )
}