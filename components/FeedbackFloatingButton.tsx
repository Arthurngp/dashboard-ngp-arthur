'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X, Send, ChevronDown, ImagePlus, Trash2 } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'

const TIPOS = [
  { value: 'bug',      label: '🐛 Bug',          desc: 'Algo está quebrado' },
  { value: 'erro',     label: '❌ Erro',         desc: 'Mensagem de erro' },
  { value: 'sugestao', label: '💡 Sugestão',     desc: 'Ideia ou melhoria' },
  { value: 'duvida',   label: '❓ Dúvida',       desc: 'Não sei como usar' },
  { value: 'outro',    label: '💬 Outro',        desc: 'Comentário geral' },
]

const PRIORIDADES = [
  { value: 'baixa',   label: 'Baixa',    color: '#64748b' },
  { value: 'media',   label: 'Média',    color: '#f59e0b' },
  { value: 'alta',    label: 'Alta',     color: '#f97316' },
  { value: 'critica', label: 'Crítica',  color: '#ef4444' },
]

const MAX_BYTES = 5 * 1024 * 1024

async function fileToBase64(file: File): Promise<{ data: string; mime: string }> {
  const buf = await file.arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return { data: btoa(bin), mime: file.type || 'image/png' }
}

// Rotas onde o botão NÃO deve aparecer (usuário ainda não logou)
const HIDDEN_PATHS = ['/login', '/']

// Evento global pra abrir o modal de feedback a partir de outro componente
// (ex.: link "Reportar bug" dentro do ChatFloatingButton).
export const FEEDBACK_OPEN_EVENT = 'ngp:open-feedback-modal'

interface FeedbackFloatingButtonProps {
  /** Quando true, esconde o botão flutuante vermelho. O modal segue acessível via evento. */
  hideTrigger?: boolean
}

