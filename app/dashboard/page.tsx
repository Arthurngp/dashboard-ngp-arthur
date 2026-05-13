'use client'
import React, { useEffect, useRef, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { fmt, fmtN, fmtI } from '@/lib/utils'
import { SURL } from '@/lib/constants'
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
import KpiSection from './components/KpiSection'
import CustomSelect from '@/components/CustomSelect'
import { shellIcons } from './components/ShellIcons'
import OverviewTab from './components/OverviewTab'
import AccountSelector from './components/AccountSelector'
import { Tab, WorkspaceNavSection } from './types'
import { getPeriodBudgetFactor, fmtDate } from './dashboard-utils'
import { useDashboard } from './hooks/useDashboard'
import { META_METRICS, DEFAULT_METRICS } from '@/lib/meta-metrics'

const CampanhasTab = dynamic(() => import('./components/CampanhasTab'), { ssr: false })
const GraficosTab = dynamic(() => import('./components/GraficosTab'), { ssr: false })
const NotificacoesTab = dynamic(() => import('./components/NotificacoesTab'), { ssr: false })
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
    saveClient, deleteClient, archiveClient, backToSelect, onPeriodApply, switchTab, toggleCamp, toggleAdset, logout,
    currentClient, monthlyAuthorized, metricsBase, tSpend, totalPeriodSpend, tParsed, pParsed, totRes, resultLabel, costPerResult,
    filteredOverviewRows, overviewTotals, overviewTotalsCtr, overviewTotalsPrevCtr, overviewTotalsCpc, overviewTotalsPrevCpc,
    overviewTotalsCpl, overviewTotalsPrevCpl, overviewTotalsRoas, overviewTotalsPrevRoas, overviewHeroStats, loadedAds, analyticsSnapshot
  } = useDashboard()

  const colMenuRef = useRef<HTMLDivElement>(null)
  const campFilterRef = useRef<HTMLDivElement>(null)
  const [novoRelatorioOpen, setNovoRelatorioOpen] = useState(false)

  function openNovoRelatorio() {
    if (!viewing) { alert('Selecione um cliente antes de criar um relatório.'); return }
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
    if (config.period) qs.set('period', config.period)
    if (config.metrics.length) qs.set('metrics', config.metrics.join(','))
    if (config.importCriativos) {
      qs.set('importCriativos', '1')
      if (config.objective) qs.set('objective', config.objective)
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
  const authorizedForPeriod = monthlyAuthorized > 0 ? monthlyAuthorized * budgetFactor : 0
  const budgetBalance = authorizedForPeriod - totalPeriodSpend
  const budgetUsage = authorizedForPeriod > 0 ? (totalPeriodSpend / authorizedForPeriod) * 100 : 0
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
    resumo: 'KPIs, diagnóstico e leitura consolidada do período.', plataformas: 'Conexões, contas e visão operacional das redes.', campanhas: 'Aprofundamento em campanhas, conjuntos e anúncios.', graficos: 'Evolução temporal, comparativos e sinais visuais.', relatorios: 'Relatórios gerados e entregáveis do cliente.', notificacoes: 'Alertas de orçamento, saldo e status de conta.',
  }
  const activeTabLabel: Record<Tab, string> = {
    resumo: 'Resumo', plataformas: 'Plataformas', campanhas: 'Campanhas', graficos: 'Gráficos', relatorios: 'Relatórios', notificacoes: 'Notificações',
  }

  function scrollToSection(id: string) {
    const section = document.getElementById(id)
    if (!section) return
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const overviewSidebarSections: WorkspaceNavSection[] = [
    { label: 'Fluxo', items: [
      { id: 'overview-home', label: 'Painel geral', meta: 'Entrada macro do módulo antes do cliente.', icon: shellIcons.overview, active: true, onClick: () => scrollToSection('overview-hero') },
      { id: 'overview-clients', label: 'Clientes Meta', meta: `${filteredOverviewRows.length} conta(s) visível(is)`, icon: shellIcons.clients, onClick: () => scrollToSection('overview-table') },
      { id: 'overview-comparison', label: 'Comparativos', meta: cmpLabel || 'Sem comparação ativa', icon: shellIcons.compare, onClick: () => scrollToSection('overview-summary') },
    ]},
    { label: 'Canais', items: [
      { id: 'overview-ads', label: 'Anúncios', meta: 'Meta Ads em produção', icon: shellIcons.ads, active: true },
      { id: 'overview-social', label: 'Mídias sociais', meta: 'Fase seguinte do módulo', badge: 'breve', icon: shellIcons.social, disabled: true },
      { id: 'overview-seo', label: 'SEO', meta: 'Planejado para evolução', badge: 'depois', icon: shellIcons.seo, disabled: true },
      { id: 'overview-commerce', label: 'E-commerce', meta: 'Planejado para evolução', badge: 'depois', icon: shellIcons.commerce, disabled: true },
    ]},
  ]

  const dashboardSidebarSections: WorkspaceNavSection[] = [
    { label: 'Navegação', items: [
      { id: 'tab-resumo', label: 'Resumo', meta: 'KPIs e leitura executiva', icon: shellIcons.summary, active: activeTab === 'resumo', onClick: () => switchTab('resumo') },
      { id: 'tab-plataformas', label: 'Plataformas', meta: 'Conexões e contas', icon: shellIcons.platforms, active: activeTab === 'plataformas', onClick: () => switchTab('plataformas') },
      { id: 'tab-campanhas', label: 'Campanhas', meta: 'Aprofunde campanhas e criativos', icon: shellIcons.campaigns, active: activeTab === 'campanhas', onClick: () => switchTab('campanhas') },
      { id: 'tab-graficos', label: 'Gráficos', meta: 'Evolução e distribuição', icon: shellIcons.charts, active: activeTab === 'graficos', onClick: () => switchTab('graficos') },
      { id: 'tab-relatorios', label: 'Relatórios', meta: 'Saídas e entregáveis', icon: shellIcons.reports, active: activeTab === 'relatorios', onClick: () => switchTab('relatorios') },
      { id: 'tab-alerts', label: 'Notificações', meta: 'Saldo, orçamento e status', icon: shellIcons.alerts, active: activeTab === 'notificacoes', onClick: () => switchTab('notificacoes') },
    ]},
    { label: 'Canais', items: [
      { id: 'channel-meta', label: 'Meta Ads', meta: viewing?.account || 'Conta ativa', icon: shellIcons.ads, active: true },
      { id: 'channel-google', label: 'Google Ads', meta: 'Entrada posterior no Space', icon: shellIcons.commerce, badge: 'depois', disabled: true },
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
      clientChip={screen === 'dashboard' && viewing ? {
        title: viewing.name,
        meta: viewing.account,
        avatarText: viewing.name.slice(0, 2).toUpperCase(),
        avatarImage: currentClient?.foto_url,
      } : null}
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
          {renderSidebarSections(overviewSidebarSections)}
          <div className={styles.workspaceSidebarMetaGrid}>
            <div className={styles.workspaceSidebarMetaCard}><span className={styles.workspaceSidebarMetaLabel}>Período</span><strong className={styles.workspaceSidebarMetaValue}>{periodLabel}</strong></div>
            <div className={styles.workspaceSidebarMetaCard}><span className={styles.workspaceSidebarMetaLabel}>Comparação</span><strong className={styles.workspaceSidebarMetaValue}>{cmpLabel || 'Sem'}</strong></div>
          </div>
          <div className={styles.workspaceSidebarFooter}>
            <button className={styles.workspaceSidebarSecondaryBtn} onClick={() => router.push('/setores')}>Voltar aos setores</button>
            {sess.role === 'admin' && <button className={styles.workspaceSidebarPrimaryBtn} onClick={() => { setModalEdit({}); setModalOpen(true) }}>+ Nova conta</button>}
          </div>
        </aside>
        <main className={styles.workspaceCanvas}>
          <div className={styles.workspaceCanvasInner}>
            <div id="overview-hero" className={styles.workspaceHeroCard}>
              <div className={styles.workspaceHeroCopy}>
                <div className={styles.workspaceHeroEyebrow}>Análise de Dados e Relatórios</div>
                <h1 className={styles.workspaceHeroTitle}>Painel de visão geral</h1>
              </div>
              <div className={styles.workspaceHeroActions}>
                <PeriodFilter onApply={onPeriodApply} />
                <button className={styles.overviewRefreshBtn} onClick={() => loadOverviewData(period, cmpPeriodParam)}>↻ Atualizar</button>
              </div>
            </div>
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
          {renderSidebarSections(dashboardSidebarSections)}
          <div className={styles.workspaceSidebarMetaGrid}>
            <div className={styles.workspaceSidebarMetaCard}><span className={styles.workspaceSidebarMetaLabel}>Conta</span><strong className={styles.workspaceSidebarMetaValue}>{viewing?.account || '—'}</strong></div>
            <div className={styles.workspaceSidebarMetaCard}><span className={styles.workspaceSidebarMetaLabel}>Período</span><strong className={styles.workspaceSidebarMetaValue}>{periodLabel}</strong></div>
          </div>
          <div className={styles.workspaceSidebarFooter}>
            <button className={styles.workspaceSidebarSecondaryBtn} onClick={backToSelect}>Voltar à visão geral</button>
            {currentClient && <button className={styles.workspaceSidebarPrimaryBtn} onClick={() => { setModalEdit(currentClient); setModalOpen(true); setModalError('') }}>Editar conta</button>}
          </div>
        </aside>
        <div className={styles.workspaceCanvas}>
          <div className={styles.workspaceCanvasInner}>
            <div className={styles.workspaceHeroCard}>
              <div className={styles.workspaceHeroCopy}>
                <div className={styles.workspaceHeroEyebrow}>Meta Ads · {activeTabLabel[activeTab]}</div>
                <h1 className={styles.workspaceHeroTitle}>{viewing?.name}</h1>
              </div>
              <div className={styles.workspaceHeroActions}>
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
              <div><div className={styles.budgetLabel}>No período</div><div className={styles.budgetValueSmall}>{hasBudget ? `R$ ${fmt(authorizedForPeriod)}` : '—'}</div></div>
              <div><div className={styles.budgetLabel}>Utilizado</div><div className={styles.budgetValueSmall}>R$ {fmt(totalPeriodSpend)}</div></div>
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
              {activeTab === 'resumo' && <>
                {loading && <div className={styles.loadingBar}><div className={styles.spinner} /> Carregando...</div>}
                {error && <div className={styles.errorBox}>⚠️ {error}</div>}

                {campaigns.length > 0 && (
                  <div ref={campFilterRef} style={{ position: 'relative', marginBottom: 14 }}>
                    <button onClick={() => setCampFilterOpen(p => !p)} className={styles.campFilterBtn} style={{ background: selectedCampIds.size > 0 ? 'var(--report-primary-soft)' : '#fff', border: selectedCampIds.size > 0 ? '1.5px solid var(--report-primary)' : '1.5px solid #E5E5EA', color: selectedCampIds.size > 0 ? 'var(--report-primary)' : '#6E6E73' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={14} height={14}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                      {selectedCampIds.size === 0 ? 'Todas as campanhas' : selectedCampIds.size === 1 ? campaigns.find(c => selectedCampIds.has(c.id))?.name?.slice(0, 32) + '…' : `${selectedCampIds.size} selecionadas`}
                    </button>
                    {campFilterOpen && (
                      <div className={styles.campFilterDropdown}>
                        <div className={styles.campFilterHeader}><span>Filtrar métricas</span></div>
                        <div className={styles.campFilterList}>
                          {campaigns.map(c => {
                            const checked = selectedCampIds.has(c.id)
                            return (
                              <div key={c.id} className={styles.campFilterItem} onClick={() => { setSelectedCampIds(prev => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next }) }}>
                                <div className={styles.checkbox}>{checked && '✓'}</div>
                                <div className={styles.campFilterItemInfo}><div>{c.name}</div><span>R$ {fmt(c.spend)}</span></div>
                              </div>
                            )
                          })}
                        </div>
                        <div className={styles.campFilterFooter}><button onClick={() => setCampFilterOpen(false)}>Aplicar</button></div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#6E6E73' }}>Resumo · {periodLabel}</span>
                  <button onClick={() => setMetricsModalOpen(true)} className={styles.customizeBtn}>Personalizar métricas</button>
                </div>

                {(() => {
                  const sectionsMap: Record<string, any[]> = {}
                  visibleMetrics.forEach(metricId => {
                    const mDef = META_METRICS.find(m => m.id === metricId)
                    if (!mDef) return
                    const currRaw = tParsed[metricId] || 0
                    const prevRaw = cmpPeriodParam ? (pParsed[metricId] || 0) : undefined
                    sectionsMap[mDef.section] = sectionsMap[mDef.section] || []
                    sectionsMap[mDef.section].push({ id: mDef.id, label: mDef.label, currRaw, prevRaw, lowerIsBetter: mDef.lowerIsBetter, format: mDef.format })
                  })
                  return (
                    <div className={styles.kpiSections}>
                      {Object.keys(sectionsMap).map(sec => (
                        <KpiSection key={sec} title={sec} cmpLabel={cmpLabel} items={sectionsMap[sec].map(item => ({
                          ...item,
                          value: item.format === 'currency' ? `R$ ${fmt(item.currRaw)}` : item.format === 'percent' ? `${item.currRaw.toFixed(2)}%` : item.format === 'ratio' ? `${item.currRaw.toFixed(2)}x` : fmtN(item.currRaw),
                          prev: item.prevRaw !== undefined ? (item.format === 'currency' ? `R$ ${fmt(item.prevRaw)}` : item.format === 'percent' ? `${item.prevRaw.toFixed(2)}%` : item.format === 'ratio' ? `${item.prevRaw.toFixed(2)}x` : fmtN(item.prevRaw)) : undefined
                        }))} />
                      ))}
                    </div>
                  )
                })()}

                <Suspense fallback={null}>
                  <DiagnosisPanel analyticsSnapshot={analyticsSnapshot} snapshotDisplay={snapshotDisplay} loadedAds={loadedAds} bestAd={bestAd} worstAd={worstAd} />
                </Suspense>
                <Suspense fallback={null}>
                  <MetaAnalysisPanel campaigns={metricsBase} prevCampaigns={selectedCampIds.size > 0 ? prevCampaigns.filter(c => selectedCampIds.has(c.id)) : prevCampaigns} periodLabel={periodLabel} comparisonLabel={cmpLabel} title="Análise Meta Ads" />
                </Suspense>

                {campaigns.length > 0 && (
                  <div className={styles.chartsRow}>
                    <div className={styles.chartCard}>
                      <div className={styles.chartHead}><span>Top campanhas</span>
                        <div className={styles.chartBtns}>{(['spend','impressions','clicks'] as const).map(m => (<button key={m} className={`${styles.chartBtn} ${chartMetric === m ? styles.chartBtnActive : ''}`} onClick={() => setChartMetric(m)}>{m === 'spend' ? 'Gasto' : 'Imp'}</button>))}</div>
                      </div>
                      <Bar data={chartData} options={{ responsive: true, indexAxis: 'y' as const, plugins: { legend: { display: false } } }} />
                    </div>
                    <div className={styles.chartCard} style={{ maxWidth: 300 }}><div className={styles.chartHead}><span>Gasto</span></div><Doughnut data={donutData} /></div>
                  </div>
                )}
              </>}

              {activeTab === 'plataformas' && <>
                <div className={styles.sectionCard}>
                  <div className={styles.platHead}><span className={styles.platTitle}>Meta Ads</span>{viewing?.account && <span className={styles.platId}>{viewing.account}</span>}</div>
                  <div className={styles.kpiRow}>{[ { label: 'Investido', value: `R$ ${fmt(tSpend)}` }, { label: 'Imp', value: fmtI(tImp) }, { label: 'Cliques', value: fmtN(tClk) }, { label: 'CTR', value: `${avgCtr.toFixed(2)}%` }, { label: 'Conversas', value: fmtN(tConv) }, { label: 'ROAS', value: `${totRoas.toFixed(2)}x` } ].map(k => (<div key={k.label} className={styles.kpiMini}><div className={styles.kpiMiniLabel}>{k.label}</div><div className={styles.kpiMiniValue}>{k.value}</div></div>))}</div>
                </div>
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
            </div>
          </div>
        </div>
      </div>
      {modalOpen && <AccountModal data={modalEdit || {}} loading={modalLoading} error={modalError} userRole={sess?.role} onSave={saveClient} onArchive={archiveClient} onDelete={deleteClient} onClose={() => { setModalOpen(false); setModalEdit(null); setModalError('') }} />}
      {metricsModalOpen && <MetricsModal visible={visibleMetrics} onToggle={toggleMetric} onReset={resetMetrics} onClose={() => setMetricsModalOpen(false)} />}
      <AdPreviewModal html={previewHtml} loading={previewLoading} adName={previewAdName} onClose={() => { setPreviewHtml(null); setPreviewLoading(false) }} />
      <NovoRelatorioModal isOpen={novoRelatorioOpen} clienteName={viewing?.name || ''} onClose={() => setNovoRelatorioOpen(false)} onConfirm={handleNovoRelatorioConfirm} />
    </div>
  )
}
