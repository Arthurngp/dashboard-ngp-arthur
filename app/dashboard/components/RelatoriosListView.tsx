'use client'

import { useMemo, useState } from 'react'
import type { Cliente } from '@/types'
import { fmtDate } from '../dashboard-utils'

interface Props {
  relatorios: any[]
  loading: boolean
  page: number
  perPage: number
  onPageChange: (p: number) => void
  onRefresh: () => void
  onDelete: (id: string) => void
  onNew: () => void
  clients: Cliente[]
}

export default function RelatoriosListView({ relatorios, loading, page, perPage, onPageChange, onRefresh, onDelete, onNew, clients }: Props) {
  const [search, setSearch] = useState('')

  const clienteIndex = useMemo(() => {
    const m = new Map<string, string>()
    clients.forEach(c => { if (c.id && c.nome) m.set(c.id, c.nome) })
    return m
  }, [clients])

  function clienteLabel(r: any): string {
    if (r.cliente_id && clienteIndex.has(r.cliente_id)) return clienteIndex.get(r.cliente_id) as string
    if (r.cliente_username) return r.cliente_username
    return '—'
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return relatorios
    return relatorios.filter(r =>
      (r.titulo || '').toLowerCase().includes(q) ||
      (r.periodo || '').toLowerCase().includes(q) ||
      clienteLabel(r).toLowerCase().includes(q),
    )
  }, [relatorios, search, clienteIndex])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * perPage
  const slice = filtered.slice(start, start + perPage)

  return (
    <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '1px solid rgba(191,219,254,.6)', boxShadow: '0 18px 48px rgba(15,23,42,.06)', fontFamily: 'Sora,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#2563eb', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>Relatórios & Dados</div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: '-.02em' }}>Todos os relatórios</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>{filtered.length} relatório(s) {search && `· filtro "${search}"`}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); onPageChange(1) }}
            placeholder="Buscar por cliente, título, período…"
            style={{ minWidth: 220, padding: '9px 12px', border: '1.5px solid #E5E5EA', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          />
          <button onClick={onRefresh} disabled={loading} style={{ padding: '9px 14px', border: '1.5px solid #E5E5EA', background: '#fff', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#3A3A3C' }}>↻ Atualizar</button>
          <button onClick={onNew} style={{ padding: '9px 14px', border: 'none', background: '#2563eb', color: '#fff', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Novo relatório</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', fontSize: 13 }}>Carregando…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#AEAEB2', fontSize: 13, background: '#FAFAFA', borderRadius: 14 }}>
          {search ? `Nenhum relatório encontrado para "${search}".` : 'Nenhum relatório criado ainda.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slice.map((r: any) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: '#fff', border: '1px solid #EEF2F7', borderRadius: 12, transition: 'border-color .15s,background .15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#bfdbfe'; e.currentTarget.style.background = '#f8fbff' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#EEF2F7'; e.currentTarget.style.background = '#fff' }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                  {r.dados?.tipo === 'v2' ? '✦' : '📄'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                    {r.titulo || '(sem título)'}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>👤 {clienteLabel(r)}</span>
                    {r.periodo && <span>📅 {r.periodo}</span>}
                    <span>{fmtDate(r.updated_at)}</span>
                  </div>
                </div>
                {r.dados?.tipo === 'v2' && <span style={{ background: '#0f172a', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, flexShrink: 0, letterSpacing: '.05em' }}>PRO</span>}
                <button onClick={() => window.open(`/relatorio?id=${r.id}`, '_blank')} style={{ padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Abrir →</button>
                <button onClick={() => onDelete(r.id)} title="Apagar" style={{ background: 'none', border: '1px solid #E5E5EA', borderRadius: 8, padding: '7px 10px', fontSize: 13, cursor: 'pointer', color: '#AEAEB2', flexShrink: 0 }}>🗑</button>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingTop: 16, borderTop: '1px solid #EEF2F7' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Página {safePage} de {totalPages} · mostrando {start + 1}–{Math.min(start + perPage, filtered.length)} de {filtered.length}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1} style={pageBtn(safePage <= 1)}>← Anterior</button>
                {pageNumbers(safePage, totalPages).map((n, i) =>
                  n === '…' ? (
                    <span key={`gap-${i}`} style={{ padding: '6px 8px', color: '#AEAEB2' }}>…</span>
                  ) : (
                    <button key={n} onClick={() => onPageChange(n as number)} style={pageBtn(false, n === safePage)}>{n}</button>
                  ),
                )}
                <button onClick={() => onPageChange(safePage + 1)} disabled={safePage >= totalPages} style={pageBtn(safePage >= totalPages)}>Próxima →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function pageBtn(disabled: boolean, active = false): React.CSSProperties {
  return {
    minWidth: 32, padding: '6px 10px',
    border: active ? 'none' : '1.5px solid #E5E5EA',
    background: active ? '#2563eb' : '#fff',
    color: active ? '#fff' : '#3A3A3C',
    borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? .4 : 1,
    fontFamily: 'inherit',
  }
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  if (current > 3) pages.push('…')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}
