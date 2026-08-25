import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import Sidebar from './Sidebar.jsx'
import ChatArea from './ChatArea.jsx'
import Composer from './Composer.jsx'

let seq = 0
const nextKey = () => 'm' + (++seq) + '-' + Date.now()

export default function ChatPage({ user, onLogout }) {
  const [threads, setThreads] = useState([])
  const [threadId, setThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [documents, setDocuments] = useState([])
  const [model, setModel] = useState('qwen-plus')
  const [busy, setBusy] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toast, setToast] = useState(null)
  const aiKeyRef = useRef(null)
  const toastTimer = useRef(null)

  const showToast = useCallback((text, kind = 'ok') => {
    setToast({ text, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3600)
  }, [])

  const refreshThreads = useCallback(async () => {
    try { setThreads(await api.listThreads()) } catch (_) { /* ignore */ }
  }, [])

  useEffect(() => { refreshThreads() }, [refreshThreads])

  const refreshDocs = useCallback(async (tid) => {
    if (!tid) { setDocuments([]); return }
    try { setDocuments(await api.listDocs(tid)) } catch (_) { setDocuments([]) }
  }, [])

  const openThread = useCallback(async (tid) => {
    setThreadId(tid)
    setMessages([])
    refreshDocs(tid)
    try {
      const h = await api.history(tid)
      setMessages(h.map((x) => ({ key: nextKey(), role: x.role === 'human' ? 'user' : 'ai', content: x.content })))
    } catch (_) { setMessages([]) }
  }, [refreshDocs])

  const newThread = useCallback(async () => {
    try {
      const t = await api.createThread()
      setThreadId(t.id)
      setMessages([])
      setDocuments([])
      refreshThreads()
    } catch (e) { showToast(e.message, 'err') }
  }, [refreshThreads, showToast])

  const deleteThread = useCallback(async (tid) => {
    try {
      await api.deleteThread(tid)
      if (tid === threadId) { setThreadId(null); setMessages([]); setDocuments([]) }
      refreshThreads()
    } catch (e) { showToast(e.message, 'err') }
  }, [threadId, refreshThreads, showToast])

  const deleteDoc = useCallback(async (id) => {
    try {
      await api.deleteDoc(id)
      refreshDocs(threadId)
    } catch (e) { showToast(e.message, 'err') }
  }, [threadId, refreshDocs, showToast])

  const uploadFiles = useCallback(async (tid, files) => {
    for (const f of files) {
      try { await api.uploadDoc(tid, f) } catch (e) { showToast(f.name + ' 上传失败：' + e.message, 'err') }
    }
    if (files.length) refreshDocs(tid)
  }, [refreshDocs, showToast])

  const applyEvent = useCallback((evt) => {
    const key = aiKeyRef.current
    if (!key) return
    if (evt.type === 'llm_chunk') {
      setMessages((m) => m.map((x) => x.key === key ? { ...x, content: x.content + (evt.content || '') } : x))
    } else if (evt.type === 'tool_call') {
      const label = evt.name === 'retrieve_user_documents' ? '检索文档' : evt.name === 'tavily' ? '联网搜索' : evt.name
      setMessages((m) => m.map((x) => x.key === key ? { ...x, trace: [...x.trace, { label, done: false }] } : x))
    } else if (evt.type === 'tool_result') {
      const label = evt.name === 'retrieve_user_documents' ? '检索文档' : evt.name === 'tavily' ? '联网搜索' : evt.name
      const snippets = String(evt.content || '').split('\n\n').filter((s) => s.trim()).slice(0, 5).map((s) => s.slice(0, 500))
      setMessages((m) => m.map((x) => x.key === key ? {
        ...x,
        trace: x.trace.map((t, i) => i === x.trace.length - 1 ? { ...t, done: true } : t),
        sources: [...x.sources, { label, snippets }]
      } : x))
    }
  }, [])

  const send = useCallback(async (prompt, files) => {
    if (busy) return
    setBusy(true)
    try {
      let tid = threadId
      if (!tid) {
        const t = await api.createThread()
        tid = t.id
        setThreadId(tid)
        refreshThreads()
      }
      if (files && files.length) await uploadFiles(tid, files)

      const userMsg = { key: nextKey(), role: 'user', content: prompt || '（已上传文件）' }
      const aiMsg = { key: nextKey(), role: 'ai', content: '', streaming: true, trace: [], sources: [] }
      aiKeyRef.current = aiMsg.key
      setMessages((m) => [...m, userMsg, aiMsg])

      const realPrompt = prompt || '请基于我上传的文档，简要回答。'
      const res = await api.streamChat(tid, realPrompt, model)
      if (!res.ok) {
        let detail = res.status + ' ' + res.statusText
        try { const e = await res.json(); if (e && e.detail) detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail) } catch (_) { /* ignore */ }
        throw new Error(detail)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          let evt
          try { evt = JSON.parse(line) } catch (_) { continue }
          applyEvent(evt)
        }
      }
      setMessages((m) => m.map((x) => x.key === aiKeyRef.current ? { ...x, streaming: false } : x))

      if (prompt) {
        try {
          await api.renameThread(tid, prompt.slice(0, 24))
          refreshThreads()
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      showToast(err.message || '发送失败，请重试', 'err')
      const key = aiKeyRef.current
      setMessages((m) => m.map((x) => x.key === key ? { ...x, streaming: false, error: true } : x))
    } finally {
      setBusy(false)
    }
  }, [busy, threadId, model, refreshThreads, uploadFiles, applyEvent, showToast])

  const uploadToCurrent = useCallback(async (files) => {
    if (!threadId) return
    await uploadFiles(threadId, files)
  }, [threadId, uploadFiles])

  const onSuggest = useCallback((text) => send(text, []), [send])

  return (
    <div className={'shell' + (sidebarOpen ? '' : ' sidebar-closed')}>
      <Sidebar
        user={user}
        threads={threads}
        threadId={threadId}
        documents={documents}
        onNew={newThread}
        onOpen={openThread}
        onDeleteThread={deleteThread}
        onDeleteDoc={deleteDoc}
        onLogout={onLogout}
        showToast={showToast}
        onUpload={uploadToCurrent}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="main">
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen((v) => !v)} aria-label="切换侧边栏">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="topbar-title">{messages.length ? '对话中' : '新对话'}</div>
            <div className="topbar-sub">{threadId ? '会话已保存 · 可随时切换' : '发送第一条消息后自动创建会话'}</div>
          </div>
          <div className="model-picker">
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="qwen-plus">qwen-plus</option>
              {['gpt-4o-mini'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>

        <ChatArea messages={messages} onSuggest={onSuggest} />
        <Composer busy={busy} onSend={send} />
      </div>

      {toast && (
        <div className="upload-toast">
          <div className={'toast ' + toast.kind}>{toast.text}</div>
        </div>
      )}
    </div>
  )
}