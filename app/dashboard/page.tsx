'use client'
import React, { useEffect, useRef, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { fmt, fmtN, fmtI } from '@/lib/utils'
import { SURL, ANON } from '@/lib/constants'
import { DateParam, Campaign } from '@/types'
import PeriodFilter from '@/components/PeriodFilter'
import WorkspaceTopbar from '@/components/WorkspaceTopbar'
import NGPLoading from '@/components/NGPLoading'
import { summarizeSnapshotForDisplay } from '@/lib/analytics-snapshot'
import dynamic from 'next/dynamic'
import styles from './dashboard.module.css'
import AccountModal from './components/AccountModal'
import MetricsModal from './components/MetricsModal'
import AdPreviewModal from './components/AdPreviewModal'
import NovoRelatorioModal, { NovoRelatorioConfig } from './components/NovoRelatorioModal'
import RelatoriosListView from './components/RelatoriosListView'
import PresentMode from './components/PresentMode'
import PresentModeGoogle from './components/PresentModeGoogle'
import KpiSection from './components/KpiSection'
import CustomSelect from '@/components/CustomSelect'
import { shellIcons } from './components/ShellIcons'
import OverviewTab from './components/OverviewTab'
import AccountSelector from './components/AccountSelector'
import GoogleAdsCard from './components/GoogleAdsCard'
import ResumoGeralTab from './components/ResumoGeralTab'
import { Tab, WorkspaceNavSection } from './types'
import { getPeriodBudgetFactor, fmtDate } from './dashboard-utils'
import { useDashboard } from './hooks/useDashboard'
import { useGoogleAds } from './hooks/useGoogleAds'
import { META_METRICS, DEFAULT_METRICS } from '@/lib/meta-metrics'

const CampanhasTab = dynamic(() => import('./components/CampanhasTab'), { ssr: false })
const GraficosTab = dynamic(() => import('./components/GraficosTab'), { ssr: false })
const NotificacoesTab = dynamic(() => import('./components/NotificacoesTab'), { ssr: false })
// CopilotTab agora vive em /copilot (setor próprio). A aba aqui só mostra atalho.
const DiagnosisPanel = dynamic(() => import('./components/DiagnosisPanel'), { ssr: false })
const MetaAnalysisPanel = dynamic(() => import('@/components/MetaAnalysisPanel'), { ssr: false })
const Bar = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Bar })), { ssr: false })
const Doughnut = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Doughnut })), { ssr: false })

import '@/app/dashboard/chart-setup'

