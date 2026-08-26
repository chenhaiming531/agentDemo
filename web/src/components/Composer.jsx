import React, { useRef, useState } from 'react'

export default function Composer({ busy, onSend, onStop }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const fileRef = useRef(null)
  const taRef = useRef(null)

  function pickFiles(e) {
    const arr = Array.from(e.target.files || [])
    e.target.value = ''
    setFiles((f) => [...f, ...arr])
  }

  function submit() {
    const p = text.trim()
    if (busy) return
    if (!p && files.length === 0) return
    Promise.resolve(onSend(p, files)).catch(() => {})
    setText('')
    setFiles([])
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function autoGrow(e) {
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        {files.length > 0 && (
          <div className="file-tags">
            {files.map((f, i) => (
              <span key={i} className="file-tag">
                📎 {f.name}
                <span className="x" onClick={() => setFiles((arr) => arr.filter((_, j) => j !== i))}>✕</span>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => { setText(e.target.value); autoGrow(e) }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-bar">
          <button className="attach-btn" aria-label="上传文档" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt" style={{ display: 'none' }} onChange={pickFiles} />
          </button>
          <span className="composer-hint">{busy ? '生成中，可点击右侧「停止」中止' : 'PDF / DOCX / TXT'}</span>
          {busy ? (
            <button className="stop-btn" onClick={onStop}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
              停止
            </button>
          ) : (
            <button className="send-btn" aria-label="发送" disabled={!text.trim() && files.length === 0} onClick={submit}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}