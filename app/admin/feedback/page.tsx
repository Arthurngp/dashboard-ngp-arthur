'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import { MessageSquarePlus, RefreshCw, ChevronDown } from 'lucide-react'

interface FeedbackItem {
  id: string
  created_at: string
  usuario_nome: string | null
  usuario_role: string | null
  tipo: string
  mensagem: string
  pagina_url: string | null
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
  novo: '#6366f1',
  em_andamento: '#f59e0b',
  resolvido: '#10b981',
  descartado: '#6b7280',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function FeedbackAdminPage() {
  const router = useRouter()
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [selected, setSelected] = useState<FeedbackItem | null>(null)
  const [resposta, setResposta] = useState('')
  const [novoStatus, setNovoStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const session = getSession()

  useEffect(() => {
    if (!session || session.role !== 'admin') {
      router.push('/')
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await efCall('feedback-admin', { action: 'list' })
    setLoading(false)
    if (res.feedbacks) setFeedbacks(res.feedbacks as FeedbackItem[])
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = feedbacks.filter(f => {
    if (filtroStatus !== 'todos' && f.status !== filtroStatus) return false
    if (filtroTipo !== 'todos' && f.tipo !== filtroTipo) return false
    return true
  })

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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a0a14', color: '#e2e8f0' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: '32px', maxWidth: '1200px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <MessageSquarePlus size={24} color="#6366f1" />
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Feedbacks dos Usuários</h1>
              {countNovos > 0 && (
                <p style={{ fontSize: '12px', color: '#6366f1', margin: 0, marginTop: '2px' }}>
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
              background: '#1a1a2e', border: '1px solid rgba(99,102,241,0.3)',
              color: '#a5b4fc', fontSize: '13px', cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Atualizar
          </button>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {[['todos', 'Todos os status'], ...Object.entries(STATUS_LABELS)].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFiltroStatus(v)}
              style={{
                padding: '6px 14px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                border: '1px solid',
                borderColor: filtroStatus === v ? '#6366f1' : 'rgba(99,102,241,0.2)',
                background: filtroStatus === v ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: filtroStatus === v ? '#a5b4fc' : '#6b7280',
              }}
            >
              {l}
            </button>
          ))}
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }} />
          {[['todos', 'Todos os tipos'], ...Object.entries(TIPO_LABELS)].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFiltroTipo(v)}
              style={{
                padding: '6px 14px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                border: '1px solid',
                borderColor: filtroTipo === v ? '#8b5cf6' : 'rgba(99,102,241,0.2)',
                background: filtroTipo === v ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: filtroTipo === v ? '#c4b5fd' : '#6b7280',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Layout lista + detalhe */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>

          {/* Lista */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            {loading && (
              <p style={{ color: '#4b5563', fontSize: '14px' }}>Carregando...</p>
            )}
            {!loading && filtered.length === 0 && (
              <p style={{ color: '#4b5563', fontSize: '14px' }}>Nenhum feedback encontrado.</p>
            )}
            {filtered.map(f => (
              <div
                key={f.id}
                onClick={() => openDetail(f)}
                style={{
                  padding: '14px 16px',
                  borderRadius: '10px',
                  background: selected?.id === f.id ? '#1a1a35' : '#111122',
                  border: `1px solid ${selected?.id === f.id ? '#6366f1' : 'rgba(99,102,241,0.15)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#a5b4fc' }}>{TIPO_LABELS[f.tipo] ?? f.tipo}</span>
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                      background: `${STATUS_COLORS[f.status]}22`,
                      color: STATUS_COLORS[f.status],
                      border: `1px solid ${STATUS_COLORS[f.status]}44`,
                    }}>
                      {STATUS_LABELS[f.status] ?? f.status}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#4b5563' }}>{formatDate(f.created_at)}</span>
                </div>
                <p style={{ fontSize: '13px', color: '#cbd5e1', margin: 0, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.mensagem}
                </p>
                <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#4b5563' }}>
                  <span>{f.usuario_nome ?? 'Desconhecido'} · {f.usuario_role ?? '-'}</span>
                  {f.pagina_url && <span>📍 {f.pagina_url}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Detalhe */}
          {selected && (
            <div style={{
              width: '360px', flexShrink: 0,
              background: '#111122',
              border: '1px solid rgba(99,102,241,0.2)',
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              position: 'sticky',
              top: '24px',
            }}>
              <div>
                <p style={{ fontSize: '11px', color: '#4b5563', margin: 0, marginBottom: '4px' }}>
                  {TIPO_LABELS[selected.tipo]} · {formatDate(selected.created_at)}
                </p>
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                  {selected.usuario_nome ?? 'Desconhecido'} ({selected.usuario_role ?? '-'})
                </p>
                {selected.pagina_url && (
                  <p style={{ fontSize: '11px', color: '#4b5563', margin: 0, marginTop: '4px' }}>
                    📍 {selected.pagina_url}
                  </p>
                )}
              </div>

              <div style={{
                padding: '12px',
                background: '#0a0a14',
                borderRadius: '8px',
                border: '1px solid rgba(99,102,241,0.1)',
              }}>
                <p style={{ fontSize: '13px', color: '#e2e8f0', margin: 0, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                  {selected.mensagem}
                </p>
              </div>

              {/* Status */}
              <div>
                <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '6px' }}>Status</label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={novoStatus}
                    onChange={e => setNovoStatus(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 28px 8px 10px',
                      borderRadius: '8px', border: '1px solid rgba(99,102,241,0.3)',
                      background: '#0a0a14', color: '#e2e8f0',
                      fontSize: '13px', appearance: 'none', cursor: 'pointer', outline: 'none',
                    }}
                  >
                    {Object.entries(STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} color="#6366f1" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                </div>
              </div>

              {/* Resposta */}
              <div>
                <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '6px' }}>
                  Resposta / anotação interna
                </label>
                <textarea
                  value={resposta}
                  onChange={e => setResposta(e.target.value)}
                  placeholder="Opcional..."
                  rows={4}
                  style={{
                    width: '100%', padding: '8px 10px',
                    borderRadius: '8px', border: '1px solid rgba(99,102,241,0.3)',
                    background: '#0a0a14', color: '#e2e8f0',
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
                  background: saving ? '#4b4b6a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  border: 'none', color: '#fff', fontSize: '13px', fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>

              {saveMsg && (
                <p style={{ fontSize: '12px', color: saveMsg === 'Salvo!' ? '#10b981' : '#f87171', margin: 0, textAlign: 'center' }}>
                  {saveMsg}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
