import React, { useEffect, useRef, useState } from 'react'

function SourceBlock({ src }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="src-wrap">
      <button className="src-toggle" onClick={() => setOpen((v) => !v)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 3v12M6 9l6 6 6-6" />
        </svg>
        {open ? '收起来源' : '查看检索来源'} · {src.snippets.length} 段
      </button>
      {open && (
        <div className="src-list">
          {src.snippets.map((s, i) => (
            <div key={i} className="src-card">
              <div className="src-label">{src.label} · 片段 {i + 1}</div>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AiMessage({ m }) {
  const [showSrc, setShowSrc] = useState(false)
  const hasTrace = m.trace && m.trace.length > 0
  const hasSrc = m.sources && m.sources.length > 0
  return (
    <div className="msg ai">
      <div className="msg-avatar">
        <svg width="17" height="17" viewBox="0 0 32 32" fill="none">
          <path d="M8 21 L16 8 L24 21" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="msg-body">
        {hasTrace && (
          <div className="trace">
            {m.trace.map((t, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="t-line" />}
                <span className="t-step">
                  <span className="t-dot" style={t.done ? { background: 'var(--teal)', boxShadow: '0 0 8px var(--glow)' } : undefined} />
                  {t.done ? t.label + ' ✓' : t.label + '…'}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
        {m.content ? (
          <div className="msg-bubble">{m.content}{m.streaming && <span className="cursor" />}</div>
        ) : m.awaitingHuman ? (
          <div className="msg-bubble" style={{ color: 'var(--amber)' }}>需要你确认一下 ↓</div>
        ) : (
          m.streaming && <div className="msg-bubble" style={{ color: 'var(--muted)' }}>思考中<span className="cursor" /></div>
        )}
        {m.error && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--danger)' }}>回答生成失败，请重试。</div>}
        {hasSrc && (
          <div className="src-wrap">
            <button className="src-toggle" onClick={() => setShowSrc((v) => !v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 3v12M6 9l6 6 6-6" />
              </svg>
              {showSrc ? '收起来源' : '查看检索来源'}
            </button>
            {showSrc && m.sources.map((s, i) => <SourceBlock key={i} src={s} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function UserMessage({ m }) {
  return (
    <div className="msg user">
      <div className="msg-body">
        <div className="msg-bubble">{m.content}</div>
      </div>
    </div>
  )
}

function HumanQuestionCard({ question, options, onAnswer, disabled }) {
  const [custom, setCustom] = useState('')
  return (
    <div className="ask-card">
      <div className="ask-card-head">
        <span className="ask-card-icon">?</span>
        <span>智能体需要你确认一下</span>
      </div>
      <div className="ask-card-q">{question}</div>
      <div className="ask-card-opts">
        {options.map((o, i) => (
          <button key={i} className="ask-opt" disabled={disabled} onClick={() => onAnswer(o)}>{o}</button>
        ))}
      </div>
      <form className="ask-card-custom" onSubmit={(e) => {
        e.preventDefault()
        if (custom.trim()) { onAnswer(custom.trim()); setCustom('') }
      }}>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="或输入你自己的回答…"
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !custom.trim()}>发送</button>
      </form>
      <div className="ask-card-hint">你的回答会交回智能体，它将继续完成刚才的任务。</div>
    </div>
  )
}

function Welcome({ onSuggest }) {
  const suggests = [
    '我上传的文档里，主要讲了什么内容？',
    '帮我总结一下文档中的关键条款',
    '文档里提到的交付周期是多久？',
    '什么是 RAG？为什么回答能引用来源？',
  ]
  return (
    <div className="welcome">
      <div className="w-icon">
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
          <path d="M8 21 L16 8 L24 21" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1>向你的<em>文档</em>提问</h1>
      <p>左侧上传 PDF / DOCX / TXT，然后问任何关于文档的问题。<br />回答会标注检索来源，随时可以点开核对原文。</p>
      <div className="w-suggests">
        {suggests.map((s) => (
          <button key={s} className="w-chip" onClick={() => onSuggest(s)}>{s}</button>
        ))}
      </div>
    </div>
  )
}

export default function ChatArea({
  messages,
  onSuggest,
  canAct,
  onEdit,
  onSupplement,
  onResend,
  editMode,
  editText,
  onEditTextChange,
  onCommit,
  onCancel,
  pendingQuestion,
  onAnswerQuestion,
}) {
  const scrollRef = useRef(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, editMode, pendingQuestion])

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-inner">
        {messages.length === 0 ? (
          <Welcome onSuggest={onSuggest} />
        ) : (
          messages.map((m) => (m.role === 'user' ? <UserMessage key={m.key} m={m} /> : <AiMessage key={m.key} m={m} />))
        )}

        {pendingQuestion && (
          <HumanQuestionCard
            question={pendingQuestion.question}
            options={pendingQuestion.options}
            onAnswer={onAnswerQuestion}
          />
        )}

        {canAct && !editMode && !pendingQuestion && (
          <div className="msg-actions">
            <button className="act-btn" onClick={onEdit}>✏️ 编辑后重发</button>
            <button className="act-btn" onClick={onSupplement}>➕ 补充后重发</button>
            <button className="act-btn" onClick={onResend}>🔁 重发</button>
          </div>
        )}

        {editMode && (
          <div className="edit-panel">
            <div className="edit-title">
              {editMode === 'edit' ? '✏️ 编辑问题后重发（将替换上一个问题）' : '➕ 在上一问基础上补充说明'}
            </div>
            <textarea
              className="edit-input"
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              rows={3}
              placeholder={editMode === 'edit' ? '修改你的问题…' : '补充内容…'}
              autoFocus
            />
            <div className="edit-btns">
              <button className="act-btn primary" onClick={() => onCommit(editText)} disabled={!editText.trim()}>🚀 重发</button>
              <button className="act-btn" onClick={onCancel}>取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}