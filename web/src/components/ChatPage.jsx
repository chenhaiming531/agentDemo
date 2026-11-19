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
  const [pendingQuestion, setPendingQuestion] = useState(null) // { question, options }
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toast, setToast] = useState(null)
  // 编辑 / 补充面板状态
  const [editMode, setEditMode] = useState(null) // null | 'edit' | 'supplement'
  const [editText, setEditText] = useState('')
  const aiKeyRef = useRef(null)
  const stopRef = useRef(null)
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
    setEditMode(null)
    setEditText('')
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
      setEditMode(null)
      setEditText('')
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
      const label = evt.name === 'retrieve_user_documents' ? '检索文档' : evt.name === 'tavily' ? '联网搜索' : evt.name === 'ask_human' ? '请求你确认' : evt.name
      setMessages((m) => m.map((x) => x.key === key ? { ...x, trace: [...x.trace, { label, done: false }] } : x))
    } else if (evt.type === 'tool_result') {
      const label = evt.name === 'retrieve_user_documents' ? '检索文档' : evt.name === 'tavily' ? '联网搜索' : evt.name === 'ask_human' ? '已收到你的回答' : evt.name
      const snippets = String(evt.content || '').split('\n\n').filter((s) => s.trim()).slice(0, 5).map((s) => s.slice(0, 500))
      setMessages((m) => m.map((x) => x.key === key ? {
        ...x,
        trace: x.trace.map((t, i) => i === x.trace.length - 1 ? { ...t, done: true } : t),
        sources: [...x.sources, { label, snippets }]
      } : x))
    } else if (evt.type === 'ask_human') {
      // Agent paused: show a multiple-choice card and let the user decide.
      setMessages((m) => m.map((x) => x.key === key ? { ...x, streaming: false, awaitingHuman: true } : x))
      setPendingQuestion({ question: evt.question || '', options: evt.options || [] })
    }
  }, [])

  // Consume an NDJSON stream, dispatching each line to applyEvent.
  const drainStream = useCallback(async (res) => {
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
  }, [applyEvent])

  // Answer an ask_human interrupt: append the choice as a user message, then
  // resume the paused graph with the same thread_id and keep streaming into
  // the SAME ai bubble so the answer continues below the question.
  const answerQuestion = useCallback(async (answer) => {
    if (!threadId || busy) return
    const value = (answer || '').trim()
    if (!value) return
    setBusy(true)
    const ctrl = new AbortController()
    stopRef.current = ctrl
    const key = aiKeyRef.current
    setPendingQuestion(null)
    setMessages((m) => [
      ...m.map((x) => x.key === key ? { ...x, awaitingHuman: false, streaming: true } : x),
      { key: nextKey(), role: 'user', content: value }
    ])
    try {
      const res = await api.resumeChat(threadId, value, model, ctrl.signal)
      if (!res.ok) {
        let detail = res.status + ' ' + res.statusText
        try { const e = await res.json(); if (e && e.detail) detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail) } catch (_) { /* ignore */ }
        throw new Error(detail)
      }
      await drainStream(res)
      setMessages((m) => m.map((x) => x.key === key ? { ...x, streaming: false } : x))
    } catch (err) {
      const isAbort = err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort'))
      if (isAbort) {
        setMessages((m) => m.map((x) => x.key === key ? { ...x, streaming: false } : x))
      } else {
        showToast(err.message || '回答失败，请重试', 'err')
        setMessages((m) => m.map((x) => x.key === key ? { ...x, streaming: false, error: true } : x))
      }
    } finally {
      setBusy(false)
      stopRef.current = null
    }
  }, [threadId, busy, model, drainStream, showToast])

  const send = useCallback(async (prompt, files, opts = {}) => {
    const appendUser = opts.appendUser !== false
    if (busy) return
    setBusy(true)
    const ctrl = new AbortController()
    stopRef.current = ctrl
    let aiKey = null
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
      aiKey = aiMsg.key
      aiKeyRef.current = aiKey
      setMessages((m) => (appendUser ? [...m, userMsg, aiMsg] : [...m, aiMsg]))

      const realPrompt = prompt || '请基于我上传的文档，简要回答。'
      const res = await api.streamChat(tid, realPrompt, model, ctrl.signal)
      if (!res.ok) {
        let detail = res.status + ' ' + res.statusText
        try { const e = await res.json(); if (e && e.detail) detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail) } catch (_) { /* ignore */ }
        throw new Error(detail)
      }
      await drainStream(res)
      setMessages((m) => m.map((x) => x.key === aiKey ? { ...x, streaming: false } : x))

      if (appendUser && prompt) {
        try {
          await api.renameThread(tid, prompt.slice(0, 24))
          refreshThreads()
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      const isAbort = err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort'))
      if (isAbort) {
        // 用户主动中止：保留已生成的内容，不报错
        setMessages((m) => m.map((x) => x.key === aiKey ? { ...x, streaming: false } : x))
      } else {
        showToast(err.message || '发送失败，请重试', 'err')
        setMessages((m) => m.map((x) => x.key === aiKey ? { ...x, streaming: false, error: true } : x))
      }
    } finally {
      setBusy(false)
      stopRef.current = null
    }
  }, [busy, threadId, model, refreshThreads, uploadFiles, applyEvent, drainStream, showToast])

  const stopGenerating = useCallback(() => {
    if (stopRef.current) stopRef.current.abort()
    // 立即结束 UI 流式状态（不等 reader 抛错），已生成内容保留
    const key = aiKeyRef.current
    if (key) setMessages((m) => m.map((x) => x.key === key ? { ...x, streaming: false } : x))
    setBusy(false)
  }, [])

  const lastUserContent = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  }, [messages])

  const startEdit = useCallback(() => {
    setEditMode('edit')
    setEditText(lastUserContent())
  }, [lastUserContent])

  const startSupplement = useCallback(() => {
    setEditMode('supplement')
    setEditText('')
  }, [])

  const cancelAction = useCallback(() => {
    setEditMode(null)
    setEditText('')
  }, [])

  const commitAction = useCallback((text) => {
    const value = (text || '').trim()
    if (!value) return
    if (editMode === 'edit') {
      // 编辑：替换最近一条 user 消息，删除旧回答，重发
      setMessages((m) => {
        const next = [...m]
        let ui = -1
        for (let i = next.length - 1; i >= 0; i--) if (next[i].role === 'user') { ui = i; break }
        if (ui >= 0) next[ui] = { ...next[ui], content: value }
        for (let i = next.length - 1; i >= 0; i--) if (next[i].role === 'ai') { next.splice(i, 1); break }
        return next
      })
      setEditMode(null)
      setEditText('')
      send(value, [], { appendUser: false })
    } else if (editMode === 'supplement') {
      // 补充：追加一条「补充说明」消息，删除旧回答，重发
      const prompt = '补充说明：' + value
      setMessages((m) => {
        const next = [...m]
        for (let i = next.length - 1; i >= 0; i--) if (next[i].role === 'ai') { next.splice(i, 1); break }
        return [...next, { key: nextKey(), role: 'user', content: prompt }]
      })
      setEditMode(null)
      setEditText('')
      send(prompt, [], { appendUser: false })
    }
  }, [editMode, send])

  const resend = useCallback(() => {
    const content = lastUserContent()
    if (!content) return
    setMessages((m) => {
      const next = [...m]
      for (let i = next.length - 1; i >= 0; i--) if (next[i].role === 'ai') { next.splice(i, 1); break }
      return next
    })
    setEditMode(null)
    setEditText('')
    send(content, [], { appendUser: false })
  }, [lastUserContent, send])

  const uploadToCurrent = useCallback(async (files) => {
    if (!threadId) return
    await uploadFiles(threadId, files)
  }, [threadId, uploadFiles])

  const onSuggest = useCallback((text) => send(text, []), [send])

  const lastMsg = messages[messages.length - 1]
  const canAct = !!lastMsg && lastMsg.role === 'ai' && !lastMsg.streaming

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

        <ChatArea
          messages={messages}
          onSuggest={onSuggest}
          canAct={canAct}
          onEdit={startEdit}
          onSupplement={startSupplement}
          onResend={resend}
          editMode={editMode}
          editText={editText}
          onEditTextChange={setEditText}
          onCommit={commitAction}
          onCancel={cancelAction}
          pendingQuestion={pendingQuestion}
          onAnswerQuestion={answerQuestion}
        />
        <Composer busy={busy} onSend={send} onStop={stopGenerating} />
      </div>

      {toast && (
        <div className="upload-toast">
          <div className={'toast ' + toast.kind}>{toast.text}</div>
        </div>
      )}
    </div>
  )
}