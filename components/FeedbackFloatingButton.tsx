'use client'

import { useState, useEffect } from 'react'
import { MessageSquarePlus, X, Send, ChevronDown } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'

const TIPOS = [
  { value: 'bug',      label: '🐛 Bug' },
  { value: 'erro',     label: '❌ Erro' },
  { value: 'sugestao', label: '💡 Sugestão' },
  { value: 'duvida',   label: '❓ Dúvida' },
  { value: 'outro',    label: '💬 Outro' },
]

export default function FeedbackFloatingButton() {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState('outro')
  const [mensagem, setMensagem] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Só mostra se estiver autenticado
    setVisible(!!getSession())
  }, [])

  if (!visible) return null

  function handleOpen() {
    setOpen(true)
    setSent(false)
    setError('')
    setMensagem('')
    setTipo('outro')
  }

  function handleClose() {
    setOpen(false)
  }

  async function handleSubmit() {
    if (!mensagem.trim()) {
      setError('Escreva sua mensagem antes de enviar.')
      return
    }
    setSending(true)
    setError('')

    const res = await efCall('feedback-submit', {
      tipo,
      mensagem,
      pagina_url: typeof window !== 'undefined' ? window.location.pathname : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })

    setSending(false)

    if (res.error) {
      setError(String(res.error))
    } else {
      setSent(true)
      setTimeout(() => setOpen(false), 2500)
    }
  }

  return (
    <>
      {/* Botão flutuante */}
      {!open && (
        <button
          onClick={handleOpen}
          title="Enviar feedback, reportar bug ou sugestão"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(99, 102, 241, 0.5)',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.1)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(99, 102, 241, 0.65)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.5)'
          }}
        >
          <MessageSquarePlus size={22} color="#fff" />
        </button>
      )}

      {/* Modal flutuante */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            width: '340px',
            background: '#1a1a2e',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '16px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquarePlus size={18} color="#fff" />
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>
                Feedback / Bug / Sugestão
              </span>
            </div>
            <button
              onClick={handleClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
            >
              <X size={18} color="rgba(255,255,255,0.8)" />
            </button>
          </div>

          {/* Conteúdo */}
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sent ? (
              <div style={{
                textAlign: 'center',
                padding: '24px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
              }}>
                <div style={{ fontSize: '36px' }}>✅</div>
                <p style={{ color: '#a5b4fc', fontSize: '14px', margin: 0 }}>
                  Feedback enviado! Obrigado.
                </p>
              </div>
            ) : (
              <>
                {/* Select tipo */}
                <div style={{ position: 'relative' }}>
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 32px 9px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(99,102,241,0.3)',
                      background: '#0f0f1a',
                      color: '#e2e8f0',
                      fontSize: '13px',
                      appearance: 'none',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {TIPOS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    color="#6366f1"
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                  />
                </div>

                {/* Textarea */}
                <textarea
                  value={mensagem}
                  onChange={e => { setMensagem(e.target.value); setError('') }}
                  placeholder="Descreva o problema, sugestão ou dúvida..."
                  rows={5}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: error ? '1px solid #f87171' : '1px solid rgba(99,102,241,0.3)',
                    background: '#0f0f1a',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    resize: 'none',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    lineHeight: '1.5',
                  }}
                />

                {error && (
                  <p style={{ color: '#f87171', fontSize: '12px', margin: 0 }}>{error}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={sending}
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: sending ? '#4b4b6a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: sending ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'opacity 0.15s',
                  }}
                >
                  <Send size={14} />
                  {sending ? 'Enviando...' : 'Enviar'}
                </button>

                <p style={{ color: '#4b5563', fontSize: '11px', margin: 0, textAlign: 'center' }}>
                  A página atual é capturada automaticamente.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
