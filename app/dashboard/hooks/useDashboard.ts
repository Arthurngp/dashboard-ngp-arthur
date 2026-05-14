'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { metaCall } from '@/lib/meta'
import { fetchWithRetry } from '@/lib/fetch-utils'
import { parseIns, fmt, fmtN, fmtI } from '@/lib/utils'
import { clearSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { Campaign, Adset, Ad, Cliente, Relatorio, DateParam } from '@/types'
import {
  Screen, Tab, BudgetAlert, Viewing, OverviewRow,
  OVERVIEW_COLUMNS
} from '../types'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import {
  getDefaultComparisonForLast30,
  normalizeOverviewMetrics,
  calcDerived,
  getPeriodBudgetFactor,
} from '../dashboard-utils'
import { getRequiredApiFields, META_METRICS, DEFAULT_METRICS } from '@/lib/meta-metrics'
import { buildAnalyticsSnapshot } from '@/lib/analytics-snapshot'
import { efCall } from '@/lib/api'

export function useDashboard() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [mounted, setMounted] = useState(false)
  const defaultComparison = getDefaultComparisonForLast30()

  useEffect(() => {
    const currentSession = getSession()
    if (!currentSession || currentSession.auth !== '1') { router.replace('/login'); return }
    if (currentSession.role !== 'ngp' && currentSession.role !== 'admin') { router.replace('/cliente'); return }
    setSess(currentSession)
    setMounted(true)
  }, [router])

  // ── Screens & tabs ──────────────────────────────────────────────────────
  const [screen, setScreen]       = useState<Screen>('select')
  const [activeTab, setActiveTab] = useState<Tab>('resumo')

  // ── Account selector ────────────────────────────────────────────────────
  const [clients, setClients]     = useState<Cliente[]>([])
  const [search, setSearch]       = useState('')
  const [initLoad, setInitLoad]   = useState(true)
  const [viewing, setViewing]     = useState<Viewing | null>(null)
  const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([])
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewAutoRefresh, setOverviewAutoRefresh] = useState(false)
  const [overviewLastUpdated, setOverviewLastUpdated] = useState('')
  const overviewRequestRef = useRef(0)
  const lastSnapshotSaveRef = useRef('')

  const [visibleOverviewCols, setVisibleOverviewCols] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ngp_overview_cols')
      return saved ? JSON.parse(saved) : OVERVIEW_COLUMNS.map(c => c.id)
    }
    return OVERVIEW_COLUMNS.map(c => c.id)
  })

  useEffect(() => {
    localStorage.setItem('ngp_overview_cols', JSON.stringify(visibleOverviewCols))
  }, [visibleOverviewCols])

  const toggleColumn = (id: string) => {
    setVisibleOverviewCols(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }

  const [colMenuOpen, setColMenuOpen] = useState(false)

  // ── Campaign data ───────────────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [period, setPeriod]       = useState<DateParam>({ date_preset: 'last_30d' })
  const [periodLabel, setPeriodLabel] = useState('Últimos 30 dias')

  // ── Campanhas tab ────────────────────────────────────────────────────────
  const [campSearch, setCampSearch] = useState('')
  const [campStatus, setCampStatus] = useState('all')
  const [adsetMap, setAdsetMap]     = useState<Record<string, Adset[]>>({})
  const [adsMap, setAdsMap]         = useState<Record<string, Ad[]>>({})
  const [openCamps, setOpenCamps]   = useState<Set<string>>(new Set())
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set())
  const [loadingAdsets, setLoadingAdsets] = useState<Set<string>>(new Set())
  const [loadingAds, setLoadingAds]       = useState<Set<string>>(new Set())

  // ── Charts ───────────────────────────────────────────────────────────────
  const [chartMetric, setChartMetric] = useState<'spend' | 'impressions' | 'clicks'>('spend')

  // ── Breakdowns ────────────────────────────────────────────────────────────
  const [breakdownType, setBreakdownType] = useState<'by_day' | 'by_device' | 'by_placement'>('by_day')
  const [breakdownMetric, setBreakdownMetric] = useState<'spend' | 'impressions' | 'clicks'>('spend')
  const [breakdownData, setBreakdownData] = useState<Array<{ name: string; value: number }>>([])
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownError, setBreakdownError] = useState('')

  // ── Time series data ───────────────────────────────────────────────────────
  const [timeSeriesData, setTimeSeriesData] = useState<Array<{ date: string; spend: number; impressions: number; clicks: number; actions?: Array<{ action_type: string; value: string }> }>>([])
  const [timeSeriesLoading, setTimeSeriesLoading] = useState(false)
  const [timeSeriesError, setTimeSeriesError] = useState('')

  // ── Comparison period ────────────────────────────────────────────────────
  const [prevCampaigns, setPrevCampaigns] = useState<Campaign[]>([])
  const [cmpPeriodParam, setCmpPeriodParam] = useState<DateParam | undefined>(defaultComparison.dp)
  const [cmpLabel, setCmpLabel] = useState(defaultComparison.label)

  // ── Relatórios ───────────────────────────────────────────────────────────
  const [relatorios, setRelatorios] = useState<Relatorio[]>([])

  // ── Notificações (alertas de saldo) ─────────────────────────────────────
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertsDismissed, setAlertsDismissed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('adsboard_dismissed_alerts')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  // ── Campaign filter (resumo) ─────────────────────────────────────────────
  // Persistido por conta Meta no localStorage. Mudar período NÃO reseta:
  // o usuário pode estar analisando as mesmas campanhas em períodos diferentes.
  const [selectedCampIds, setSelectedCampIds] = useState<Set<string>>(new Set())
  const [campFilterOpen, setCampFilterOpen]   = useState(false)

  // Carrega a seleção salva ao trocar de conta
  useEffect(() => {
    if (!viewing?.account) { setSelectedCampIds(new Set()); return }
    try {
      const saved = localStorage.getItem(`ngp:campFilter:${viewing.account}`)
      setSelectedCampIds(saved ? new Set(JSON.parse(saved)) : new Set())
    } catch { setSelectedCampIds(new Set()) }
  }, [viewing])

  // Persiste a seleção sempre que muda
  useEffect(() => {
    if (!viewing?.account) return
    const key = `ngp:campFilter:${viewing.account}`
    try {
      if (selectedCampIds.size === 0) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(Array.from(selectedCampIds)))
    } catch {}
  }, [selectedCampIds, viewing])

  // ── Metrics customizer ───────────────────────────────────────────────────
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('adsboard_visible_metrics')
      return saved ? JSON.parse(saved) : DEFAULT_METRICS
    } catch { return DEFAULT_METRICS }
  })
  const [metricsModalOpen, setMetricsModalOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewAdName, setPreviewAdName] = useState('')
  const [topAdsSort, setTopAdsSort] = useState<'spend' | 'ctr' | 'cpc' | 'results'>('spend')
  const [campaignSearch, setCampaignSearch] = useState('')

  // ── Account modal ────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen]     = useState(false)
  const [modalEdit, setModalEdit]     = useState<Partial<Cliente> | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError]   = useState('')

  // ── Table filters ────────────────────────────────────────────────────────
  const [tableSearch, setTableSearch] = useState('')
  const [tableStatus, setTableStatus] = useState('all')

  // ─── API Functions ────────────────────────────────────────────────────────
  const loadClientsAbortRef = useRef<AbortController | null>(null)
  const loadClients = useCallback(async () => {
    setInitLoad(true)
    loadClientsAbortRef.current?.abort()
    loadClientsAbortRef.current = new AbortController()
    try {
      const res = await fetchWithRetry(
        `${SURL}/functions/v1/get-ngp-data`,
        { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: sess?.session }), signal: loadClientsAbortRef.current.signal },
      )
      const data = await res.json()
      if (data.clientes) setClients(data.clientes)
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error('[loadClients]', e)
    }
    setInitLoad(false)
  }, [sess?.session])

  const loadOverviewData = useCallback(async (dp: DateParam = period, cmpDp: DateParam | undefined = cmpPeriodParam) => {
    if (!clients.length) {
      setOverviewRows([])
      return
    }

    const requestId = ++overviewRequestRef.current
    setOverviewLoading(true)
    setOverviewError('')

    const orderedClients = [...clients].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
    const rows: OverviewRow[] = []

    const loadClientOverview = async (client: Cliente): Promise<OverviewRow> => {
      if (!client.meta_account_id) {
        return { client, current: null, previous: null, status: 'no_account' }
      }

      try {
        const fieldsToFetch = getRequiredApiFields(visibleMetrics).join(',')
        const [currentData, previousData] = await Promise.all([
          metaCall('insights', {
            level: 'account',
            fields: fieldsToFetch,
            limit: '1',
            ...dp,
          }, client.meta_account_id),
          cmpDp
            ? metaCall('insights', {
                level: 'account',
                fields: fieldsToFetch,
                limit: '1',
                ...cmpDp,
              }, client.meta_account_id)
            : Promise.resolve(null),
        ])

        return {
          client,
          current: normalizeOverviewMetrics(currentData?.data?.[0] as Record<string, unknown> | undefined),
          previous: previousData?.data?.[0]
            ? normalizeOverviewMetrics(previousData.data[0] as Record<string, unknown>)
            : null,
          status: 'ok',
        }
      } catch (error) {
        return {
          client,
          current: null,
          previous: null,
          status: 'error',
          error: error instanceof Error ? error.message : 'Falha ao carregar dados.',
        }
      }
    }

    try {
      const chunkSize = 4
      for (let index = 0; index < orderedClients.length; index += chunkSize) {
        const batch = orderedClients.slice(index, index + chunkSize)
        const batchResults = await Promise.all(batch.map(loadClientOverview))
        rows.push(...batchResults)
        if (overviewRequestRef.current !== requestId) return
        setOverviewRows([...rows])
      }

      if (overviewRequestRef.current !== requestId) return
      setOverviewLastUpdated(new Date().toISOString())
    } catch (error) {
      if (overviewRequestRef.current !== requestId) return
      setOverviewError(error instanceof Error ? error.message : 'Erro ao carregar a visão geral.')
    } finally {
      if (overviewRequestRef.current === requestId) setOverviewLoading(false)
    }
  }, [clients, period, cmpPeriodParam, visibleMetrics])

  // Em vez de bloquear novas requisições enquanto uma está em curso (que descarta cliques
  // rápidos no "Aplicar"), usamos um request-id: só aceita o resultado da chamada mais recente.
  const loadDataReqIdRef = useRef(0)
  const loadData = useCallback(async (dp: DateParam = period) => {
    if (!viewing) return
    const reqId = ++loadDataReqIdRef.current
    setLoading(true); setError('')
    try {
      const fieldsToFetch = ['campaign_id', 'campaign_name', ...getRequiredApiFields(visibleMetrics)].join(',')
      const [d, campData] = await Promise.all([
        metaCall('insights', {
          level: 'campaign', fields: fieldsToFetch, limit: '100', ...dp,
        }, viewing.account),
        metaCall('campaigns', {
          fields: 'id,effective_status,objective', limit: '100',
        }, viewing.account),
      ])
      // Descarta resultado se uma requisição mais recente foi disparada
      if (reqId !== loadDataReqIdRef.current) return
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error))

      const statusMap: Record<string, string> = {}
      const objectiveMap: Record<string, string> = {}
      if (campData?.data) {
        for (const c of campData.data as { id: string; effective_status: string; objective: string }[]) {
          statusMap[c.id] = c.effective_status || ''
          objectiveMap[c.id] = c.objective || ''
        }
      }

      const mapped = (d.data || []).map((c: Record<string, unknown>) => {
        const campId = String(c.campaign_id || '')
        return {
          id: campId, name: String(c.campaign_name || ''),
          status: statusMap[campId] || '', objective: objectiveMap[campId] || '',
          ...(parseIns(c) || {}),
        }
      }) as Campaign[]
      setCampaigns(mapped.sort((a, b) => b.spend - a.spend))
    } catch (e: unknown) {
      if (reqId !== loadDataReqIdRef.current) return
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados')
    } finally {
      // Só limpa loading se for a request mais recente
      if (reqId === loadDataReqIdRef.current) setLoading(false)
    }
  }, [viewing, period, visibleMetrics])

  const loadPrevData = useCallback(async (dp: DateParam) => {
    if (!viewing) return
    try {
      const fieldsToFetch = ['campaign_id', 'campaign_name', ...getRequiredApiFields(visibleMetrics)].join(',')
      const d = await metaCall('insights', {
        level: 'campaign', fields: fieldsToFetch, limit: '100', ...dp,
      }, viewing.account)
      if (d.error) return
      const mapped = (d.data || []).map((c: Record<string, unknown>) => ({
        id: String(c.campaign_id || ''), name: String(c.campaign_name || ''),
        status: '', objective: '',
        ...(parseIns(c) || {}),
      })) as Campaign[]
      setPrevCampaigns(mapped)
    } catch {}
  }, [viewing, visibleMetrics])

  const loadAdsets = useCallback(async (campId: string, dp: DateParam = period) => {
    if (adsetMap[campId]) return
    setLoadingAdsets(p => new Set(p).add(campId))
    try {
      const d = await metaCall(`${campId}/adsets`, {
        fields: 'id,name,status,insights{spend,impressions,clicks,ctr,cpc,actions,action_values,purchase_roas}',
        limit: '50', ...dp,
      }, viewing?.account)
      setAdsetMap(p => ({
        ...p,
        [campId]: (d.data || []).map((a: Record<string, unknown>) => ({
          id: a.id, name: a.name, status: a.status,
          ...(parseIns((a.insights as { data?: unknown[] })?.data?.[0] as Record<string, unknown> || {}) || {}),
        })) as Adset[],
      }))
    } catch {}
    setLoadingAdsets(p => { const s = new Set(p); s.delete(campId); return s })
  }, [adsetMap, viewing?.account, period])

  const loadAds = useCallback(async (adsetId: string, dp: DateParam = period) => {
    if (adsMap[adsetId]) return
    setLoadingAds(p => new Set(p).add(adsetId))
    try {
      const d = await metaCall(`${adsetId}/ads`, {
        fields: 'id,name,status,creative{thumbnail_url},insights{spend,impressions,clicks,ctr,cpc,actions,action_values,purchase_roas}',
        limit: '50', ...dp,
      }, viewing?.account)
      setAdsMap(p => ({
        ...p,
        [adsetId]: (d.data || []).map((a: Record<string, unknown>) => ({
          id: a.id, name: a.name, status: a.status, creative: a.creative,
          ...(parseIns((a.insights as { data?: unknown[] })?.data?.[0] as Record<string, unknown> || {}) || {}),
        })) as Ad[],
      }))
    } catch {}
    setLoadingAds(p => { const s = new Set(p); s.delete(adsetId); return s })
  }, [adsMap, viewing?.account, period])

  const loadAllCampaignData = useCallback(async (campId: string) => {
    if (!viewing) return
    let adsets = adsetMap[campId]
    if (!adsets) {
      setLoadingAdsets(p => new Set(p).add(campId))
      try {
        const d = await metaCall(`${campId}/adsets`, {
          fields: 'id,name,status,insights{spend,impressions,clicks,ctr,cpc}',
          limit: '50', ...period
        }, viewing.account)
        adsets = (d.data || []).map((as: Record<string, unknown>) => ({
          id: as.id, name: as.name, status: as.status,
          ...(parseIns((as.insights as { data?: unknown[] })?.data?.[0] as Record<string, unknown> || {}) || {}),
        })) as Adset[]
        setAdsetMap(p => ({ ...p, [campId]: adsets! }))
      } catch (e) {
        console.error('Erro ao carregar conjuntos:', e)
        return
      } finally {
        setLoadingAdsets(p => { const s = new Set(p); s.delete(campId); return s })
      }
    }
    if (!adsets) return
    setOpenCamps(p => new Set(p).add(campId))
    const newAdsets = new Set(openAdsets)
    adsets.forEach(as => newAdsets.add(as.id))
    setOpenAdsets(newAdsets)
    for (const as of adsets) {
      if (!adsMap[as.id]) {
        await loadAds(as.id)
      }
    }
  }, [viewing, adsetMap, period, openAdsets, adsMap, loadAds])

  const loadPreview = useCallback(async (adId: string, adName: string) => {
    if (!viewing) return
    setPreviewLoading(true)
    setPreviewAdName(adName)
    setPreviewHtml(null)
    try {
      let d = await metaCall(`${adId}/previews`, { ad_format: 'DESKTOP_FEED_STANDARD' }, viewing.account)
      if (!d.data?.[0]?.body) {
        d = await metaCall(`${adId}/previews`, { ad_format: 'MOBILE_FEED_STANDARD' }, viewing.account)
      }
      if (d.data?.[0]?.body) {
        setPreviewHtml(d.data[0].body)
      } else {
        setPreviewHtml('<div style="padding:40px;text-align:center;color:#6E6E73;font-family:sans-serif;"><h3>Preview indisponível</h3><p style="font-size:12px">Este formato de anúncio não possui um preview compatível com o navegador.</p></div>')
      }
    } catch (err) {
      setPreviewHtml('<div style="padding:40px;text-align:center;color:#dc2626;font-family:sans-serif;"><h3>Erro de Permissão</h3><p style="font-size:12px">Não foi possível carregar o preview. Verifique se o token tem permissões de anúncios.</p></div>')
    }
    setPreviewLoading(false)
  }, [viewing])

  const breakdownInflightRef = useRef(false)
  const loadBreakdown = useCallback(async (type: 'by_day' | 'by_device' | 'by_placement', metric: 'spend' | 'impressions' | 'clicks', dp: DateParam = period) => {
    if (!viewing) return
    if (breakdownInflightRef.current) return
    breakdownInflightRef.current = true
    setBreakdownLoading(true)
    setBreakdownError('')
    try {
      const params: Record<string, string> = { level: 'account', fields: metric, limit: '100', ...dp }
      if (type === 'by_day') params.time_increment = '1'
      else if (type === 'by_device') params.breakdowns = 'impression_device'
      else params.breakdowns = 'publisher_platform'

      const response = await metaCall('insights', params, viewing.account)
      const rows = Array.isArray(response?.data) ? response.data as Record<string, unknown>[] : []
      const data = rows.map((row) => {
        const rawValue = Number(row[metric] || 0)
        if (!Number.isFinite(rawValue) || rawValue <= 0) return null
        let name = ''
        if (type === 'by_day') {
          name = String(row.date_start || '')
          try { name = new Date(`${name}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch {}
        } else if (type === 'by_device') name = String(row.impression_device || 'desconhecido')
        else name = String(row.publisher_platform || 'desconhecido')
        return { name: name || 'não informado', value: rawValue }
      }).filter((item): item is { name: string; value: number } => item !== null)
      setBreakdownData(type === 'by_day' ? data : data.sort((a, b) => b.value - a.value))
    } catch (e) {
      setBreakdownError(e instanceof Error ? e.message : 'Não foi possível carregar o breakdown real da Meta.')
      setBreakdownData([])
    } finally {
      setBreakdownLoading(false)
      breakdownInflightRef.current = false
    }
  }, [viewing, period])

  const timeSeriesInflightRef = useRef(false)
  const loadTimeSeries = useCallback(async (dp: DateParam = period) => {
    if (!viewing) return
    if (timeSeriesInflightRef.current) return
    timeSeriesInflightRef.current = true
    setTimeSeriesLoading(true)
    setTimeSeriesError('')
    try {
      const response = await metaCall('insights', { level: 'account', fields: 'spend,impressions,clicks,actions', time_increment: '1', limit: '100', ...dp }, viewing.account)
      const rows = Array.isArray(response?.data) ? response.data as Record<string, unknown>[] : []
      const data = rows.map((row) => {
        const iso = String(row.date_start || '')
        let dateLabel = iso
        try { dateLabel = new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) } catch {}
        const actions = Array.isArray(row.actions) ? row.actions as Array<{ action_type: string; value: string }> : undefined
        return { date: dateLabel, spend: Number(row.spend || 0), impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0), actions }
      })
      setTimeSeriesData(data)
    } catch (e) {
      setTimeSeriesError(e instanceof Error ? e.message : 'Erro ao carregar série temporal.')
    } finally {
      setTimeSeriesLoading(false)
      timeSeriesInflightRef.current = false
    }
  }, [viewing, period])

  // ─── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sess || (sess.role !== 'ngp' && sess.role !== 'admin')) return
    const vAcc  = sessionStorage.getItem('ngp_viewing_account')
    const vName = sessionStorage.getItem('ngp_viewing_name')
    const vUser = sessionStorage.getItem('ngp_viewing_username')
    const vId   = sessionStorage.getItem('ngp_viewing_id')
    if (vAcc && vName && vUser) {
      setViewing({ account: vAcc, name: vName, username: vUser, id: vId || '' })
      setScreen('dashboard')
    }
    loadClients()
  }, [sess, loadClients])

  useEffect(() => {
    if (!viewing) return
    loadData()
    if (cmpPeriodParam) loadPrevData(cmpPeriodParam)
  }, [viewing, loadData, loadPrevData, cmpPeriodParam])

  useEffect(() => {
    if (activeTab === 'campanhas' && viewing && !breakdownLoading && breakdownData.length === 0) {
      loadBreakdown(breakdownType, breakdownMetric, period)
      campaigns.forEach(c => loadAdsets(c.id, period))
    }
  }, [activeTab, viewing, campaigns, loadBreakdown, breakdownType, breakdownMetric, period, loadAdsets, breakdownLoading, breakdownData.length])

  useEffect(() => {
    if (activeTab === 'graficos' && viewing && !timeSeriesLoading && timeSeriesData.length === 0) {
      loadTimeSeries(period)
    }
  }, [activeTab, viewing, period, loadTimeSeries, timeSeriesLoading, timeSeriesData.length])

  useEffect(() => {
    Object.keys(adsetMap).forEach(campId => {
      const adsets = adsetMap[campId] || []
      adsets.forEach(as => {
        if (!adsMap[as.id]) loadAds(as.id, period)
      })
    })
  }, [adsetMap, adsMap, period, loadAds])

  useEffect(() => {
    if (screen !== 'select' || !clients.length) return
    loadOverviewData(period, cmpPeriodParam)
  }, [screen, clients.length, period, cmpPeriodParam, loadOverviewData])

  useEffect(() => {
    if (!overviewAutoRefresh || screen !== 'select') return
    const intervalId = window.setInterval(() => {
      loadOverviewData(period, cmpPeriodParam)
    }, 300000)
    return () => window.clearInterval(intervalId)
  }, [overviewAutoRefresh, screen, period, cmpPeriodParam, loadOverviewData])

  // ─── Actions ─────────────────────────────────────────────────────────────
  const selectAccount = (c: Cliente) => {
    const acc = { account: c.meta_account_id || '', name: c.nome, username: c.username, id: c.id }
    setViewing(acc)
    setScreen('dashboard')
    sessionStorage.setItem('ngp_viewing_account', acc.account)
    sessionStorage.setItem('ngp_viewing_name', acc.name)
    sessionStorage.setItem('ngp_viewing_username', acc.username)
    sessionStorage.setItem('ngp_viewing_id', acc.id)
  }

  function toggleMetric(id: string) {
    setVisibleMetrics(prev => {
      const next = prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
      localStorage.setItem('adsboard_visible_metrics', JSON.stringify(next))
      return next
    })
  }

  function resetMetrics() {
    setVisibleMetrics(DEFAULT_METRICS)
    localStorage.setItem('adsboard_visible_metrics', JSON.stringify(DEFAULT_METRICS))
  }

  // ─── Derived Data (Memoized) ─────────────────────────────────────────────
  const currentClient = useMemo(() => viewing ? clients.find(c => c.id === viewing.id) : null, [viewing, clients])
  const monthlyAuthorized = useMemo(() => Number(currentClient?.investimento_autorizado_mensal || 0), [currentClient])

  const metricsBase = useMemo(() => selectedCampIds.size > 0
    ? campaigns.filter(c => selectedCampIds.has(c.id))
    : campaigns, [selectedCampIds, campaigns])

  const tSpend = useMemo(() => metricsBase.reduce((s, c) => s + c.spend, 0), [metricsBase])
  const totalPeriodSpend = useMemo(() => campaigns.reduce((s, c) => s + c.spend, 0), [campaigns])

  const tParsed = useMemo(() => {
    const data: Record<string, number> = {}
    META_METRICS.forEach(m => {
      if ((m.format === 'integer' || m.format === 'compact' || m.format === 'currency') &&
          !m.id.startsWith('cost_per_') && m.id !== 'cpm' && m.id !== 'cpc') {
        data[m.id] = metricsBase.reduce((s, c) => s + (Number(c[m.id as keyof Campaign]) || 0), 0)
      }
    })
    calcDerived(data, tSpend)
    return data
  }, [metricsBase, tSpend])

  const pSpend = useMemo(() => prevCampaigns.reduce((s, c) => s + c.spend, 0), [prevCampaigns])
  const pParsed = useMemo(() => {
    const data: Record<string, number> = {}
    if (prevCampaigns.length === 0) return data
    META_METRICS.forEach(m => {
      if ((m.format === 'integer' || m.format === 'compact' || m.format === 'currency') &&
          !m.id.startsWith('cost_per_') && m.id !== 'cpm' && m.id !== 'cpc') {
        data[m.id] = prevCampaigns.reduce((s, c) => s + (Number(c[m.id as keyof Campaign]) || 0), 0)
      }
    })
    calcDerived(data, pSpend)
    return data
  }, [prevCampaigns, pSpend])

  const totRes = useMemo(() => (tParsed['conversations'] || 0) + (tParsed['leads'] || 0) + (tParsed['purchases'] || 0), [tParsed])
  const resultLabel = useMemo(() => (tParsed['conversations'] || 0) > 0 ? 'Conversas' : (tParsed['leads'] || 0) > 0 ? 'Leads' : (tParsed['purchases'] || 0) > 0 ? 'Compras' : 'Resultados', [tParsed])
  const costPerResult = useMemo(() => totRes > 0 ? (tSpend / totRes) : 0, [tSpend, totRes])

  const filteredOverviewRows = useMemo(() => overviewRows
    .filter(({ client }) =>
      !search || client.nome.toLowerCase().includes(search.toLowerCase()) ||
      (client.meta_account_id || '').includes(search)
    )
    .sort((a, b) => a.client.nome.localeCompare(b.client.nome, 'pt-BR', { sensitivity: 'base' })), [overviewRows, search])

  const overviewTotals = useMemo(() => filteredOverviewRows.reduce(
    (acc, row) => {
      if (row.current) {
        acc.current.spend += row.current.spend
        acc.current.impressions += row.current.impressions
        acc.current.clicks += row.current.clicks
        acc.current.reach += row.current.reach
        acc.current.results += row.current.results
        acc.current.leads += row.current.leads
        acc.current.revenue += row.current.revenue
      }
      if (row.previous) {
        acc.previous.spend += row.previous.spend
        acc.previous.impressions += row.previous.impressions
        acc.previous.clicks += row.previous.clicks
        acc.previous.reach += row.previous.reach
        acc.previous.results += row.previous.results
        acc.previous.leads += row.previous.leads
        acc.previous.revenue += row.previous.revenue
      }
      return acc
    },
    {
      current: { spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0, leads: 0, revenue: 0 },
      previous: { spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0, leads: 0, revenue: 0 },
    }
  ), [filteredOverviewRows])

  const overviewTotalsCtr = useMemo(() => overviewTotals.current.impressions > 0 ? overviewTotals.current.clicks / overviewTotals.current.impressions * 100 : 0, [overviewTotals])
  const overviewTotalsPrevCtr = useMemo(() => overviewTotals.previous.impressions > 0 ? overviewTotals.previous.clicks / overviewTotals.previous.impressions * 100 : 0, [overviewTotals])
  const overviewTotalsCpc = useMemo(() => overviewTotals.current.clicks > 0 ? overviewTotals.current.spend / overviewTotals.current.clicks : 0, [overviewTotals])
  const overviewTotalsPrevCpc = useMemo(() => overviewTotals.previous.clicks > 0 ? overviewTotals.previous.spend / overviewTotals.previous.clicks : 0, [overviewTotals])
  const overviewTotalsCpl = useMemo(() => overviewTotals.current.leads > 0 ? overviewTotals.current.spend / overviewTotals.current.leads : 0, [overviewTotals])
  const overviewTotalsPrevCpl = useMemo(() => overviewTotals.previous.leads > 0 ? overviewTotals.previous.spend / overviewTotals.previous.leads : 0, [overviewTotals])
  const overviewTotalsRoas = useMemo(() => overviewTotals.current.spend > 0 ? overviewTotals.current.revenue / overviewTotals.current.spend : 0, [overviewTotals])
  const overviewTotalsPrevRoas = useMemo(() => overviewTotals.previous.spend > 0 ? overviewTotals.previous.revenue / overviewTotals.previous.spend : 0, [overviewTotals])

  const overviewHeroStats = useMemo(() => [
    { label: 'Contas visíveis', value: String(filteredOverviewRows.length) },
    { label: 'Investimento total', value: `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(overviewTotals.current.spend)}` },
    { label: 'Resultados', value: new Intl.NumberFormat('pt-BR').format(overviewTotals.current.results) },
    { label: 'CTR consolidado', value: `${overviewTotalsCtr.toFixed(2)}%` },
  ], [filteredOverviewRows.length, overviewTotals.current, overviewTotalsCtr])

  const allAds = useMemo(() => Object.values(adsMap).flat(), [adsMap])
  const loadedAds = useMemo(() => allAds.filter(a => a.spend > 0 || a.clicks > 0 || a.impressions > 0), [allAds])

  const analyticsSnapshot = useMemo(() => {
    if (!viewing || screen !== 'dashboard' || !viewing.account) return null
    return buildAnalyticsSnapshot({
      client: { id: viewing.id || null, name: viewing.name, username: viewing.username, metaAccountId: viewing.account },
      period: { label: periodLabel, current: period, comparisonLabel: cmpLabel || null, comparison: cmpPeriodParam || null },
      campaigns: metricsBase,
      prevCampaigns: selectedCampIds.size > 0 ? prevCampaigns.filter(c => selectedCampIds.has(c.id)) : prevCampaigns,
      creatives: loadedAds,
      selectedCampaignIds: Array.from(selectedCampIds),
      monthlyAuthorizedBudget: monthlyAuthorized,
    })
  }, [viewing, screen, periodLabel, period, cmpLabel, cmpPeriodParam, metricsBase, prevCampaigns, selectedCampIds, loadedAds, monthlyAuthorized])

  useEffect(() => {
    if (!analyticsSnapshot || !analyticsSnapshot.client.metaAccountId) return
    const fingerprint = JSON.stringify({
      clientId: analyticsSnapshot.client.id,
      metaAccountId: analyticsSnapshot.client.metaAccountId,
      periodLabel: analyticsSnapshot.period.label,
      comparisonLabel: analyticsSnapshot.period.comparisonLabel,
      spend: analyticsSnapshot.summary.spend,
      results: analyticsSnapshot.summary.primaryResults,
      creatives: analyticsSnapshot.creatives.length,
      filteredCampaigns: analyticsSnapshot.summary.filteredCampaignCount,
    })
    if (lastSnapshotSaveRef.current === fingerprint) return
    lastSnapshotSaveRef.current = fingerprint
    void efCall('analytics-snapshots', { action: 'save', snapshot: analyticsSnapshot }, { silent: true })
  }, [analyticsSnapshot])

  async function saveClient(data: Partial<Cliente>) {
    setModalLoading(true); setModalError('')
    try {
      const res = await fetch(`${SURL}/functions/v1/${data.id ? 'update-cliente' : 'add-cliente'}`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session, ...data }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro')
      await loadClients()
      setModalOpen(false); setModalEdit(null)
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Erro ao salvar')
    }
    setModalLoading(false)
  }

  async function deleteClient(id: string) {
    setModalLoading(true); setModalError('')
    try {
      const res = await fetch(`${SURL}/functions/v1/delete-cliente`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session, id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro ao excluir')
      await loadClients()
      setModalOpen(false); setModalEdit(null)
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Erro ao excluir')
    }
    setModalLoading(false)
  }

  async function archiveClient(id: string) {
    setModalLoading(true); setModalError('')
    try {
      const res = await fetch(`${SURL}/functions/v1/archive-cliente`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session, action: 'archive', id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro ao arquivar')
      await loadClients()
      setModalOpen(false); setModalEdit(null)
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Erro ao arquivar')
    }
    setModalLoading(false)
  }

  function backToSelect() {
    sessionStorage.removeItem('ngp_viewing_account')
    sessionStorage.removeItem('ngp_viewing_name')
    sessionStorage.removeItem('ngp_viewing_username')
    sessionStorage.removeItem('ngp_viewing_id')
    setBreakdownData([]); setTimeSeriesData([])
    setBreakdownError(''); setTimeSeriesError('')
    setViewing(null); setScreen('select')
  }

  function onPeriodApply(dp: DateParam, label: string, cmp?: DateParam, cmpLbl?: string) {
    setPeriod(dp); setPeriodLabel(label)
    setCmpPeriodParam(cmp); setCmpLabel(cmpLbl || '')
    setPrevCampaigns([])
    setAdsetMap({}); setAdsMap({})
    setBreakdownData([]); setTimeSeriesData([])
    setBreakdownError(''); setTimeSeriesError('')
    loadData(dp)
    // Sempre recarrega a série temporal — usada em Gráficos e no PresentMode (sem
    // depender da aba ativa, pra evitar tela "Sem série temporal" quando muda período).
    loadTimeSeries(dp)
    if (cmp) loadPrevData(cmp)
  }

  const loadRelatorios = useCallback(async () => {
    if (!viewing) return
    try {
      const res = await fetch(`${SURL}/functions/v1/get-relatorios`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session, cliente_id: viewing.id, cliente_username: viewing.username }),
      })
      const data = await res.json()
      if (data.relatorios) setRelatorios(data.relatorios)
    } catch {}
  }, [viewing, sess?.session])

  const loadBudgetAlerts = useCallback(async () => {
    setAlertsLoading(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/get-budget-alerts`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess?.session }),
      })
      const data = await res.json()
      if (data.alerts) setBudgetAlerts(data.alerts)
    } catch {}
    setAlertsLoading(false)
  }, [sess?.session])

  const deleteRelatorio = useCallback(async (id: string) => {
    if (!confirm('Remover este relatório?')) return
    await fetch(`${SURL}/functions/v1/delete-relatorio`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ session_token: sess?.session, id }),
    }).catch(() => {})
    setRelatorios(p => p.filter(r => r.id !== id))
  }, [sess?.session])

  function dismissAlert(alertKey: string) {
    setAlertsDismissed(prev => {
      const next = new Set(prev)
      next.add(alertKey)
      localStorage.setItem('adsboard_dismissed_alerts', JSON.stringify([...next]))
      return next
    })
  }

  function clearDismissed() {
    setAlertsDismissed(new Set())
    localStorage.removeItem('adsboard_dismissed_alerts')
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    if (tab === 'relatorios' && relatorios.length === 0) loadRelatorios()
    if (tab === 'notificacoes' && budgetAlerts.length === 0 && !alertsLoading) loadBudgetAlerts()
  }

  function toggleCamp(id: string) {
    setOpenCamps(p => {
      const s = new Set(p)
      if (s.has(id)) { s.delete(id) } else { s.add(id); loadAdsets(id) }
      return s
    })
  }

  function toggleAdset(id: string) {
    setOpenAdsets(p => {
      const s = new Set(p)
      if (s.has(id)) { s.delete(id) } else { s.add(id); loadAds(id) }
      return s
    })
  }

  function logout() {
    fetch(`${SURL}/functions/v1/logout`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ token: sess?.session }),
    }).catch(() => {})
    clearSession(); router.replace('/login')
  }

  return {
    sess, mounted, router,
    screen, setScreen, activeTab, setActiveTab,
    clients, setClients, search, setSearch, initLoad,
    viewing, setViewing, selectAccount,
    overviewRows, setOverviewRows, overviewLoading, overviewError,
    overviewAutoRefresh, setOverviewAutoRefresh, overviewLastUpdated,
    visibleOverviewCols, setVisibleOverviewCols, toggleColumn,
    colMenuOpen, setColMenuOpen,
    campaigns, setCampaigns, loading, setLoading, error, setError,
    period, setPeriod, periodLabel, setPeriodLabel,
    campSearch, setCampSearch, campStatus, setCampStatus,
    adsetMap, setAdsetMap, adsMap, setAdsMap,
    openCamps, setOpenCamps, openAdsets, setOpenAdsets,
    loadingAdsets, setLoadingAdsets, loadingAds, setLoadingAds,
    chartMetric, setChartMetric,
    breakdownType, setBreakdownType, breakdownMetric, setBreakdownMetric,
    breakdownData, setBreakdownData, breakdownLoading, breakdownError,
    timeSeriesData, setTimeSeriesData, timeSeriesLoading, timeSeriesError,
    prevCampaigns, setPrevCampaigns, cmpPeriodParam, setCmpPeriodParam, cmpLabel, setCmpLabel,
    relatorios, setRelatorios,
    budgetAlerts, setBudgetAlerts, alertsLoading, setAlertsLoading, alertsDismissed,
    selectedCampIds, setSelectedCampIds, campFilterOpen, setCampFilterOpen,
    visibleMetrics, setVisibleMetrics, toggleMetric, resetMetrics,
    metricsModalOpen, setMetricsModalOpen,
    previewHtml, setPreviewHtml, previewLoading, setPreviewLoading, previewAdName,
    topAdsSort, setTopAdsSort, campaignSearch, setCampaignSearch,
    modalOpen, setModalOpen, modalEdit, setModalEdit, modalLoading, setModalLoading, modalError, setModalError,
    tableSearch, setTableSearch, tableStatus, setTableStatus,
    loadOverviewData, loadData, loadTimeSeries, loadBreakdown, loadAllCampaignData, loadPreview, loadRelatorios, loadBudgetAlerts,
    // Actions
    saveClient, deleteClient, archiveClient, backToSelect, onPeriodApply, switchTab, toggleCamp, toggleAdset, logout,
    deleteRelatorio, dismissAlert, clearDismissed,
    // Derived
    currentClient, monthlyAuthorized, metricsBase, tSpend, totalPeriodSpend, tParsed, pParsed, totRes, resultLabel, costPerResult,
    filteredOverviewRows, overviewTotals, overviewTotalsCtr, overviewTotalsPrevCtr, overviewTotalsCpc, overviewTotalsPrevCpc,
    overviewTotalsCpl, overviewTotalsPrevCpl, overviewTotalsRoas, overviewTotalsPrevRoas, overviewHeroStats, loadedAds, analyticsSnapshot
  }
}