export default function FeedbackFloatingButton({ hideTrigger = false }: FeedbackFloatingButtonProps = {}) {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState('outro')
  const [prioridade, setPrioridade] = useState('media')
  const [titulo, setTitulo] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [screenshot, setScreenshot] = useState<{ data: string; mime: string; preview: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const check = () => setVisible(!!getSession())
    check()
    window.addEventListener('storage', check)
    window.addEventListener('focus', check)
    return () => {
      window.removeEventListener('storage', check)
      window.removeEventListener('focus', check)
    }
  }, [pathname])

  // Cola direto do clipboard quando o modal está aberto
  useEffect(() => {
    if (!open) return
    const onPaste = async (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile()
      if (!file) return
      await handleFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  // Permite abrir o modal a partir de outros componentes (ex.: painel do chat)
  useEffect(() => {
    const onExternal = () => handleOpen()
    window.addEventListener(FEEDBACK_OPEN_EVENT, onExternal)
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onExternal)
  }, [])

  if (!visible) return null
  if (HIDDEN_PATHS.includes(pathname)) return null

  function reset() {
    setSent(false)
    setError('')
    setMensagem('')
    setTitulo('')
    setTipo('outro')
    setPrioridade('media')
    setScreenshot(null)
  }

  function handleOpen() {
    reset()
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Apenas imagens são permitidas.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Imagem maior que 5MB.')
      return
    }
    setError('')
    const { data, mime } = await fileToBase64(file)
    const preview = URL.createObjectURL(file)
    setScreenshot({ data, mime, preview })
  }

  async function handleSubmit() {
    if (!mensagem.trim()) {
      setError('Escreva sua mensagem antes de enviar.')
      return
    }
    setSending(true)
    setError('')

    const res = await efCall('feedback-submit', {
      titulo: titulo.trim() || null,
      tipo,
      prioridade,
      mensagem,
      pagina_url: typeof window !== 'undefined' ? window.location.pathname : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      screenshot_base64: screenshot?.data ?? null,
      screenshot_mime:   screenshot?.mime ?? null,
    })

    setSending(false)

    if (res.error) {
      setError(String(res.error))
    } else {
      setSent(true)
      setTimeout(() => setOpen(false), 2200)
    }
  }

  const tipoMeta       = TIPOS.find(t => t.value === tipo) ?? TIPOS[0]
  const prioridadeMeta = PRIORIDADES.find(p => p.value === prioridade) ?? PRIORIDADES[1]

  return (
    <>
      {/* Botão flutuante */}
      {!open && !hideTrigger && (
        <button
          onClick={handleOpen}
          title="Enviar feedback, reportar bug ou sugestão"
          aria-label="Enviar feedback"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #CC1414, #8b0e0e)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 24px rgba(204, 20, 20, 0.45)',
            transition: 'transform 0.18s ease, box-shadow 0.18s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 30px rgba(204, 20, 20, 0.65)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(204, 20, 20, 0.45)'
          }}
        >
          <MessageSquarePlus size={22} color="#fff" />
        </button>
      )}

      {/* Modal */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            width: '380px',
            maxHeight: 'calc(100vh - 48px)',
            background: '#111318',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
            boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: "'Sora', sans-serif",
            animation: 'feedbackModalIn 0.18s ease-out',
          }}
        >
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #CC1414, #7a0c0c)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquarePlus size={18} color="#fff" />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '14px', letterSpacing: '0.01em' }}>
                Enviar feedback
              </span>
            </div>
            <button
              onClick={handleClose}
              aria-label="Fechar"
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px', borderRadius: '6px' }}
            >
              <X size={16} color="#fff" />
            </button>
          </div>

          {/* Corpo (scrolla se exceder) */}
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
            {sent ? (
              <div style={{
                textAlign: 'center', padding: '32px 0',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
              }}>
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  background: 'rgba(22,163,74,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '28px',
                }}>✅</div>
                <p style={{ color: '#f0f2f5', fontSize: '14px', margin: 0, fontWeight: 600 }}>
                  Feedback enviado!
                </p>
                <p style={{ color: '#8b92a5', fontSize: '12px', margin: 0 }}>
                  Obrigado por nos ajudar a melhorar o NGP Space.
                </p>
              </div>
            ) : (
              <>
                {/* Tipo + Prioridade */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={labelStyle}>Tipo</label>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={tipo}
                        onChange={e => setTipo(e.target.value)}
                        style={selectStyle}
                      >
                        {TIPOS.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} color="#8b92a5" style={chevronStyle} />
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Prioridade</label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {PRIORIDADES.map(p => {
                        const active = prioridade === p.value
                        return (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() => setPrioridade(p.value)}
                            title={p.label}
                            style={{
                              flex: 1,
                              padding: '8px 4px',
                              borderRadius: '6px',
                              border: `1px solid ${active ? p.color : 'rgba(255,255,255,0.08)'}`,
                              background: active ? `${p.color}22` : '#0b0d11',
                              color: active ? p.color : '#8b92a5',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            {p.label.charAt(0)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: '11px', color: '#8b92a5', margin: 0, marginTop: '-4px' }}>
                  {tipoMeta.desc} · prioridade <span style={{ color: prioridadeMeta.color, fontWeight: 700 }}>{prioridadeMeta.label.toLowerCase()}</span>
                </p>

                {/* Título */}
                <div>
                  <label style={labelStyle}>Título <span style={{ color: '#4a5168', fontWeight: 400 }}>(opcional)</span></label>
                  <input
                    type="text"
                    value={titulo}
                    onChange={e => setTitulo(e.target.value)}
                    placeholder="Resumo curto do problema..."
                    maxLength={140}
                    style={inputStyle}
                  />
                </div>

                {/* Mensagem */}
                <div>
                  <label style={labelStyle}>Descrição</label>
                  <textarea
                    value={mensagem}
                    onChange={e => { setMensagem(e.target.value); setError('') }}
                    placeholder="Descreva o problema, sugestão ou dúvida com detalhes..."
                    rows={5}
                    style={{
                      ...inputStyle,
                      resize: 'vertical',
                      minHeight: '90px',
                      lineHeight: '1.5',
                      borderColor: error ? 'rgba(248,113,113,0.55)' : 'rgba(255,255,255,0.08)',
                    }}
                  />
                </div>

                {/* Screenshot */}
                {screenshot ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px', borderRadius: '8px',
                    background: '#0b0d11', border: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    <img
                      src={screenshot.preview}
                      alt="prévia"
                      style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px' }}
                    />
                    <div style={{ flex: 1, fontSize: '12px', color: '#d9dde6' }}>
                      Imagem anexada
                      <div style={{ color: '#8b92a5', fontSize: '11px' }}>{screenshot.mime}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScreenshot(null)}
                      aria-label="Remover anexo"
                      style={{
                        background: 'rgba(248,113,113,0.12)', border: 'none',
                        color: '#f87171', borderRadius: '6px', padding: '6px',
                        cursor: 'pointer', display: 'flex',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px dashed rgba(255,255,255,0.15)',
                      background: 'transparent',
                      color: '#8b92a5',
                      fontSize: '12px',
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(204,20,20,0.45)'
                      ;(e.currentTarget as HTMLButtonElement).style.color = '#f0f2f5'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.15)'
                      ;(e.currentTarget as HTMLButtonElement).style.color = '#8b92a5'
                    }}
                  >
                    <ImagePlus size={14} />
                    Anexar print (ou cole com Ctrl+V)
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                    e.target.value = ''
                  }}
                />

                {error && (
                  <p style={{ color: '#f87171', fontSize: '12px', margin: 0 }}>{error}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={sending}
                  style={{
                    padding: '11px',
                    borderRadius: '8px',
                    background: sending ? '#3a3d45' : 'linear-gradient(135deg, #CC1414, #8b0e0e)',
                    border: 'none',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 700,
                    fontFamily: 'inherit',
                    cursor: sending ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'opacity 0.15s',
                  }}
                >
                  <Send size={14} />
                  {sending ? 'Enviando...' : 'Enviar feedback'}
                </button>

                <p style={{ color: '#4a5168', fontSize: '11px', margin: 0, textAlign: 'center' }}>
                  A página atual é capturada automaticamente.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes feedbackModalIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#8b92a5',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  display: 'block',
  marginBottom: '6px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: '#0b0d11',
  color: '#f0f2f5',
  fontSize: '13px',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight: '28px',
  appearance: 'none',
  cursor: 'pointer',
}

const chevronStyle: React.CSSProperties = {
  position: 'absolute',
  right: '8px',
  top: '50%',
  transform: 'translateY(-50%)',
  pointerEvents: 'none',
}
