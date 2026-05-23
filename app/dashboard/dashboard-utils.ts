// ─── Dashboard Utilities ──────────────────────────────────────────────────────
// Funções puras extraídas de page.tsx para reduzir o tamanho do arquivo principal.

import { parseIns, fmt, fmtN } from '@/lib/utils'
import { DateParam } from '@/types'
import { OverviewMetrics } from './types'

export type DeltaUnit = 'currency' | 'number' | 'percent' | 'multiplier'

export function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return iso }
}

export function getDefaultComparisonForLast30() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const until = new Date(today.getTime() - 31 * 86400000)
  const since = new Date(until.getTime() - 29 * 86400000)
  const fmtIso = (date: Date) => date.toISOString().slice(0, 10)
  const fmtBrDate = (iso: string) => iso.split('-').reverse().join('/')
  const sinceIso = fmtIso(since)
  const untilIso = fmtIso(until)

  return {
    dp: { time_range: JSON.stringify({ since: sinceIso, until: untilIso }) } as DateParam,
    label: `${fmtBrDate(sinceIso)} – ${fmtBrDate(untilIso)}`,
  }
}

export function getPeriodBudgetFactor(dp: DateParam): number {
  if (dp.time_range) {
    try {
      const range = JSON.parse(dp.time_range) as { since?: string; until?: string }
      if (range.since && range.until) {
        const since = new Date(`${range.since}T00:00:00`)
        const until = new Date(`${range.until}T00:00:00`)
        const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000) + 1)
        return days / 30
      }
    } catch {}
  }

  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  switch (dp.date_preset) {
    case 'today':
    case 'yesterday':
      return 1 / 30
    case 'last_7d':
      return 7 / 30
    case 'last_90d':
      return 90 / 30
    case 'this_month':
      return now.getDate() / daysInMonth
    case 'last_month':
    case 'last_30d':
    default:
      return 1
  }
}

export function pctChange(curr: number, prev: number) {
  if (prev <= 0) return null
  return ((curr - prev) / prev) * 100
}

export function formatSignedPct(curr: number, prev: number) {
  const delta = pctChange(curr, prev)
  if (delta === null || !isFinite(delta)) return null
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

function formatAbsoluteDelta(absDelta: number, unit: DeltaUnit): string {
  const sign = absDelta > 0 ? '+' : absDelta < 0 ? '-' : ''
  const mag = Math.abs(absDelta)
  switch (unit) {
    case 'currency':   return `${sign}R$ ${fmt(mag)}`
    case 'percent':    return `${sign}${mag.toFixed(2)}pp`
    case 'multiplier': return `${sign}${mag.toFixed(2)}x`
    default:           return `${sign}${fmtN(mag)}`
  }
}

/**
 * Formata "+R$ 660 (+15.2%)" usando o delta absoluto + percentual.
 * Retorna `null` quando a comparação não é calculável (prev <= 0 ou inf).
 */
export function formatSignedDelta(curr: number, prev: number, unit: DeltaUnit = 'number') {
  const delta = pctChange(curr, prev)
  if (delta === null || !isFinite(delta)) return null
  const absLabel = formatAbsoluteDelta(curr - prev, unit)
  const pctSign = delta > 0 ? '+' : ''
  return `${absLabel} (${pctSign}${delta.toFixed(1)}%)`
}

export function normalizeOverviewMetrics(insight?: Record<string, unknown> | null): OverviewMetrics {
  const parsed = parseIns((insight || {}) as Record<string, unknown>) || {
    spend: 0,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    reach: 0,
    conversations: 0,
    leads: 0,
    purchases: 0,
    purchaseValue: 0,
    roas: 0,
  }
  const results = parsed.conversations || parsed.leads || parsed.purchases || 0
  const resultLabel = parsed.conversations > 0 ? 'Conversas' : parsed.leads > 0 ? 'Leads' : parsed.purchases > 0 ? 'Compras' : 'Resultados'

  return {
    spend: parsed.spend,
    impressions: parsed.impressions,
    clicks: parsed.clicks,
    ctr: parsed.ctr,
    cpc: parsed.cpc,
    cpm: parsed.impressions > 0 ? (parsed.spend / parsed.impressions) * 1000 : 0,
    reach: parsed.reach,
    leads: parsed.leads,
    conversations: parsed.conversations,
    purchases: parsed.purchases,
    roas: parsed.roas,
    revenue: parsed.purchaseValue,
    frequency: parsed.reach > 0 ? parsed.impressions / parsed.reach : 0,
    results,
    resultLabel,
    costPerLead: parsed.leads > 0 ? parsed.spend / parsed.leads : 0,
    costPerResult: results > 0 ? parsed.spend / results : 0,
  }
}

/** Calcula métricas derivadas (ROAS, CPM, CPC, CTR, etc.) in-place */
export function calcDerived(data: Record<string, number>, spend: number) {
  const imp = data['impressions'] || 0
  const clk = data['clicks'] || 0
  const reach = data['reach'] || 0
  const rev = data['revenue'] || 0

  data['roas'] = spend > 0 ? (rev / spend) : 0
  data['cpm'] = imp > 0 ? (spend / imp * 1000) : 0
  data['cpc'] = clk > 0 ? (spend / clk) : 0
  data['ctr'] = imp > 0 ? (clk / imp * 100) : 0
  data['frequency'] = reach > 0 ? (imp / reach) : 0
  data['inline_link_click_ctr'] = imp > 0 ? ((data['inline_link_clicks'] || 0) / imp * 100) : 0

  const costEvents = ['view_content', 'add_to_cart', 'initiate_checkout', 'purchases', 'leads', 'conversations']
  costEvents.forEach(evt => {
    const evts = data[evt] || 0
    const key = evt === 'purchases' ? 'cost_per_purchase'
              : evt === 'initiate_checkout' ? 'cost_per_checkout'
              : evt === 'conversations' ? 'cost_per_conversation'
              : `cost_per_${evt}`
    data[key] = evts > 0 ? spend / evts : 0
  })
}

export function getOverviewDeltaMeta(
  current: number,
  previous: number,
  lowerIsBetter = false,
  unit: DeltaUnit = 'number',
) {
  const delta = pctChange(current, previous)
  if (delta === null || !isFinite(delta)) return null
  const improved = lowerIsBetter ? delta < 0 : delta > 0
  const tone = improved ? 'good' : Math.abs(delta) >= 15 ? 'bad' : 'warn'
  const absLabel = formatAbsoluteDelta(current - previous, unit)
  const pctSign = delta > 0 ? '+' : ''
  return {
    label: `${absLabel} (${pctSign}${delta.toFixed(1)}%)`,
    tone,
  }
}
