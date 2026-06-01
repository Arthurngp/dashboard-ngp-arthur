import { useState, useCallback, useRef } from 'react'
import { googleAdsCall, type GoogleAdsDateRange } from '@/lib/google-ads'
import type { DateParam } from '@/types'
import type {
  GoogleAdsCampaign, GoogleAdsSummary,
  SearchTermRow, KeywordRow, DeviceRow, LocationRow, HourlyRow, DemoRow, AdRow, DailyRow,
} from '@/lib/google-ads-metrics'

// Mapeia preset de período do Meta para o formato Google Ads (GAQL DURING).
function presetToGoogle(preset?: string): string {
  switch (preset) {
    case 'today': return 'TODAY'
    case 'yesterday': return 'YESTERDAY'
    case 'last_7d': return 'LAST_7_DAYS'
    case 'last_14d': return 'LAST_14_DAYS'
    case 'last_30d': return 'LAST_30_DAYS'
    case 'this_month': return 'THIS_MONTH'
    case 'last_month': return 'LAST_MONTH'
    case 'this_quarter': return 'THIS_QUARTER'
    case 'last_quarter': return 'LAST_QUARTER'
    case 'this_year': return 'THIS_YEAR'
    case 'last_year': return 'LAST_YEAR'
    default: return 'LAST_30_DAYS'
  }
}

/**
 * Converte DateParam (preset OU time_range com since/until) no formato aceito
 * pelo backend Google Ads:
 *   - { since, until } quando período é custom
 *   - string preset (LAST_30_DAYS, etc) quando é preset conhecido
 *
 * Aceita também string solta (legacy: passa um preset Meta direto).
 */
function resolveDateRange(input: DateParam | string | undefined): GoogleAdsDateRange {
  if (!input) return 'LAST_30_DAYS'
  if (typeof input === 'string') return presetToGoogle(input)

  // Período custom: { time_range: '{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}' }
  if (input.time_range) {
    try {
      const parsed = JSON.parse(input.time_range) as { since?: string; until?: string }
      if (parsed?.since && parsed?.until) {
        return { since: parsed.since, until: parsed.until }
      }
    } catch {
      // JSON malformado — cai pro preset
    }
  }
  return presetToGoogle(input.date_preset)
}

interface UseGoogleAdsOptions {
  customerId?: string | null
  enabled?: boolean
}

export interface GoogleAdsFullData {
  summary: GoogleAdsSummary | null
  campaigns: GoogleAdsCampaign[]
  hasPmax: boolean
  hasSearch: boolean
  hasDisplay: boolean
  channelTypes: string[]
  searchTerms: SearchTermRow[]
  keywords: KeywordRow[]
  devices: DeviceRow[]
  locations: LocationRow[]
  hourly: HourlyRow[]
  ageGroups: DemoRow[]
  genders: DemoRow[]
  ads: AdRow[]
  daily: DailyRow[]
}

const EMPTY_DATA: GoogleAdsFullData = {
  summary: null,
  campaigns: [],
  hasPmax: false,
  hasSearch: false,
  hasDisplay: false,
  channelTypes: [],
  searchTerms: [],
  keywords: [],
  devices: [],
  locations: [],
  hourly: [],
  ageGroups: [],
  genders: [],
  ads: [],
  daily: [],
}

export function useGoogleAds({ customerId, enabled = true }: UseGoogleAdsOptions) {
  const [data, setData] = useState<GoogleAdsFullData>(EMPTY_DATA)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reqIdRef = useRef(0)

  const load = useCallback(async (dateInput: DateParam | string = 'last_30d') => {
    if (!enabled || !customerId) {
      setData(EMPTY_DATA)
      return
    }
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError('')
    try {
      const period = resolveDateRange(dateInput)

      // Primeiro busca campaigns (rápido, descobre quais painéis fazem sentido).
      const campaignsData = await googleAdsCall(customerId, 'campaigns', period)
      if (reqId !== reqIdRef.current) return
      if (campaignsData?.error) {
        setError(typeof campaignsData.error === 'string' ? campaignsData.error : 'Erro Google Ads')
        setLoading(false)
        return
      }

      // Atualiza imediatamente o resumo enquanto buscamos o resto.
      const initialUpdate: GoogleAdsFullData = {
        ...EMPTY_DATA,
        summary: campaignsData?.summary || null,
        campaigns: Array.isArray(campaignsData?.campaigns) ? campaignsData.campaigns : [],
        hasPmax: !!campaignsData?.has_pmax,
        hasSearch: !!campaignsData?.has_search,
        hasDisplay: !!campaignsData?.has_display,
        channelTypes: Array.isArray(campaignsData?.channel_types_active) ? campaignsData.channel_types_active : [],
      }
      setData(initialUpdate)

      // Agora dispara as outras queries em paralelo (não bloqueia se uma falhar).
      const [
        searchTermsRes,
        keywordsRes,
        devicesRes,
        locationsRes,
        hourlyRes,
        demoRes,
        adsRes,
        dailyRes,
      ] = await Promise.allSettled([
        initialUpdate.hasSearch || initialUpdate.hasDisplay
          ? googleAdsCall(customerId, 'search_terms' as any, period)
          : Promise.resolve({ search_terms: [] }),
        initialUpdate.hasSearch || initialUpdate.hasDisplay
          ? googleAdsCall(customerId, 'keywords' as any, period)
          : Promise.resolve({ keywords: [] }),
        googleAdsCall(customerId, 'devices' as any, period),
        googleAdsCall(customerId, 'locations' as any, period),
        googleAdsCall(customerId, 'hourly' as any, period),
        googleAdsCall(customerId, 'demographics' as any, period),
        googleAdsCall(customerId, 'top_ads' as any, period),
        googleAdsCall(customerId, 'daily' as any, period),
      ])

      if (reqId !== reqIdRef.current) return

      const unwrap = <T = any,>(res: PromiseSettledResult<any>, key: string, fallback: T): T => {
        if (res.status !== 'fulfilled') return fallback
        const v = res.value?.[key]
        return Array.isArray(v) ? (v as T) : fallback
      }

      const demoRes2 = demoRes.status === 'fulfilled' ? demoRes.value : null

      setData({
        ...initialUpdate,
        searchTerms: unwrap<SearchTermRow[]>(searchTermsRes, 'search_terms', []),
        keywords: unwrap<KeywordRow[]>(keywordsRes, 'keywords', []),
        devices: unwrap<DeviceRow[]>(devicesRes, 'devices', []),
        locations: unwrap<LocationRow[]>(locationsRes, 'locations', []),
        hourly: unwrap<HourlyRow[]>(hourlyRes, 'hourly', []),
        ageGroups: Array.isArray(demoRes2?.age_groups) ? demoRes2.age_groups : [],
        genders: Array.isArray(demoRes2?.genders) ? demoRes2.genders : [],
        ads: unwrap<AdRow[]>(adsRes, 'ads', []),
        daily: unwrap<DailyRow[]>(dailyRes, 'daily', []),
      })
    } catch (e) {
      if (reqId !== reqIdRef.current) return
      setError(e instanceof Error ? e.message : 'Erro Google Ads')
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [customerId, enabled])

  const reset = useCallback(() => {
    setData(EMPTY_DATA)
    setError('')
  }, [])

  return { ...data, loading, error, load, reset }
}
