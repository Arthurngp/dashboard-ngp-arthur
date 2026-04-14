'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { metaCall } from '@/lib/meta'
import { parseIns, fmt, fmtN, fmtI } from '@/lib/utils'
import { SURL, ANON } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { Campaign, DateParam, Relatorio } from '@/types'
import PeriodFilter from '@/components/PeriodFilter'
import styles from './cliente.module.css'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function ClientePage() {
  const router = useRouter()
  const [sess] = useState(getSession)
  const [campaigns, setCampaigns]   = useState<Campaign[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [periodLabel, setPeriodLabel] = useState('Últimos 30 dias')
  const [openCards, setOpenCards]   = useState<Set<string>>(new Set())
  const [relatorios, setRelatorios] = useState<Relatorio[]>([])

  useEffect(() => {
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'cliente')    { router.replace('/dashboard'); return }
    loadAll({ date_preset: 'last_30d' })
    loadRelatorios()
  }, [])

  const loadAll = useCallback(async (dp: DateParam) => {
    setLoading(true); setError('')
    try {
      const d = await metaCall('{account_id}/campaigns', {
        fields: 'id,name,status,objective,insights{spend,impressions,clicks,ctr,cpc,actions,action_values,purchase_roas}',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '100',
        ...dp,
      })
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error))
      setCampaigns(
        (d.data || []).map((c: { id: string; name: string; status: string; objective: string; insights?: { data?: unknown[] } }) => ({
          id: c.id, name: c.name, status: c.status,
          objective: (c.objective || '').replace(/_/g, ' ').toLowerCase(),
          ...parseIns(c.insights?.data?.[0] as Record<string, unknown> || {}),
        }))
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados')
    }
    setLoading(false)
  }, [])

  async function loadRelatorios() {
    const s = getSession()
    if (!s) return
    try {
      const res = await fetch(
        `${SURL}/rest/v1/relatorios?cliente_username=eq.${encodeURIComponent(s.username)}&select=id,titulo,periodo,updated_at&order=updated_at.desc&limit=20`,
        { headers: { apikey: ANON, Authorization: `Bearer ${s.session}` } }
      )
      if (res.ok) setRelatorios(await res.json())
    } catch {}
  }

  async function deleteRelatorio(id: string) {
    if (!confirm('Remover este relatório?')) return
    const s = getSession()
    await fetch(`${SURL}/functions/v1/delete-relatorio`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ session_token: s?.session, id }),
    }).catch(() => {})
    setRelatorios(prev => prev.filter(r => r.id !== id))
  }

  function onPeriodApply(dp: DateParam, label: string) {
    setPeriodLabel(label); loadAll(dp)
  }

  function toggleCard(id: string) {
    setOpenCards(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  function logout() {
    const s = getSession()
    fetch(`${SURL}/functions/v1/logout`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ token: s?.session }),
    }).catch(() => {})
    clearSession(); router.replace('/login')
  }

  const tSpend  = campaigns.reduce((s, c) => s + c.spend, 0)
  const tImp    = campaigns.reduce((s, c) => s + c.impressions, 0)
  const tClk    = campaigns.reduce((s, c) => s + c.clicks, 0)
  const tConv   = campaigns.reduce((s, c) => s + c.conversations, 0)
  const tLeads  = campaigns.reduce((s, c) => s + c.leads, 0)
  const tPur    = campaigns.reduce((s, c) => s + c.purchases, 0)
  const avgCtr  = tImp > 0 ? (tClk / tImp * 100) : 0
  const results = tConv || tLeads || tPur
  const resLabel = tConv ? ' conv' : tLeads ? ' leads' : ' compras'

  if (!sess) return null

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", background: '#f4f6fa', minHeight: '100vh' }}>

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>NGP <span>Dashboard</span></div>
          <div className={styles.clienteBadge}>👤 Área do Cliente</div>
        </div>
        <div className={styles.headerRight}>
          <PeriodFilter onApply={onPeriodApply} />
          <div className={styles.userPill} onClick={() => router.push('/perfil')} style={{ cursor: 'pointer' }}>
            <div className={styles.userDot}>{(sess.user || 'CL').slice(0, 2).toUpperCase()}</div>
            <span className={styles.userName}>{sess.user}</span>
          </div>
          <button className={styles.btnLogout} onClick={logout}>Sair</button>
        </div>
      </header>

      <div className={styles.content}>

        {/* WELCOME */}
        <div className={styles.welcome}>
          <h1>Olá, {sess.user}! 👋</h1>
          <p>Aqui estão os resultados das suas campanhas no período: <span className={styles.period}>{periodLabel}</span></p>
        </div>

        {/* EXPLAINER */}
        <div className={styles.explainer}>
          💡 <strong>Como ler este painel:</strong> <strong>Investido</strong> = quanto foi gasto nos anúncios. <strong>Impressões</strong> = quantas vezes seu anúncio foi exibido. <strong>Cliques</strong> = quantas pessoas clicaram. <strong>CTR</strong> = % de pessoas que clicaram após ver o anúncio. <strong>Conversas/Leads/Compras</strong> = resultados gerados. <strong>ROAS</strong> = retorno por real investido.
        </div>

        {/* KPIs */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#FFF3F3' }}>💰</div><div className={styles.kpiLabel}>Investido</div><div className={styles.kpiValue}>R$ {fmt(tSpend)}</div><div className={styles.kpiTip}>Total gasto em anúncios no período</div></div>
          <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#f0fdf4' }}>🎯</div><div className={styles.kpiLabel}>Resultados</div><div className={styles.kpiValue}>{fmtN(results)}{resLabel}</div><div className={styles.kpiTip}>Conversas, leads ou compras geradas</div></div>
          <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#f5f3ff' }}>👁️</div><div className={styles.kpiLabel}>Impressões</div><div className={styles.kpiValue}>{fmtI(tImp)}</div><div className={styles.kpiTip}>Vezes que seu anúncio foi exibido</div></div>
          <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#fffbeb' }}>📈</div><div className={styles.kpiLabel}>CTR médio</div><div className={styles.kpiValue}>{avgCtr.toFixed(2)}%</div><div className={styles.kpiTip}>% de pessoas que clicaram no anúncio</div></div>
        </div>

        {/* CAMPANHAS */}
        <div className={styles.sectionTitle}>📋 Suas Campanhas <span className={styles.count}>{campaigns.length} campanhas</span></div>

        {loading && <div className={styles.loadingState}><div className={styles.spinner} /><p>Carregando suas campanhas...</p></div>}
        {error   && <div className={styles.errorState}>⚠️ {error}</div>}

        {!loading && !error && (
          <div className={styles.campList}>
            {campaigns.length === 0 && <div className={styles.empty}>Nenhuma campanha encontrada neste período.</div>}
            {campaigns.map(c => (
              <div key={c.id} className={`${styles.campCard} ${openCards.has(c.id) ? styles.open : ''}`}>
                <div className={styles.campHeader} onClick={() => toggleCard(c.id)}>
                  <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                  <div style={{ flex: 1 }}>
                    <div className={styles.campName}>{c.name}</div>
                    <div className={styles.campObj}>{c.objective}</div>
                  </div>
                  <span className={`${styles.statusPill} ${c.status === 'ACTIVE' ? styles.statusActive : styles.statusPaused}`}>
                    {c.status === 'ACTIVE' ? 'Ativa' : 'Pausada'}
                  </span>
                </div>
                {openCards.has(c.id) && (
                  <div className={styles.campMetrics}>
                    <Chip label="Investido"  value={`R$ ${fmt(c.spend)}`} />
                    <Chip label="Impressões" value={fmtI(c.impressions)} />
                    <Chip label="Cliques"    value={fmtN(c.clicks)} />
                    <Chip label="CTR"        value={`${c.ctr.toFixed(2)}%`} />
                    <Chip label="CPC"        value={`R$ ${fmt(c.cpc)}`} />
                    {c.conversations > 0 && <Chip label="Conversas" value={fmtN(c.conversations)} />}
                    {c.leads > 0        && <Chip label="Leads"     value={fmtN(c.leads)} />}
                    {c.purchases > 0    && <Chip label="Compras"   value={fmtN(c.purchases)} />}
                    {c.roas > 0         && <Chip label="ROAS"      value={`${c.roas.toFixed(2)}x`} cls="purple" />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* RELATÓRIOS */}
        {relatorios.length > 0 && (
          <>
            <div className={styles.sectionTitle} style={{ marginTop: 32 }}>
              📄 Relatórios <span className={styles.count}>{relatorios.length}</span>
            </div>
            <div className={styles.reportList}>
              {relatorios.map(r => (
                <div key={r.id} className={styles.reportCard}>
                  <div className={styles.reportIcon}>📄</div>
                  <div className={styles.reportInfo}>
                    <div className={styles.reportTitle}>{r.titulo}</div>
                    <div className={styles.reportMeta}>{r.periodo} · {fmtDate(r.updated_at)}</div>
                  </div>
                  <div className={styles.reportActions}>
                    <button className={styles.btnOpen} onClick={() => window.open(`/relatorio?id=${r.id}`, '_blank')}>Abrir →</button>
                    <button className={styles.btnDel} onClick={() => deleteRelatorio(r.id)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  )
}

function Chip({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div style={{ background: '#f4f6fa', border: '1px solid #e8ecf3', borderRadius: 8, padding: '8px 12px', minWidth: 100 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: cls === 'purple' ? '#7c3aed' : '#1a1d2e' }}>{value}</div>
    </div>
  )
}
