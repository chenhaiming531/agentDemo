import React, { useState } from 'react'
import { api, setToken } from '../api.js'

const Mark = () => (
  <svg viewBox="0 0 32 32" fill="none">
    <path d="M8 21 L16 8 L24 21" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function AuthPage({ onAuthed }) {
  const [tab, setTab] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ email: '', password: '', username: '', first_name: '', last_name: '' })
  const [notice, setNotice] = useState('')

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      if (tab === 'login') {
        const r = await api.login(form.email.trim(), form.password)
        setToken(r.access_token)
        onAuthed({ email: r.user.email, username: r.user.username })
      } else {
        const r = await api.signup({
          email: form.email.trim(),
          username: form.username.trim(),
          password: form.password,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
        })
        setNotice('账号创建成功，请登录')
        setTab('login')
        setForm((f) => ({ ...f, password: '' }))
      }
    } catch (err) {
      setError(err.message || '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="brand-mark"><Mark /></div>
        <h1 className="brand-title">把问题交给<br /><em>文档自己</em>回答</h1>
        <p className="brand-sub">
          Vault 是一个面向私有文档的智能问答助手。上传合同、说明书、制度文件，
          它会检索相关内容，并给出带出处的回答。
        </p>
        <div className="brand-points">
          <div className="brand-point">
            <span className="dot" />
            <div>
              <div className="pt-t">基于你的文档回答</div>
              <div className="pt-d">检索最相关的片段，回答可追溯到原文</div>
            </div>
          </div>
          <div className="brand-point">
            <span className="dot" />
            <div>
              <div className="pt-t">多轮对话记忆</div>
              <div className="pt-d">上下文跨会话持久保存，随时回来继续问</div>
            </div>
          </div>
          <div className="brand-point">
            <span className="dot" />
            <div>
              <div className="pt-t">文档之外也能答</div>
              <div className="pt-d">通用问题自动联网搜索，不被文档局限</div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-tabs">
            <button className={'auth-tab' + (tab === 'login' ? ' active' : '')} onClick={() => { setTab('login'); setError('') }}>登录</button>
            <button className={'auth-tab' + (tab === 'register' ? ' active' : '')} onClick={() => { setTab('register'); setError('') }}>注册</button>
          </div>

          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-error" style={{ background: 'rgba(45,212,191,0.1)', borderColor: 'rgba(45,212,191,0.3)', color: '#5EEAD4' }}>{notice}</div>}

          <form onSubmit={submit}>
            {tab === 'register' && (
              <div className="field">
                <label>用户名</label>
                <input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="3-16 个字符" required minLength={3} maxLength={16} />
              </div>
            )}
            <div className="field">
              <label>邮箱</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" required />
            </div>
            <div className="field">
              <label>密码</label>
              <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={tab === 'register' ? '至少 8 位' : '请输入密码'} required minLength={8} maxLength={32} />
            </div>
            {tab === 'register' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>名字</label>
                  <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
                </div>
                <div className="field">
                  <label>姓氏</label>
                  <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
                </div>
              </div>
            )}
            <button className="btn-primary" disabled={busy} style={{ marginTop: 6 }}>
              {busy ? '请稍候…' : tab === 'login' ? '进入 Vault' : '创建账号'}
            </button>
          </form>

          <div className="auth-hint">
            登录后即可上传文档开始提问。<br />数据保存在本机 PostgreSQL，<b>仅你可见</b>。
          </div>
        </div>
      </div>
    </div>
  )
}