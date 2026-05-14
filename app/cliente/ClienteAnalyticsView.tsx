'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ProfileModal from '@/components/ProfileModal'
import Sidebar from '@/components/Sidebar'
import { getSession, clearSession } from '@/lib/auth'
import { metaCall } from '@/lib/meta'
import { parseIns, fmt, fmtN, fmtI } from '@/lib/utils'
import { SURL, ANON } from '@/lib/constants'
import { efCall, efHeaders } from '@/lib/api'
import { Campaign, DateParam, Relatorio } from '@/types'
import PeriodFilter from '@/components/PeriodFilter'
import MetaAnalysisPanel from '@/components/MetaAnalysisPanel'
import PresentMode from '@/app/dashboard/components/PresentMode'
import { buildClientPortalNav } from './client-nav'
import styles from './cliente.module.css'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function getDefaultComparisonForLast30() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const until = new Date(today.getTime() - 31 * 86400000)
  const since = new Date(until.getTime() - 29 * 86400000)
  const fmtIso = (date: Date) => date.toISOString().slice(0, 10)
  const fmtBrDate = (iso: string) => iso.split('-').reverse().join('/')
  const sinceIso = fmtIso(since)
  const untilIso = fmtIso(until)

  return {
    dp: { time_range: JSON.stringify({ since: sinceIso, until: untilIso }) },
    label: `${fmtBrDate(sinceIso)} – ${fmtBrDate(untilIso)}`,
  }
}