export default function DashboardPage() {
  const {
    sess, mounted, router,
    screen, setScreen, activeTab, setActiveTab,
    clients, search, setSearch, initLoad,
    viewing, selectAccount,
    overviewRows, overviewLoading, overviewError,
    overviewAutoRefresh, setOverviewAutoRefresh, overviewLastUpdated,
    visibleOverviewCols, setVisibleOverviewCols, toggleColumn,
    colMenuOpen, setColMenuOpen,
    campaigns, loading, error,
    period, periodLabel,
    campSearch, setCampSearch, campStatus, setCampStatus,
    adsetMap, adsMap,
    openCamps, openAdsets,
    loadingAdsets, loadingAds,
    chartMetric, setChartMetric,
    breakdownType, setBreakdownType, breakdownMetric, setBreakdownMetric,
    breakdownData, breakdownLoading, breakdownError,
    timeSeriesData, timeSeriesLoading, timeSeriesError,
    prevCampaigns, cmpLabel, cmpPeriodParam,
    relatorios,
    budgetAlerts, alertsLoading, alertsDismissed,
    selectedCampIds, setSelectedCampIds, campFilterOpen, setCampFilterOpen,
    visibleMetrics, toggleMetric, resetMetrics,
    metricsModalOpen, setMetricsModalOpen,
    previewHtml, setPreviewHtml, previewLoading, setPreviewLoading, previewAdName,
    topAdsSort, setTopAdsSort,
    modalOpen, setModalOpen, modalEdit, setModalEdit, modalLoading, setModalLoading, modalError, setModalError,
    tableSearch, setTableSearch, tableStatus, setTableStatus,
    loadOverviewData, loadData, loadTimeSeries, loadBreakdown, loadAllCampaignData, loadPreview, deleteRelatorio, dismissAlert, clearDismissed,
    refreshOverview,
    saveClient, deleteClient, archiveClient, backToSelect, onPeriodApply, switchTab, toggleCamp, toggleAdset, logout,
    currentClient, monthlyAuthorized, metricsBase, tSpend, totalPeriodSpend, tParsed, pParsed, totRes, resultLabel, costPerResult,
    filteredOverviewRows, overviewTotals, overviewTotalsCtr, overviewTotalsPrevCtr, overviewTotalsCpc, overviewTotalsPrevCpc,
    overviewTotalsCpl, overviewTotalsPrevCpl, overviewTotalsRoas, overviewTotalsPrevRoas, overviewHeroStats, loadedAds, analyticsSnapshot
  } = useDashboard()

  // Gasto do Google para a barra de investimento somar Meta + Google (o "Utilizado"
  // do topo precisa refletir o investimento total, não só Meta). Load manual.
  const googleBudget = useGoogleAds({ customerId: viewing?.googleAdsCustomerId, enabled: !!viewing?.googleAdsCustomerId })
  useEffect(() => {
    if (viewing?.googleAdsCustomerId) void googleBudget.load(period)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing?.googleAdsCustomerId, period])
  const googlePeriodSpend = googleBudget.summary?.spend || 0

  const colMenuRef = useRef<HTMLDivElement>(null)
  const campFilterRef = useRef<HTMLDivElement>(null)
  const [novoRelatorioOpen, setNovoRelatorioOpen] = useState(false)
  const [presentMode, setPresentMode] = useState(false)
  const [presentPlatform, setPresentPlatform] = useState<'meta' | 'google'>('meta')
  // overview pode mostrar a tabela de KPIs ou a lista global de relatórios
  const [overviewView, setOverviewView] = useState<'overview' | 'relatorios'>('overview')
  const [allRelatorios, setAllRelatorios] = useState<any[]>([])
  const [allRelatoriosLoading, setAllRelatoriosLoading] = useState(false)
  const [relatoriosPage, setRelatoriosPage] = useState(1)
  const RELATORIOS_PER_PAGE = 10

  async function loadAllRelatorios() {
    setAllRelatoriosLoading(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/get-relatorios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${sess?.session || ANON}` },
        body: JSON.stringify({ session_token: sess?.session }),
      })
      const data = await res.json()
      setAllRelatorios(data.relatorios || [])
    } catch { setAllRelatorios([]) }
    setAllRelatoriosLoading(false)
  }

  function openOverviewRelatorios() {
    setOverviewView('relatorios')
    setRelatoriosPage(1)
    loadAllRelatorios()
  }

  async function deleteAllRelatorio(id: string) {
    if (!confirm('Apagar este relatório?')) return
    try {
      const res = await fetch(`${SURL}/functions/v1/delete-relatorio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${sess?.session || ANON}` },
        body: JSON.stringify({ session_token: sess?.session, id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert('Erro ao apagar relatório: ' + (j?.error || `HTTP ${res.status}`))
        return
      }
      setAllRelatorios(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      console.error('[deleteAllRelatorio]', e)
      alert('Erro de rede ao apagar relatório. Tente novamente.')
    }
  }

  function openNovoRelatorio() {
    if (!viewing) { alert('Selecione um cliente antes de criar um relatório.'); return }
    // Pre-aquece a rota: o chunk JS de /relatorio (route.ts + html estático)
    // começa a baixar enquanto o usuário ainda configura no modal.
    try { router.prefetch?.('/relatorio') } catch {}
    setNovoRelatorioOpen(true)
  }

  function handleNovoRelatorioConfirm(config: NovoRelatorioConfig) {
    setNovoRelatorioOpen(false)
    if (!viewing) return
    const qs = new URLSearchParams({
      novo: '1',
      cliente: viewing.name || '',
      username: viewing.username || '',
      cid: viewing.id || '',
    })
    // Passa o meta_account_id no URL para o relatório usar nas chamadas Meta
    // mesmo quando o sessionStorage da nova aba estiver vazio
    if (viewing.account) qs.set('account', viewing.account)
    // Google Ads customer_id (sem traços) — relatório usa pra chamar a edge.
    if (viewing.googleAdsCustomerId) qs.set('gid', String(viewing.googleAdsCustomerId).replace(/-/g, ''))
    // Plataforma escolhida no modal: meta | google | both. Default 'meta'
    // pra não quebrar relatórios antigos abertos via outros fluxos.
    qs.set('platform', config.platform || 'meta')
    if (config.period) qs.set('period', config.period)
    if (config.metrics.length) qs.set('metrics', config.metrics.join(','))
    if (config.importCriativos) {
      qs.set('importCriativos', '1')
      if (config.objective) qs.set('objective', config.objective)
      if (config.audience) qs.set('audience', config.audience)
      qs.set('topN', String(config.topN))
    }
    // autoimport=1 dispara a importação no relatório sem mostrar o modal lá
    if (config.metrics.length || config.importCriativos) qs.set('autoimport', '1')
    window.open(`/relatorio?${qs.toString()}`, '_blank')
  }

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (colMenuOpen && colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenuOpen(false)
      if (campFilterOpen && campFilterRef.current && !campFilterRef.current.contains(e.target as Node)) setCampFilterOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [colMenuOpen, campFilterOpen, setColMenuOpen, setCampFilterOpen])

  // Derived vars for UI components
  const tImp = tParsed['impressions'] || 0
  const tClk = tParsed['clicks'] || 0
  const tConv = tParsed['conversations'] || 0
  const avgCtr = tParsed['ctr'] || 0
  const totRoas = tParsed['roas'] || 0

  const filtered = useMemo(() => campaigns.filter(c => {
    const q = tableSearch.toLowerCase()
    return (!q || c.name.toLowerCase().includes(q)) && (tableStatus === 'all' || c.status === tableStatus)
  }), [campaigns, tableSearch, tableStatus])

  const campFiltered = useMemo(() => campaigns.filter(c =>
    (!campSearch || c.name.toLowerCase().includes(campSearch.toLowerCase())) &&
    (campStatus === 'all' || c.status === campStatus)
  ), [campaigns, campSearch, campStatus])

  const top8 = useMemo(() => [...campaigns].sort((a, b) => b[chartMetric] - a[chartMetric]).slice(0, 8), [campaigns, chartMetric])
  const chartData = useMemo(() => ({
    labels: top8.map(c => c.name.length > 22 ? c.name.slice(0, 22) + '…' : c.name),
    datasets: [{ data: top8.map(c => c[chartMetric]), backgroundColor: '#2563eb', borderRadius: 4 }],
  }), [top8, chartMetric])
  const donutData = useMemo(() => ({
    labels: top8.map(c => c.name.length > 16 ? c.name.slice(0, 16) + '…' : c.name),
    datasets: [{
      data: top8.map(c => c.spend),
      backgroundColor: ['#2563eb','#38bdf8','#7c3aed','#059669','#d97706','#0891b2','#ec4899','#16a34a'],
    }],
  }), [top8])

  const budgetFactor = getPeriodBudgetFactor(period)
  // "No período" = teto proporcional aos dias já decorridos (referência de ritmo).
  const authorizedForPeriod = monthlyAuthorized > 0 ? monthlyAuthorized * budgetFactor : 0
  // "Utilizado" (Y) = investimento total do cliente no período (Meta + Google), pois o
  // autorizado (investimento_autorizado_mensal) é o teto total, não só Meta.
  const totalSpendUsed = totalPeriodSpend + googlePeriodSpend
  // Saldo e USO (leitura primária) = Y vs AUTORIZADO TOTAL (X). Modelo: X total, Y usado, X−Y.
  const budgetBalance = monthlyAuthorized - totalSpendUsed
  const budgetUsage = monthlyAuthorized > 0 ? (totalSpendUsed / monthlyAuthorized) * 100 : 0
  // Ritmo (secundário) = Y vs teto proporcional aos dias decorridos. >100% = gastando à frente.
  const paceUsage = authorizedForPeriod > 0 ? (totalSpendUsed / authorizedForPeriod) * 100 : 0
  const hasBudget = monthlyAuthorized > 0
  const budgetOver = hasBudget && budgetBalance < 0

  const bestAd = useMemo(() => [...loadedAds].filter(a => a.clicks > 0).sort((a, b) => {
    const aScore = a.spend > 0 ? (a.clicks / a.spend) : a.clicks
    const bScore = b.spend > 0 ? (b.clicks / b.spend) : b.clicks
    return bScore - aScore || b.ctr - a.ctr
  })[0], [loadedAds])
  
  const worstAd = useMemo(() => [...loadedAds].sort((a, b) => {
    const aHasClicks = a.clicks > 0
    const bHasClicks = b.clicks > 0
    if (!aHasClicks && bHasClicks) return -1
    if (!bHasClicks && aHasClicks) return 1
    const aScore = a.spend > 0 ? (a.clicks / a.spend) : 0
    const bScore = b.spend > 0 ? (b.clicks / b.spend) : 0
    return aScore - bScore || b.spend - a.spend
  })[0], [loadedAds])

  const snapshotDisplay = useMemo(() => analyticsSnapshot ? summarizeSnapshotForDisplay(analyticsSnapshot) : null, [analyticsSnapshot])

  const activeTabMeta: Record<Tab, string> = {
    'resumo-geral': 'Visão unificada Meta + Google Ads com layout limpo.', plataformas: 'Conexões, contas e visão operacional das redes.', campanhas: 'Aprofundamento em campanhas, conjuntos e anúncios.', graficos: 'Evolução temporal, comparativos e sinais visuais.', relatorios: 'Relatórios gerados e entregáveis do cliente.', notificacoes: 'Alertas de orçamento, saldo e status de conta.', copilot: 'Conversa com o NGP Copilot, memória e aprendizados deste cliente.', meta: 'Dados isolados da plataforma Meta Ads.', google: 'Dados isolados da plataforma Google Ads.',
  }
  const activeTabLabel: Record<Tab, string> = {
    'resumo-geral': 'Resumo', plataformas: 'Plataformas', campanhas: 'Campanhas', graficos: 'Gráficos', relatorios: 'Relatórios', notificacoes: 'Notificações', copilot: 'NGP Copilot', meta: 'Meta Ads', google: 'Google Ads',
  }

  function scrollToSection(id: string) {
    const section = document.getElementById(id)
    if (!section) return
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const overviewSidebarSections: WorkspaceNavSection[] = [
    { label: 'Fluxo', items: [
      { id: 'overview-home', label: 'Painel geral', icon: shellIcons.overview, active: overviewView === 'overview', onClick: () => { setOverviewView('overview'); scrollToSection('overview-hero') } },
      { id: 'overview-clients', label: 'Clientes Meta', icon: shellIcons.clients, onClick: () => { setOverviewView('overview'); scrollToSection('overview-table') } },
      { id: 'overview-comparison', label: 'Comparativos', icon: shellIcons.compare, onClick: () => { setOverviewView('overview'); scrollToSection('overview-summary') } },
      { id: 'overview-relatorios', label: 'Relatórios', icon: shellIcons.reports, active: overviewView === 'relatorios', onClick: openOverviewRelatorios },
      { id: 'overview-notificacoes', label: 'Notificações', icon: shellIcons.alerts, onClick: () => { setOverviewView('overview'); scrollToSection('overview-alerts') } },
    ]},
    { label: 'Canais', items: [
      { id: 'overview-ads', label: 'Anúncios', icon: shellIcons.ads, active: true },
      { id: 'overview-social', label: 'Mídias sociais', badge: 'breve', icon: shellIcons.social, disabled: true },
      { id: 'overview-seo', label: 'SEO', badge: 'depois', icon: shellIcons.seo, disabled: true },
      { id: 'overview-commerce', label: 'E-commerce', badge: 'depois', icon: shellIcons.commerce, disabled: true },
    ]},
  ]

  const dashboardSidebarSections: WorkspaceNavSection[] = [
    { label: 'Navegação', items: [
      { id: 'tab-resumo-geral', label: 'Resumo', icon: shellIcons.summary, active: activeTab === 'resumo-geral', onClick: () => switchTab('resumo-geral') },
      { id: 'tab-plataformas', label: 'Plataformas', icon: shellIcons.platforms, active: activeTab === 'plataformas', onClick: () => switchTab('plataformas') },
      { id: 'tab-campanhas', label: 'Campanhas', icon: shellIcons.campaigns, active: activeTab === 'campanhas', onClick: () => switchTab('campanhas') },
      { id: 'tab-graficos', label: 'Gráficos', icon: shellIcons.charts, active: activeTab === 'graficos', onClick: () => switchTab('graficos') },
      { id: 'tab-relatorios', label: 'Relatórios', icon: shellIcons.reports, active: activeTab === 'relatorios', onClick: () => switchTab('relatorios') },
      { id: 'tab-alerts', label: 'Notificações', icon: shellIcons.alerts, active: activeTab === 'notificacoes', onClick: () => switchTab('notificacoes') },
      { id: 'tab-copilot', label: 'NGP Copilot', icon: shellIcons.summary, active: activeTab === 'copilot', onClick: () => switchTab('copilot') },
    ]},
    { label: 'Canais', items: [
      { id: 'channel-meta', label: 'Meta Ads', icon: shellIcons.ads, active: activeTab === 'meta', onClick: () => switchTab('meta') },
      { id: 'channel-google', label: 'Google Ads', icon: shellIcons.commerce, active: activeTab === 'google', onClick: () => switchTab('google') },
    ]},
  ]

  const renderSidebarSections = (sections: WorkspaceNavSection[]) => sections.map((section) => (
    <div key={section.label} className={styles.workspaceSidebarSection}>
      <div className={styles.workspaceSidebarLabel}>{section.label}</div>
      <div className={styles.workspaceSidebarList}>
        {section.items.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={item.onClick}
            className={`${styles.workspaceSidebarItem} ${item.active ? styles.workspaceSidebarItemActive : ''} ${item.disabled ? styles.workspaceSidebarItemDisabled : ''}`}
          >
            <span className={styles.workspaceSidebarIcon}>{item.icon}</span>
            <span className={styles.workspaceSidebarCopy}>
              <span className={styles.workspaceSidebarItemTitle}>{item.label}</span>
              {item.meta && <span className={styles.workspaceSidebarItemMeta}>{item.meta}</span>}
            </span>
            {item.badge && <span className={styles.workspaceSidebarBadge}>{item.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  ))

  if (!sess || !mounted) return <NGPLoading loading loadingText="Carregando dashboard..." />

  const workspaceTopbar = (
    <WorkspaceTopbar
      subtitle="Relatórios e análise de dados"
      activeId="reports"
      onLogout={logout}
    />
  )

  if (screen === 'select') return (
    <div className={styles.workspace}>
      {workspaceTopbar}
      <div className={styles.workspaceFrame}>
        <aside className={styles.workspaceSidebar}>
          <div className={styles.workspaceSidebarHead}>
            <div className={styles.workspaceSidebarEyebrow}>Relatórios & Dados</div>
            <div className={styles.workspaceSidebarTitle}>Painel geral</div>
            <p className={styles.workspaceSidebarText}>Primeiro enxergamos o espaço inteiro; depois aprofundamos cliente por cliente.</p>
          </div>
          <div className={styles.workspaceSidebarBody}>
            {renderSidebarSections(overviewSidebarSections)}
            <div className={styles.workspaceSidebarMetaGrid}>
              <div className={styles.workspaceSidebarMetaCard}><span className={styles.workspaceSidebarMetaLabel}>Período</span><strong className={styles.workspaceSidebarMetaValue}>{periodLabel}</strong></div>
              <div className={styles.workspaceSidebarMetaCard}><span className={styles.workspaceSidebarMetaLabel}>Comparação</span><strong className={styles.workspaceSidebarMetaValue}>{cmpLabel || 'Sem'}</strong></div>
            </div>
          </div>
          <div className={styles.workspaceSidebarFooter}>
            <button className={styles.workspaceSidebarSecondaryBtn} onClick={() => router.push('/setores')}>Voltar aos setores</button>
            {sess.role === 'admin' && <button className={styles.workspaceSidebarPrimaryBtn} onClick={() => { setModalEdit({}); setModalOpen(true) }}>+ Nova conta</button>}
            <div className={styles.workspaceSidebarOpCard}>
              <span className={styles.workspaceSidebarOpLabel}>Operação</span>
              <strong className={styles.workspaceSidebarOpValue}>{sess.user || 'NGP'}</strong>
              <span className={styles.workspaceSidebarOpMeta}>{sess.role === 'admin' ? 'Acesso administrativo' : 'Acesso interno'}</span>
            </div>
          </div>
        </aside>
        <main className={styles.workspaceCanvas}>
          <div className={styles.workspaceCanvasInner}>
            <div id="overview-hero" className={`${styles.workspaceHeroCard} ${styles.workspaceHeroCardCompact}`}>
              <div className={styles.workspaceHeroChip}>
                <div className={styles.workspaceHeroAvatarMuted}>NGP</div>
                <div className={styles.workspaceHeroChipBody}>
                  <strong className={styles.workspaceHeroChipName}>Visão geral</strong>
                  <span className={styles.workspaceHeroChipMeta}>{filteredOverviewRows.length} conta(s) Meta</span>
                </div>
              </div>
              <div className={styles.workspaceHeroActions}>
                <PeriodFilter onApply={onPeriodApply} />
                <button
                  className={styles.overviewRefreshBtn}
                  onClick={refreshOverview}
                  title="Limpa o cache e busca dados frescos do Meta. Use quando suspeitar que os dados estão velhos.">↻ Atualizar</button>
              </div>
            </div>
            {overviewView === 'overview' ? (
              <OverviewTab
                initLoad={initLoad} overviewLoading={overviewLoading} overviewError={overviewError} overviewRows={overviewRows} search={search}
                period={period} cmpPeriodParam={cmpPeriodParam} cmpLabel={cmpLabel} periodLabel={periodLabel} visibleOverviewCols={visibleOverviewCols}
                colMenuOpen={colMenuOpen} colMenuRef={colMenuRef} overviewLastUpdated={overviewLastUpdated} overviewAutoRefresh={overviewAutoRefresh}
                filteredOverviewRows={filteredOverviewRows} overviewTotals={overviewTotals} overviewTotalsCtr={overviewTotalsCtr}
                overviewTotalsPrevCtr={overviewTotalsPrevCtr} overviewTotalsCpc={overviewTotalsCpc} overviewTotalsPrevCpc={overviewTotalsPrevCpc}
                overviewTotalsCpl={overviewTotalsCpl} overviewTotalsPrevCpl={overviewTotalsPrevCpl} overviewTotalsRoas={overviewTotalsRoas}
                overviewTotalsPrevRoas={overviewTotalsPrevRoas} overviewHeroStats={overviewHeroStats} sess={sess}
                onSetSearch={setSearch} onSetColMenuOpen={setColMenuOpen} onToggleColumn={toggleColumn} onSetAutoRefresh={setOverviewAutoRefresh}
                onLoadOverviewData={() => loadOverviewData(period, cmpPeriodParam)} onSelectAccount={selectAccount}
                onOpenModal={(c) => { setModalEdit(c); setModalOpen(true) }} onApplyPeriod={onPeriodApply}
              />
            ) : (
              <RelatoriosListView
                relatorios={allRelatorios}
                loading={allRelatoriosLoading}
                page={relatoriosPage}
                perPage={RELATORIOS_PER_PAGE}
                onPageChange={setRelatoriosPage}
                onRefresh={loadAllRelatorios}
                onDelete={deleteAllRelatorio}
                onNew={openNovoRelatorio}
                clients={clients}
              />
            )}
          </div>
        </main>
      </div>
      {modalOpen && <AccountModal data={modalEdit || {}} loading={modalLoading} error={modalError} userRole={sess?.role} onSave={saveClient} onArchive={archiveClient} onDelete={deleteClient} onClose={() => { setModalOpen(false); setModalEdit(null); setModalError('') }} />}
    </div>
  )

  return (
    <div className={styles.workspace}>
      {workspaceTopbar}
      <div className={styles.workspaceFrame}>
        <aside className={styles.workspaceSidebar}>
          <div className={styles.workspaceSidebarHead}>
            <div className={styles.workspaceSidebarEyebrow}>Cliente ativo</div>
            <div className={styles.workspaceSidebarTitle}>{viewing?.name}</div>
          </div>
          <div className={styles.workspaceSidebarBody}>
            {renderSidebarSections(dashboardSidebarSections)}
          </div>
          <div className={styles.workspaceSidebarFooter}>
            <button className={styles.workspaceSidebarSecondaryBtn} onClick={backToSelect}>Voltar à visão geral</button>
            {currentClient && <button className={styles.workspaceSidebarPrimaryBtn} onClick={() => { setModalEdit(currentClient); setModalOpen(true); setModalError('') }}>Editar conta</button>}
            <div className={styles.workspaceSidebarOpCard}>
              <span className={styles.workspaceSidebarOpLabel}>Operação</span>
              <strong className={styles.workspaceSidebarOpValue}>{sess.user || 'NGP'}</strong>
              <span className={styles.workspaceSidebarOpMeta}>{sess.role === 'admin' ? 'Acesso administrativo' : 'Acesso interno'}</span>
            </div>
          </div>
        </aside>
        <div className={styles.workspaceCanvas}>
          <div className={styles.workspaceCanvasInner}>
            <div className={`${styles.workspaceHeroCard} ${styles.workspaceHeroCardCompact}`}>
              <div className={styles.workspaceHeroChip}>
                <div className={styles.workspaceHeroAvatar}>{(viewing?.name || 'NA').slice(0, 2).toUpperCase()}</div>
                <div className={styles.workspaceHeroChipBody}>
                  <strong className={styles.workspaceHeroChipName}>{viewing?.name || '—'}</strong>
                  <span className={styles.workspaceHeroChipMeta}>{viewing?.account || '—'}</span>
                </div>
              </div>
              <div className={styles.workspaceHeroActions}>
                <button
                  onClick={() => {
                    // Garante que a série temporal está carregada antes de abrir o PresentMode
                    // (caso o usuário ainda não tenha visitado a aba Gráficos)
                    if (timeSeriesData.length === 0 && !timeSeriesLoading) loadTimeSeries(period)
                    setPresentMode(true)
                  }}
                  title="Apresentar dashboard em tela cheia"
                  style={{
                    padding: '9px 16px',
                    background: 'linear-gradient(135deg, #22d3ee, #3b82f6)',
                    border: 'none',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 4px 12px rgba(34,211,238,.25)',
                  }}
                >
                  🎤 Apresentar
                </button>
                <PeriodFilter onApply={onPeriodApply} />
                <AccountSelector clients={clients} viewing={viewing} onSelect={selectAccount} />
              </div>
            </div>

            <div className={styles.budgetCard}>
              <div>
                <div className={styles.budgetLabel}>Investimento autorizado</div>
                <div className={styles.budgetValue}>{hasBudget ? `R$ ${fmt(monthlyAuthorized)}` : 'Não definido'}</div>
                <div className={styles.budgetMeta}>{hasBudget ? `Mensal · ${periodLabel}` : 'Defina no cadastro'}</div>
              </div>
              <div>
                <div className={styles.budgetLabel}>No período</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className={styles.budgetValueSmall}>{hasBudget ? `R$ ${fmt(authorizedForPeriod)}` : '—'}</span>
                  {hasBudget && paceUsage > 0 && (
                    <span title="Ritmo: gasto vs teto proporcional aos dias decorridos. Acima de 100% = gastando à frente do previsto."
                      style={{ fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 99, whiteSpace: 'nowrap',
                        color: paceUsage > 100 ? '#dc2626' : '#16a34a',
                        background: paceUsage > 100 ? 'rgba(220,38,38,.1)' : 'rgba(22,163,74,.1)' }}>
                      ritmo {Math.round(paceUsage)}%
                    </span>
                  )}
                </div>
              </div>
              <div><div className={styles.budgetLabel}>Utilizado</div><div className={styles.budgetValueSmall}>R$ {fmt(totalSpendUsed)}</div></div>
              <div><div className={styles.budgetLabel}>Saldo</div><div style={{ fontSize: 17, fontWeight: 800, color: !hasBudget ? '#AEAEB2' : budgetOver ? '#dc2626' : '#16a34a' }}>{hasBudget ? `${budgetBalance >= 0 ? '+' : '-'}R$ ${fmt(Math.abs(budgetBalance))}` : '—'}</div></div>
              <div style={{ minWidth: 150 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <span className={styles.budgetLabel}>Uso</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: !hasBudget ? '#AEAEB2' : budgetOver ? '#dc2626' : '#16a34a' }}>{hasBudget ? `${Math.round(budgetUsage)}%` : '—'}</span>
                </div>
                <div style={{ height: 8, background: '#F5F5F7', borderRadius: 99, overflow: 'hidden' }}><div style={{ height: '100%', width: `${hasBudget ? Math.min(100, budgetUsage) : 0}%`, background: budgetOver ? '#dc2626' : '#16a34a', borderRadius: 99, transition: 'width .25s ease' }} /></div>
              </div>
            </div>

            <div className={styles.tabContent}>
              {(activeTab === 'resumo-geral' || activeTab === 'meta' || activeTab === 'google') && (
                <ResumoGeralTab
                  metaParsed={tParsed}
                  prevMetaParsed={pParsed}
                  cmpLabel={cmpLabel}
                  cmpPeriodActive={!!cmpPeriodParam}
                  visibleMetrics={visibleMetrics}
                  googleAdsCustomerId={viewing?.googleAdsCustomerId}
                  period={period}
                  periodLabel={periodLabel}
                  onPersonalize={() => setMetricsModalOpen(true)}
                  platform={activeTab === 'meta' ? 'meta' : activeTab === 'google' ? 'google' : 'all'}
                />
              )}

              {activeTab === 'plataformas' && <>
                <div className={styles.sectionCard}>
                  <div className={styles.platHead}><span className={styles.platTitle}>Meta Ads</span>{viewing?.account && <span className={styles.platId}>{viewing.account}</span>}</div>
                  <div className={styles.kpiRow}>{[ { label: 'Investido', value: `R$ ${fmt(tSpend)}` }, { label: 'Imp', value: fmtI(tImp) }, { label: 'Cliques', value: fmtN(tClk) }, { label: 'CTR', value: `${avgCtr.toFixed(2)}%` }, { label: 'Conversas', value: fmtN(tConv) }, { label: 'ROAS', value: `${totRoas.toFixed(2)}x` } ].map(k => (<div key={k.label} className={styles.kpiMini}><div className={styles.kpiMiniLabel}>{k.label}</div><div className={styles.kpiMiniValue}>{k.value}</div></div>))}</div>
                </div>

                <GoogleAdsCard
                  customerId={viewing?.googleAdsCustomerId}
                  period={period}
                  customerName={viewing?.name}
                />
              </>}

              {activeTab === 'campanhas' && (
                <Suspense fallback={<NGPLoading loading loadingText="Carregando campanhas..." />}>
                  <CampanhasTab loading={loading} campSearch={campSearch} campStatus={campStatus} campFiltered={campFiltered} openCamps={openCamps} openAdsets={openAdsets} loadingAdsets={loadingAdsets} loadingAds={loadingAds} adsetMap={adsetMap} adsMap={adsMap} breakdownType={breakdownType} breakdownMetric={breakdownMetric} breakdownData={breakdownData} breakdownLoading={breakdownLoading} breakdownError={breakdownError} topAdsSort={topAdsSort} campaigns={campaigns} visibleMetrics={visibleMetrics} onSetCampSearch={setCampSearch} onSetCampStatus={setCampStatus} onToggleCamp={toggleCamp} onToggleAdset={toggleAdset} onLoadAllCampaignData={loadAllCampaignData} onLoadBreakdown={loadBreakdown} onSetBreakdownType={setBreakdownType} onSetBreakdownMetric={setBreakdownMetric} onSetTopAdsSort={setTopAdsSort} onLoadPreview={loadPreview} />
                </Suspense>
              )}
              {activeTab === 'graficos' && (
                <Suspense fallback={<NGPLoading loading loadingText="Carregando gráficos..." />}>
                  <GraficosTab campaigns={campaigns} chartMetric={chartMetric} chartData={chartData} donutData={donutData} timeSeriesData={timeSeriesData} timeSeriesLoading={timeSeriesLoading} timeSeriesError={timeSeriesError} onSetChartMetric={setChartMetric} />
                </Suspense>
              )}
              {activeTab === 'relatorios' && <>
                <div className={styles.relHeader}>
                  <span className={styles.relTitle}>Relatórios salvos</span>
                  <button
                    className={styles.btnNewRel}
                    disabled={!viewing}
                    onClick={openNovoRelatorio}
                  >+ Novo relatório</button>
                </div>
                {relatorios.length === 0
                  ? <div className={styles.empty}>Nenhum relatório salvo para esta conta.</div>
                  : <div className={styles.relList}>
                      {relatorios.map(r => (
                        <div key={r.id} className={styles.relCard}>
                          <div className={styles.relIcon}>{r.dados?.tipo === 'v2' ? '✦' : '📄'}</div>
                          <div className={styles.relInfo}>
                            <div className={styles.relName}>{r.titulo}</div>
                            <div className={styles.relMeta}>{r.periodo} · {fmtDate(r.updated_at)}</div>
                          </div>
                          {r.dados?.tipo === 'v2' && <span className={styles.proBadge}>PRO</span>}
                          <button className={styles.btnOpenRel} onClick={() => window.open(`/relatorio?id=${r.id}`, '_blank')}>Abrir →</button>
                          <button className={styles.btnDelRel} onClick={() => deleteRelatorio(r.id)}>🗑</button>
                        </div>
                      ))}
                    </div>
                }
              </>}
              {activeTab === 'notificacoes' && (
                <Suspense fallback={<NGPLoading loading loadingText="Carregando notificações..." />}>
                  <NotificacoesTab alertsLoading={alertsLoading} budgetAlerts={budgetAlerts} alertsDismissed={alertsDismissed} clients={clients} onLoadBudgetAlerts={() => {}} onDismissAlert={dismissAlert} onClearDismissed={clearDismissed} />
                </Suspense>
              )}
              {activeTab === 'copilot' && (
                <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 14 }}>
                  <h2 style={{ fontSize: 22, color: '#111827', margin: '0 0 8px' }}>NGP Copilot agora é setor próprio</h2>
                  <p style={{ color: '#6b7280', maxWidth: 480, margin: '0 auto 20px' }}>
                    O Copilot foi movido para um setor dedicado em <code>/copilot</code> pra você ter foco total na conversa,
                    memória e timeline de cada cliente.
                  </p>
                  <button
                    onClick={() => router.push(viewing?.id ? `/copilot/${viewing.id}` : '/copilot')}
                    style={{
                      background: '#2563eb',
                      color: '#fff',
                      border: 0,
                      padding: '12px 24px',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Abrir Copilot{viewing?.name ? ` para ${viewing.name}` : ''} →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {modalOpen && <AccountModal data={modalEdit || {}} loading={modalLoading} error={modalError} userRole={sess?.role} onSave={saveClient} onArchive={archiveClient} onDelete={deleteClient} onClose={() => { setModalOpen(false); setModalEdit(null); setModalError('') }} />}
      {metricsModalOpen && <MetricsModal visible={visibleMetrics} onToggle={toggleMetric} onReset={resetMetrics} onClose={() => setMetricsModalOpen(false)} />}
      <AdPreviewModal html={previewHtml} loading={previewLoading} adName={previewAdName} onClose={() => { setPreviewHtml(null); setPreviewLoading(false) }} />
      <NovoRelatorioModal isOpen={novoRelatorioOpen} clienteName={viewing?.name || ''} campaigns={campaigns} hasGoogleAds={!!viewing?.googleAdsCustomerId} onClose={() => setNovoRelatorioOpen(false)} onConfirm={handleNovoRelatorioConfirm} />
      {presentMode && presentPlatform === 'meta' && (
        <PresentMode
          clienteName={viewing?.name || ''}
          metaAccount={viewing?.account || ''}
          periodLabel={periodLabel}
          period={period}
          campaigns={campaigns}
          prevCampaigns={prevCampaigns}
          cmpLabel={cmpLabel}
          timeSeriesData={timeSeriesData}
          selectedCampIds={selectedCampIds}
          onChangeSelectedCampIds={setSelectedCampIds}
          onApplyPeriod={onPeriodApply}
          onClose={() => setPresentMode(false)}
          {...(viewing?.googleAdsCustomerId ? { onSwitchToGoogle: () => setPresentPlatform('google') } : {})}
        />
      )}
      {presentMode && presentPlatform === 'google' && viewing?.googleAdsCustomerId && (
        <PresentModeGoogle
          clienteName={viewing?.name || ''}
          googleAdsCustomerId={viewing.googleAdsCustomerId}
          periodLabel={periodLabel}
          period={period}
          onApplyPeriod={(dp, label) => onPeriodApply(dp, label)}
          onSwitchToMeta={() => setPresentPlatform('meta')}
          onClose={() => setPresentMode(false)}
        />
      )}
    </div>
  )
}
