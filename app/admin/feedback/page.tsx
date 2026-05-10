'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import { MessageSquarePlus, RefreshCw, ChevronDown, Search, X, ExternalLink } from 'lucide-react'

interface FeedbackItem {
  id: string
  created_at: string
  usuario_id: string | null
  usuario_nome: string | null
  usuario_role: string | null
  usuario_foto: string | null
  titulo: string | null
  tipo: string
  prioridade: string
  mensagem: string
  pagina_url: string | null
  screenshot_url: string | null
  user_agent: string | null
  status: string
  resposta_admin: string | null
}

const TIPO_LABELS: Record<string, string> = {
  bug: '🐛 Bug',
  erro: '❌ Erro',
  sugestao: '💡 Sugestão',
  duvida: '❓ Dúvida',
  outro: '💬 Outro',
}

const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  em_andamento: 'Em andamento',
  resolvido: 'Resolvido',
  descartado: 'Descartado',
}

const STATUS_COLORS: Record<string, string> = {
  novo: '#CC1414',
  em_andamento: '#f59e0b',
  resolvido: '#16A34A',
  descartado: '#6b7280',
}

const PRIORIDADE_LABELS: Record<string, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
}

const PRIORIDADE_COLORS: Record<string, string> = {
  baixa: '#64748b',
  media: '#f59e0b',
  alta: '#f97316',
  critica: '#ef4444',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function Avatar({ nome, foto, size = 32 }: { nome: string | null; foto: string | null; size?: number }) {
  if (foto) {
    return (
      <img
        src={foto}
        alt={nome ?? 'Usuário'}
        style={{
          width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #CC1414, #7a0c0c)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
    }}>
      {getInitials(nome)}
    </div>
  )
}

export default function FeedbackAdminPage() {
  const router = useRouter()
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [busca, setBusca] = useState('')
  const [selected, setSelected] = useState<FeedbackItem | null>(null)
  const [resposta, setResposta] = useState('')
  const [novoStatus, setNovoStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [imageOpen, setImageOpen] = useState<string | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.role !== 'admin') {
      router.push('/')
    }
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await efCall('feedback-admin', { action: 'list' })
    setLoading(false)
    if (res.feedbacks) setFeedbacks(res.feedbacks as FeedbackItem[])
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => feedbacks.filter(f => {
    if (filtroStatus !== 'todos' && f.status !== filtroStatus) return false
    if (filtroTipo !== 'todos' && f.tipo !== filtroTipo) return false
    if (busca.trim()) {
      const q = busca.toLowerCase()
      const hay = [f.titulo, f.mensagem, f.usuario_nome, f.pagina_url].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [feedbacks, filtroStatus, filtroTipo, busca])

  function openDetail(f: FeedbackItem) {
    setSelected(f)
    setResposta(f.resposta_admin ?? '')
    setNovoStatus(f.status)
    setSaveMsg('')
  }

  async function salvar() {
    if (!selected) return
    setSaving(true)
    setSaveMsg('')
    const res = await efCall('feedback-admin', {
      action: 'update',
      feedback_id: selected.id,
      status: novoStatus,
      resposta_admin: resposta,
    })
    setSaving(false)
    if (res.ok) {
      setSaveMsg('Salvo!')
      setFeedbacks(prev => prev.map(f =>
        f.id === selected.id ? { ...f, status: novoStatus, resposta_admin: resposta } : f
      ))
      setSelected(prev => prev ? { ...prev, status: novoStatus, resposta_admin: resposta } : prev)
      setTimeout(() => setSaveMsg(''), 2000)
    } else {
      setSaveMsg(String(res.error) || 'Erro ao salvar.')
    }
  }

  const countNovos = feedbacks.filter(f => f.status === 'novo').length
  const countByTipo = useMemo(() => {
    const c: Record<string, number> = {}
    feedbacks.forEach(f => { c[f.tipo] = (c[f.tipo] ?? 0) + 1 })
    return c
  }, [feedbacks])

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: '#0a0b0d',
      color: '#f0f2f5',
      fontFamily: "'Sora', sans-serif",
    }}>
      <Sidebar />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px 64px' }}>
          <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: 'rgba(204,20,20,0.12)',
                  border: '1px solid rgba(204,20,20,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MessageSquarePlus size={20} color="#CC1414" />
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#4a5168', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Admin · Feedbacks
                  </div>
                  <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '2px 0 0', color: '#f0f2f5' }}>
                    Feedbacks dos usuários
                  </h1>
                  {countNovos > 0 && (
                    <p style={{ fontSize: '12px', color: '#CC1414', margin: '3px 0 0', fontWeight: 600 }}>
                      {countNovos} novo{countNovos > 1 ? 's' : ''} sem leitura
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={load}
                disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', borderRadius: '8px',
                  background: '#181c23', border: '1px solid rgba(255,255,255,0.07)',
                  color: '#d9dde6', fontSize: '13px', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <RefreshCw size={14} style={{ animation: loading ? 'feedbackSpin 1s linear infinite' : 'none' }} />
                Atualizar
              </button>
            </div>

            {/* Busca */}
            <div style={{ position: 'relative' }}>
              <Search size={14} color="#4a5168" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por título, mensagem, usuário ou página..."
                style={{
                  width: '100%', padding: '10px 36px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.07)',
                  background: '#111318',
                  color: '#f0f2f5',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              {busca && (
                <button
                  onClick={() => setBusca('')}
                  aria-label="Limpar busca"
                  style={{
                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#8b92a5', display: 'flex', padding: '4px',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filtros */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              {[['todos', 'Todos os status'], ...Object.entries(STATUS_LABELS)].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setFiltroStatus(v)}
                  style={chipStyle(filtroStatus === v, '#CC1414')}
                >
                  {l}
                </button>
              ))}
              <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)' }} />
              {[['todos', `Todos os tipos`], ...Object.entries(TIPO_LABELS)].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setFiltroTipo(v)}
                  style={chipStyle(filtroTipo === v, '#8b5cf6')}
                >
                  {l}{v !== 'todos' && countByTipo[v] ? ` · ${countByTipo[v]}` : ''}
                </button>
              ))}
            </div>

            {/* Layout lista + detalhe */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>

              {/* Lista */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                {loading && (
                  <p style={{ color: '#4a5168', fontSize: '14px' }}>Carregando...</p>
                )}
                {!loading && filtered.length === 0 && (
                  <div style={{
                    background: '#111318', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '12px', padding: '40px', textAlign: 'center',
                    color: '#4a5168', fontSize: '14px',
                  }}>
                    Nenhum feedback encontrado.
                  </div>
                )}
                {filtered.map(f => {
                  const isSel = selected?.id === f.id
                  return (
                    <div
                      key={f.id}
                      onClick={() => openDetail(f)}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        background: isSel ? '#181c23' : '#111318',
                        border: `1px solid ${isSel ? 'rgba(204,20,20,0.45)' : 'rgba(255,255,255,0.07)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        display: 'flex',
                        gap: '12px',
                      }}
                    >
                      <Avatar nome={f.usuario_nome} foto={f.usuario_foto} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: '#d9dde6', fontWeight: 600 }}>{TIPO_LABELS[f.tipo] ?? f.tipo}</span>
                            <span style={{
                              fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                              background: `${STATUS_COLORS[f.status]}1f`,
                              color: STATUS_COLORS[f.status],
                              border: `1px solid ${STATUS_COLORS[f.status]}55`,
                              fontWeight: 700,
                            }}>
                              {STATUS_LABELS[f.status] ?? f.status}
                            </span>
                            <span style={{
                              fontSize: '10px', padding: '2px 7px', borderRadius: '999px',
                              background: `${PRIORIDADE_COLORS[f.prioridade] ?? '#64748b'}1f`,
                              color: PRIORIDADE_COLORS[f.prioridade] ?? '#64748b',
                              fontWeight: 700,
                            }}>
                              {PRIORIDADE_LABELS[f.prioridade] ?? f.prioridade}
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: '#4a5168', flexShrink: 0 }}>{formatDate(f.created_at)}</span>
                        </div>

                        {f.titulo && (
                          <p style={{ fontSize: '13px', color: '#f0f2f5', margin: '2px 0 4px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.titulo}
                          </p>
                        )}

                        <p style={{
                          fontSize: '13px', color: f.titulo ? '#8b92a5' : '#d9dde6', margin: 0, marginBottom: '6px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {f.mensagem}
                        </p>

                        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#4a5168', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span>{f.usuario_nome ?? 'Desconhecido'} · {f.usuario_role ?? '-'}</span>
                          {f.pagina_url && <span>📍 {f.pagina_url}</span>}
                          {f.screenshot_url && <span style={{ color: '#8b5cf6' }}>📎 anexo</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Detalhe */}
              {selected && (
                <div style={{
                  width: '380px', flexShrink: 0,
                  background: '#111318',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  position: 'sticky',
                  top: 0,
                }}>
                  {/* Cabeçalho */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <Avatar nome={selected.usuario_nome} foto={selected.usuario_foto} size={42} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '13px', color: '#f0f2f5', margin: 0, fontWeight: 600 }}>
                        {selected.usuario_nome ?? 'Desconhecido'}
                      </p>
                      <p style={{ fontSize: '11px', color: '#8b92a5', margin: '2px 0 0' }}>
                        {selected.usuario_role ?? '-'} · {formatDate(selected.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Tags */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={tagStyle('#d9dde6', 'rgba(255,255,255,0.05)')}>
                      {TIPO_LABELS[selected.tipo] ?? selected.tipo}
                    </span>
                    <span style={tagStyle(PRIORIDADE_COLORS[selected.prioridade] ?? '#64748b', `${PRIORIDADE_COLORS[selected.prioridade] ?? '#64748b'}1f`)}>
                      Prioridade {PRIORIDADE_LABELS[selected.prioridade] ?? selected.prioridade}
                    </span>
                  </div>

                  {/* Título */}
                  {selected.titulo && (
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#f0f2f5', lineHeight: 1.4 }}>
                      {selected.titulo}
                    </div>
                  )}

                  {/* Mensagem */}
                  <div style={{
                    padding: '12px',
                    background: '#0b0d11',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <p style={{ fontSize: '13px', color: '#d9dde6', margin: 0, lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {selected.mensagem}
                    </p>
                  </div>

                  {/* Página */}
                  {selected.pagina_url && (
                    <div style={{ fontSize: '11px', color: '#8b92a5' }}>
                      📍 <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px', fontFamily: "'JetBrains Mono', monospace", color: '#d9dde6' }}>{selected.pagina_url}</code>
                    </div>
                  )}

                  {/* Screenshot */}
                  {selected.screenshot_url && (
                    <button
                      type="button"
                      onClick={() => setImageOpen(selected.screenshot_url)}
                      style={{
                        padding: 0, background: 'transparent', border: 'none', cursor: 'pointer',
                        borderRadius: '8px', overflow: 'hidden',
                      }}
                    >
                      <img
                        src={selected.screenshot_url}
                        alt="Screenshot do feedback"
                        style={{
                          width: '100%', maxHeight: '180px', objectFit: 'cover',
                          borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)',
                          display: 'block',
                        }}
                      />
                    </button>
                  )}

                  {/* Status */}
                  <div>
                    <label style={{ fontSize: '11px', color: '#8b92a5', display: 'block', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</label>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={novoStatus}
                        onChange={e => setNovoStatus(e.target.value)}
                        style={{
                          width: '100%', padding: '9px 28px 9px 11px',
                          borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)',
                          background: '#0b0d11', color: '#f0f2f5',
                          fontSize: '13px', appearance: 'none', cursor: 'pointer', outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      >
                        {Object.entries(STATUS_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} color="#8b92a5" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    </div>
                  </div>

                  {/* Resposta */}
                  <div>
                    <label style={{ fontSize: '11px', color: '#8b92a5', display: 'block', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Resposta interna
                    </label>
                    <textarea
                      value={resposta}
                      onChange={e => setResposta(e.target.value)}
                      placeholder="Anotação interna (opcional)..."
                      rows={4}
                      style={{
                        width: '100%', padding: '9px 11px',
                        borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)',
                        background: '#0b0d11', color: '#f0f2f5',
                        fontSize: '13px', resize: 'vertical', outline: 'none',
                        boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: '1.5',
                      }}
                    />
                  </div>

                  <button
                    onClick={salvar}
                    disabled={saving}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      background: saving ? '#3a3d45' : 'linear-gradient(135deg, #CC1414, #8b0e0e)',
                      border: 'none', color: '#fff', fontSize: '13px', fontWeight: 700,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {saving ? 'Salvando...' : 'Salvar alterações'}
                  </button>

                  {saveMsg && (
                    <p style={{ fontSize: '12px', color: saveMsg === 'Salvo!' ? '#4ade80' : '#f87171', margin: 0, textAlign: 'center' }}>
                      {saveMsg}
                    </p>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </main>

      {/* Lightbox simples para screenshot */}
      {imageOpen && (
        <div
          onClick={() => setImageOpen(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '32px', cursor: 'zoom-out',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setImageOpen(null) }}
            aria-label="Fechar"
            style={{
              position: 'absolute', top: '20px', right: '20px',
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px',
              padding: '8px', cursor: 'pointer', color: '#fff', display: 'flex',
            }}
          >
            <X size={18} />
          </button>
          <a
            href={imageOpen}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: '20px', right: '64px',
              background: 'rgba(255,255,255,0.1)', borderRadius: '8px',
              padding: '8px', color: '#fff', display: 'flex', textDecoration: 'none',
            }}
            aria-label="Abrir em nova aba"
          >
            <ExternalLink size={18} />
          </a>
          <img
            src={imageOpen}
            alt="Screenshot ampliado"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', borderRadius: '8px', cursor: 'default' }}
          />
        </div>
      )}

      <style>{`
        @keyframes feedbackSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}

function chipStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: '999px',
    fontSize: '12px',
    cursor: 'pointer',
    border: '1px solid',
    borderColor: active ? accent : 'rgba(255,255,255,0.08)',
    background: active ? `${accent}1f` : '#111318',
    color: active ? '#f0f2f5' : '#8b92a5',
    fontFamily: "'Sora', sans-serif",
    fontWeight: active ? 600 : 500,
    transition: 'all 0.15s',
  }
}

function tagStyle(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: '11px',
    padding: '3px 9px',
    borderRadius: '999px',
    background: bg,
    color,
    fontWeight: 700,
    border: `1px solid ${color}33`,
  }
}