export default function ClienteAnalyticsView() {
  const router = useRouter()
  const [sess] = useState(getSession)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [prevCampaigns, setPrevCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<DateParam>({ date_preset: 'last_30d' })
  const [periodLabel, setPeriodLabel] = useState('Últimos 30 dias')
  const [comparisonLabel, setComparisonLabel] = useState('')
  const [openCards, setOpenCards] = useState<Set<string>>(new Set())
  // Apresentação nativa: estado só na sessão (não persiste no localStorage do cliente).
  const [presentMode, setPresentMode] = useState(false)
  const [presentLoading, setPresentLoading] = useState(false)
  const [selectedCampIds, setSelectedCampIds] = useState<Set<string>>(new Set())
  const [timeSeriesData, setTimeSeriesData] = useState<Array<{ date: string; spend: number; impressions: number; clicks: number; actions?: Array<{ action_type: string; value: string }> }>>([])
  const [relatorios, setRelatorios] = useState<Relatorio[]>([])
  const [accessChecked, setAccessChecked] = useState(false)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [reportsEnabled, setReportsEnabled] = useState(false)
  const [crmEnabled, setCrmEnabled] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'cliente') { router.replace('/dashboard'); return }
    validateAccess()
  }, [])

  async function validateAccess() {
    const s = getSession()
    if (!s) return
    try {
      const res = await fetch(`${SURL}/functions/v1/cliente-portal-access`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      const canAccess = !!data.access?.analytics_enabled || !!data.access?.reports_enabled
      if (!res.ok || data.error || !canAccess) {
        router.replace('/cliente')
        return
      }
      const analytics = !!data.access?.analytics_enabled
      const reports = !!data.access?.reports_enabled
      const crm = !!data.access?.crm_enabled
      setAnalyticsEnabled(analytics)
      setReportsEnabled(reports)
      setCrmEnabled(crm)
      if (analytics) {
        const defaultComparison = getDefaultComparisonForLast30()
        loadAll({ date_preset: 'last_30d' }, defaultComparison.dp, defaultComparison.label)
      }
      else setLoading(false)
      if (reports) loadRelatorios()
    } catch {
      router.replace('/cliente')
      return
    } finally {
      setAccessChecked(true)
    }
  }

  const loadCampaigns = useCallback(async (dp: DateParam) => {
    const data = await metaCall('{account_id}/campaigns', {
      fields: 'id,name,status,objective,insights{spend,impressions,clicks,ctr,cpc,reach,actions,action_values,purchase_roas}',
      filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
      limit: '100',
      ...dp,
    })
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))

    return (data.data || []).map((campaign: { id: string; name: string; status: string; objective: string; insights?: { data?: unknown[] } }) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: (campaign.objective || '').replace(/_/g, ' ').toLowerCase(),
      ...parseIns(campaign.insights?.data?.[0] as Record<string, unknown> || {}),
    })) as Campaign[]
  }, [])

  const loadAll = useCallback(async (dp: DateParam, cmpDp?: DateParam, cmpLbl?: string) => {
    setLoading(true); setError('')
    try {
      const [currentCampaigns, previousCampaigns] = await Promise.all([
        loadCampaigns(dp),
        cmpDp ? loadCampaigns(cmpDp) : Promise.resolve([] as Campaign[]),
      ])
      setCampaigns(currentCampaigns)
      setPrevCampaigns(previousCampaigns)
      setComparisonLabel(cmpDp && cmpLbl ? cmpLbl : '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados')
      setPrevCampaigns([])
      setComparisonLabel('')
    }
    setLoading(false)
  }, [loadCampaigns])

  async function loadRelatorios() {
    const s = getSession()
    if (!s) return
    const data = await efCall('get-relatorios', { cliente_username: s.username }, { silent: true })
    const lista = (data?.relatorios as Relatorio[] | undefined) || []
    setRelatorios(lista.slice(0, 20))
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

  function onPeriodApply(dp: DateParam, label: string, cmpDp?: DateParam, cmpLbl?: string) {
    if (!analyticsEnabled) return
    setPeriod(dp)
    setPeriodLabel(label)
    loadAll(dp, cmpDp, cmpLbl)
  }

  // Carrega série temporal (time_increment=1) e abre o PresentMode.
  // Mesma lógica do dashboard interno: o PresentMode pega a série do parent
  // quando não há filtro, e refaz quando o cliente filtra.
  async function openPresentMode() {
    if (!campaigns.length) return
    setPresentLoading(true)
    try {
      const r = await metaCall('insights', {
        level: 'account', limit: '100',
        fields: 'spend,impressions,clicks,actions',
        time_increment: '1',
        ...period,
      })
      const rows = Array.isArray(r?.data) ? r.data : []
      setTimeSeriesData(rows.map((row: { date_start?: string; spend?: string; impressions?: string; clicks?: string; actions?: Array<{ action_type: string; value: string }> }) => ({
        date: String(row.date_start || ''),
        spend: +(row.spend || 0),
        impressions: +(row.impressions || 0),
        clicks: +(row.clicks || 0),
        actions: row.actions,
      })))
      setPresentMode(true)
    } catch {
      // Mesmo se a série falhar, abre o PresentMode — ele cuida do empty state
      setTimeSeriesData([])
      setPresentMode(true)
    } finally {
      setPresentLoading(false)
    }
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

  if (!sess || !accessChecked) return null

  const clientNav = buildClientPortalNav({
    analyticsEnabled,
    reportsEnabled,
    crmEnabled,
  })

  return (
    <div className={styles.portalShell} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", background: '#f4f6fa', minHeight: '100vh' }}>
      <Sidebar minimal sectorNav={clientNav} sectorNavTitle="ÁREA DO CLIENTE" />

      <div className={styles.portalMain}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo}>NGP <span>Dashboard</span></div>
            <div className={styles.clienteBadge}>👤 Área do Cliente</div>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.btnSecondary} onClick={() => router.push('/cliente')}>← Ferramentas</button>
            {analyticsEnabled && <PeriodFilter onApply={onPeriodApply} />}
            {analyticsEnabled && campaigns.length > 0 && (
              <button
                className={styles.btnSecondary}
                onClick={openPresentMode}
                disabled={presentLoading}
                style={{
                  background: presentLoading ? '#94a3b8' : 'linear-gradient(135deg, #2563eb, #22d3ee)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  cursor: presentLoading ? 'wait' : 'pointer',
                }}
                title="Abrir apresentação em tela cheia"
              >
                {presentLoading ? 'Carregando…' : '🎬 Apresentar'}
              </button>
            )}
            <button className={styles.userPill} onClick={() => setProfileOpen(true)} type="button">
              <div className={styles.userDot}>{(sess.user || 'CL').slice(0, 2).toUpperCase()}</div>
              <span className={styles.userName}>{sess.user}</span>
            </button>
            <button className={styles.btnLogout} onClick={logout}>Sair</button>
          </div>
        </header>

        <div className={styles.content}>
        <div className={styles.welcome}>
          <h1>Olá, {sess.user}! 👋</h1>
          <p>Aqui estão os resultados das suas campanhas no período: <span className={styles.period}>{periodLabel}</span></p>
        </div>

        {analyticsEnabled && (
          <>
            <div className={styles.explainer}>
              💡 <strong>Como ler este painel:</strong> <strong>Investido</strong> = quanto foi gasto nos anúncios. <strong>Impressões</strong> = quantas vezes seu anúncio foi exibido. <strong>Cliques</strong> = quantas pessoas clicaram. <strong>CTR</strong> = % de pessoas que clicaram após ver o anúncio. <strong>Conversas/Leads/Compras</strong> = resultados gerados. <strong>ROAS</strong> = retorno por real investido.
            </div>

            <div className={styles.kpiGrid}>
              <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#FFF3F3' }}>💰</div><div className={styles.kpiLabel}>Investido</div><div className={styles.kpiValue}>R$ {fmt(tSpend)}</div><div className={styles.kpiTip}>Total gasto em anúncios no período</div></div>
              <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#f0fdf4' }}>🎯</div><div className={styles.kpiLabel}>Resultados</div><div className={styles.kpiValue}>{fmtN(results)}{resLabel}</div><div className={styles.kpiTip}>Conversas, leads ou compras geradas</div></div>
              <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#f5f3ff' }}>👁️</div><div className={styles.kpiLabel}>Impressões</div><div className={styles.kpiValue}>{fmtI(tImp)}</div><div className={styles.kpiTip}>Vezes que seu anúncio foi exibido</div></div>
              <div className={styles.kpi}><div className={styles.kpiIcon} style={{ background: '#fffbeb' }}>📈</div><div className={styles.kpiLabel}>CTR médio</div><div className={styles.kpiValue}>{avgCtr.toFixed(2)}%</div><div className={styles.kpiTip}>% de pessoas que clicaram no anúncio</div></div>
            </div>

            <MetaAnalysisPanel
              campaigns={campaigns}
              prevCampaigns={prevCampaigns}
              periodLabel={periodLabel}
              comparisonLabel={comparisonLabel}
              title="Leitura estratégica das campanhas"
            />

            <div className={styles.sectionTitle}>📋 Suas Campanhas <span className={styles.count}>{campaigns.length} campanhas</span></div>

            {loading && <div className={styles.loadingState}><div className={styles.spinner} /><p>Carregando suas campanhas...</p></div>}
            {error && <div className={styles.errorState}>⚠️ {error}</div>}

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
                        <Chip label="Investido" value={`R$ ${fmt(c.spend)}`} />
                        <Chip label="Impressões" value={fmtI(c.impressions)} />
                        <Chip label="Cliques" value={fmtN(c.clicks)} />
                        <Chip label="CTR" value={`${c.ctr.toFixed(2)}%`} />
                        <Chip label="CPC" value={`R$ ${fmt(c.cpc)}`} />
                        {c.conversations > 0 && <Chip label="Conversas" value={fmtN(c.conversations)} />}
                        {c.leads > 0 && <Chip label="Leads" value={fmtN(c.leads)} />}
                        {c.purchases > 0 && <Chip label="Compras" value={fmtN(c.purchases)} />}
                        {c.roas > 0 && <Chip label="ROAS" value={`${c.roas.toFixed(2)}x`} cls="purple" />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {reportsEnabled && relatorios.length > 0 && (
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

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      {presentMode && (
        <PresentMode
          clienteName={sess.user || 'CLIENTE'}
          metaAccount=""
          periodLabel={periodLabel}
          period={period}
          campaigns={campaigns}
          timeSeriesData={timeSeriesData}
          selectedCampIds={selectedCampIds}
          onChangeSelectedCampIds={setSelectedCampIds}
          onApplyPeriod={(dp, label, cmpDp, cmpLbl) => { onPeriodApply(dp, label, cmpDp, cmpLbl) }}
          onClose={() => setPresentMode(false)}
        />
      )}
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
