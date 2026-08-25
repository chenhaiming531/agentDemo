import React, { useRef, useState } from 'react'

const Mark = () => (
  <svg viewBox="0 0 32 32" fill="none">
    <path d="M8 21 L16 8 L24 21" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function Sidebar({ user, threads, threadId, documents, onNew, onOpen, onDeleteThread, onDeleteDoc, onLogout, showToast, onClose, onUpload }) {
  const fileRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function upload(files) {
    if (!files.length) return
    if (!threadId) { showToast('请先新建会话，再上传文档', 'err'); return }
    const ok = files.filter((f) => /\.(pdf|docx|txt)$/i.test(f.name))
    if (ok.length !== files.length) showToast('仅支持 PDF / DOCX / TXT', 'err')
    if (!ok.length) return
    onUpload(ok)
  }

  function pickFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    upload(files)
  }

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <div className="sb-logo">
          <span className="mark"><Mark /></span>
          Vault
        </div>
        <button className="hamburger" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="收起侧边栏">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      </div>

      <button className="sb-new" onClick={onNew}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建会话
      </button>

      <div className="sb-section">历史会话</div>
      <div className="sb-list">
        {threads.length === 0 && <div className="sb-empty">还没有会话，点上方「新建会话」开始。</div>}
        {threads.map((t) => (
          <div key={t.id} className={'sb-item' + (t.id === threadId ? ' active' : '')} onClick={() => onOpen(t.id)}>
            <span className="title">{t.title || '新对话'}</span>
            <button
              className="del"
              aria-label="删除会话"
              onClick={(e) => { e.stopPropagation(); if (window.confirm('确定删除这个会话吗？文档和记录将一并删除。')) onDeleteThread(t.id) }}
            >✕</button>
          </div>
        ))}
      </div>

      <div className="sb-section">当前会话文档</div>
      <div
        className={'dropzone' + (dragging ? ' drag' : '')}
        onClick={() => fileRef.current && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files || [])) }}
      >
        <div className="dz-t">+ 拖拽或点击上传</div>
        PDF / DOCX / TXT，支持多选
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt" onChange={pickFiles} />
      </div>
      <div className="sb-list">
        {documents.length === 0 && <div className="sb-empty">尚未上传文档。上传后即可针对文档提问。</div>}
        {documents.map((d) => (
          <div key={d.id} className="sb-item doc-item">
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="fname">📄 {d.file_name}</div>
              <div className="fmeta">{new Date(d.uploaded_at).toLocaleString('zh-CN')}</div>
            </span>
            <button className="del" aria-label="删除文档" onClick={() => { if (window.confirm('删除文档 ' + d.file_name + '？')) onDeleteDoc(d.id) }}>✕</button>
          </div>
        ))}
      </div>

      <div className="sb-foot">
        <div className="sb-user">
          <span className="sb-avatar">{(user.username || 'U').slice(0, 1).toUpperCase()}</span>
          <span className="sb-uname">{user.username}</span>
        </div>
        <button className="sb-logout" onClick={onLogout}>退出</button>
      </div>
    </aside>
  )
}