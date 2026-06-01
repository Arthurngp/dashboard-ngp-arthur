// Regras de unificação Meta + Google Ads.
//
// Filosofia:
// - Valores absolutos (spend, clicks, impressions, conversions, leads, etc): SOMAR.
// - Taxas/médias (CTR, CPC, CPA, conversion_rate, ROAS): PONDERAR pela base correta.
//   CTR  = clicks_total / impressions_total
//   CPC  = spend_total / clicks_total
//   CPA  = spend_total / conversions_total
//   ROAS = revenue_total / spend_total
// - Frequência/Alcance: só Meta tem. Usa direto do Meta.

import type { GoogleAdsSummary } from './google-ads-metrics'

export interface UnifiedMetric {
  id: string
  label: string
  section: string
  format: 'currency' | 'integer' | 'percent' | 'compact' | 'ratio'
  value: number
  metaValue: number    // contribuição Meta isolada
  googleValue: number  // contribuição Google isolada
  hasGoogleEquivalent: boolean  // se Google tem essa métrica
  prevValue?: number   // valor do período anterior (pra comparativo)
  lowerIsBetter?: boolean
}

// Mapa: meta_metric_id → google_field_id (quando há equivalência)
export const META_TO_GOOGLE_MAP: Record<string, keyof GoogleAdsSummary> = {
  spend: 'spend',
  impressions: 'impressions',
  clicks: 'clicks',
  ctr: 'ctr',
  cpc: 'avg_cpc',
  // 'purchases' do Meta = 'conversions' do Google (aproximação grosseira; cliente concordou na conversa)
  purchases: 'conversions',
  leads: 'conversions',
  cost_per_purchase: 'cpa',
  cost_per_lead: 'cpa',
}

// Métricas que somam direto (absolutas)
const SUMMABLE_ABSOLUTE = new Set(['spend', 'impressions', 'clicks', 'purchases', 'leads', 'revenue', 'view_content', 'add_to_cart', 'initiate_checkout', 'conversations', 'contacts', 'search'])

// Métricas que precisam de cálculo ponderado (taxas/médias)
const WEIGHTED_RATIO_FORMULAS: Record<string, (m: { spend: number; clicks: number; impressions: number; conversions: number; revenue: number }) => number> = {
  ctr: (m) => m.impressions > 0 ? m.clicks / m.impressions : 0,
  cpc: (m) => m.clicks > 0 ? m.spend / m.clicks : 0,
  cpm: (m) => m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0,
  cost_per_purchase: (m) => m.conversions > 0 ? m.spend / m.conversions : 0,
  cost_per_lead: (m) => m.conversions > 0 ? m.spend / m.conversions : 0,
  roas: (m) => m.spend > 0 ? m.revenue / m.spend : 0,
  inline_link_click_ctr: (m) => m.impressions > 0 ? m.clicks / m.impressions : 0,
}

// Calcula uma métrica unificada a partir dos totais Meta + Google.
export function unifyMetric(opts: {
  id: string
  label: string
  section: string
  format: 'currency' | 'integer' | 'percent' | 'compact' | 'ratio'
  metaValue: number
  googleSummary: GoogleAdsSummary | null
  prevMetaValue?: number
  prevGoogleSummary?: GoogleAdsSummary | null
  lowerIsBetter?: boolean
}): UnifiedMetric {
  const googleField = META_TO_GOOGLE_MAP[opts.id]
  const hasGoogleEquivalent = !!googleField && !!opts.googleSummary
  const googleValue = hasGoogleEquivalent && opts.googleSummary
    ? Number(opts.googleSummary[googleField] || 0)
    : 0
  const prevGoogleValue = googleField && opts.prevGoogleSummary
    ? Number(opts.prevGoogleSummary[googleField] || 0)
    : 0

  let unified: number
  let unifiedPrev: number | undefined

  if (SUMMABLE_ABSOLUTE.has(opts.id)) {
    unified = opts.metaValue + googleValue
    if (opts.prevMetaValue !== undefined) {
      unifiedPrev = opts.prevMetaValue + prevGoogleValue
    }
  } else if (WEIGHTED_RATIO_FORMULAS[opts.id]) {
    // Pondera com a base total
    const meta = { spend: 0, clicks: 0, impressions: 0, conversions: 0, revenue: 0 }
    // Esses valores precisam vir de fora — placeholder pra usar o helper diretamente
    // Quem chama esta função pra ratios deve passar os totals já calculados
    unified = opts.metaValue + googleValue // fallback simples; uso correto via unifyMetrics
  } else {
    // Métrica só-Meta (frequência, alcance, etc): usa só Meta
    unified = opts.metaValue
    unifiedPrev = opts.prevMetaValue
  }

  return {
    id: opts.id,
    label: opts.label,
    section: opts.section,
    format: opts.format,
    value: unified,
    metaValue: opts.metaValue,
    googleValue,
    hasGoogleEquivalent,
    prevValue: unifiedPrev,
    lowerIsBetter: opts.lowerIsBetter,
  }
}

// Função "all-in-one" que recebe TUDO e retorna todas as métricas unificadas.
// Aplica regras corretas: somatório + ponderação por base total.
export function unifyAllMetrics(opts: {
  metaParsed: Record<string, number>
  prevMetaParsed: Record<string, number>
  googleSummary: GoogleAdsSummary | null
  prevGoogleSummary: GoogleAdsSummary | null
  metricDefs: Array<{ id: string; label: string; section: string; format: 'currency' | 'integer' | 'percent' | 'compact' | 'ratio'; lowerIsBetter?: boolean }>
}): UnifiedMetric[] {
  // Calcula bases agregadas (vão ser usadas pra ponderar ratios)
  const metaSpend = opts.metaParsed.spend || 0
  const metaClicks = opts.metaParsed.clicks || 0
  const metaImpressions = opts.metaParsed.impressions || 0
  const metaConversions = (opts.metaParsed.purchases || 0) + (opts.metaParsed.leads || 0) + (opts.metaParsed.conversations || 0)
  const metaRevenue = opts.metaParsed.revenue || 0

  const googleSpend = opts.googleSummary?.spend || 0
  const googleClicks = opts.googleSummary?.clicks || 0
  const googleImpressions = opts.googleSummary?.impressions || 0
  const googleConversions = opts.googleSummary?.conversions || 0
  // Google não expõe revenue via Google Ads API direto (só via Analytics/conversion value).

  const totalSpend = metaSpend + googleSpend
  const totalClicks = metaClicks + googleClicks
  const totalImpressions = metaImpressions + googleImpressions
  const totalConversions = metaConversions + googleConversions
  const totalRevenue = metaRevenue // Google revenue = 0 por enquanto

  // Prev period
  const prevMetaSpend = opts.prevMetaParsed.spend || 0
  const prevMetaClicks = opts.prevMetaParsed.clicks || 0
  const prevMetaImp = opts.prevMetaParsed.impressions || 0
  const prevGoogleSpend = opts.prevGoogleSummary?.spend || 0
  const prevGoogleClicks = opts.prevGoogleSummary?.clicks || 0
  const prevGoogleImp = opts.prevGoogleSummary?.impressions || 0

  return opts.metricDefs.map(def => {
    const rawMetaValue = opts.metaParsed[def.id] || 0
    const googleField = META_TO_GOOGLE_MAP[def.id]
    const hasGoogleEquivalent = !!googleField
    const rawGoogleValue = hasGoogleEquivalent && opts.googleSummary
      ? Number(opts.googleSummary[googleField] || 0)
      : 0
    const rawPrevMetaValue = opts.prevMetaParsed[def.id] || 0
    const rawPrevGoogleValue = googleField && opts.prevGoogleSummary
      ? Number(opts.prevGoogleSummary[googleField] || 0)
      : 0
    // Normaliza escalas: Meta retorna percent (1.24 = 1.24%), Google retorna
    // ratio (0.0124 = 1.24%). Pra split por plataforma ficar consistente,
    // converte Meta percent → ratio quando o def.format é 'percent'.
    const metaValue   = def.format === 'percent' ? rawMetaValue / 100   : rawMetaValue
    const googleValue = rawGoogleValue // já é ratio
    const prevMetaValue   = def.format === 'percent' ? rawPrevMetaValue / 100   : rawPrevMetaValue
    const prevGoogleValue = rawPrevGoogleValue

    let value: number
    let prevValue: number

    // Decide regra de unificação
    if (def.id === 'ctr' || def.id === 'inline_link_click_ctr') {
      value = totalImpressions > 0 ? totalClicks / totalImpressions : 0
      const prevTotalClicks = prevMetaClicks + prevGoogleClicks
      const prevTotalImp = prevMetaImp + prevGoogleImp
      prevValue = prevTotalImp > 0 ? prevTotalClicks / prevTotalImp : 0
    } else if (def.id === 'cpc') {
      value = totalClicks > 0 ? totalSpend / totalClicks : 0
      const prevTotalSpend = prevMetaSpend + prevGoogleSpend
      const prevTotalClicks = prevMetaClicks + prevGoogleClicks
      prevValue = prevTotalClicks > 0 ? prevTotalSpend / prevTotalClicks : 0
    } else if (def.id === 'cpm') {
      value = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
      const prevTotalSpend = prevMetaSpend + prevGoogleSpend
      const prevTotalImp = prevMetaImp + prevGoogleImp
      prevValue = prevTotalImp > 0 ? (prevTotalSpend / prevTotalImp) * 1000 : 0
    } else if (def.id === 'cost_per_purchase' || def.id === 'cost_per_lead' || def.id === 'cost_per_view_content' || def.id === 'cost_per_add_to_cart' || def.id === 'cost_per_checkout' || def.id === 'cost_per_conversation') {
      value = totalConversions > 0 ? totalSpend / totalConversions : 0
      prevValue = 0 // simplificado por enquanto
    } else if (def.id === 'roas') {
      value = totalSpend > 0 ? totalRevenue / totalSpend : 0
      prevValue = prevMetaSpend > 0 ? (opts.prevMetaParsed.revenue || 0) / prevMetaSpend : 0
    } else if (SUMMABLE_ABSOLUTE.has(def.id) || hasGoogleEquivalent) {
      // Métrica absoluta: soma Meta + Google (se Google tiver o equivalente)
      value = metaValue + googleValue
      prevValue = prevMetaValue + prevGoogleValue
    } else {
      // Métrica só-Meta (frequency, reach, etc): usa Meta direto
      value = metaValue
      prevValue = prevMetaValue
    }

    return {
      id: def.id,
      label: def.label,
      section: def.section,
      format: def.format,
      value,
      metaValue,
      googleValue,
      hasGoogleEquivalent,
      prevValue,
      lowerIsBetter: def.lowerIsBetter,
    }
  })
}

// Formata valor pra exibição baseado no tipo.
export function formatMetricValue(value: number, format: UnifiedMetric['format']): string {
  if (!isFinite(value) || isNaN(value)) return '—'
  switch (format) {
    case 'currency':
      return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'percent':
      // Por convenção, valores `percent` sempre chegam aqui como RATIO (0-1).
      // Quem unifica métricas (unifyAllMetrics) já normaliza Meta percent → ratio.
      return `${(value * 100).toFixed(2)}%`
    case 'ratio':
      return `${value.toFixed(2)}x`
    case 'compact':
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
      if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
      return Math.round(value).toString()
    case 'integer':
      return Math.round(value).toLocaleString('pt-BR')
  }
}

// Calcula variação percentual com tratamento de edge cases.
export function calcVariation(current: number, previous: number): { pct: number; direction: 'up' | 'down' | 'flat' } | null {
  if (previous === 0) return null
  const diff = current - previous
  const pct = (diff / previous) * 100
  if (Math.abs(pct) < 0.1) return { pct: 0, direction: 'flat' }
  return { pct, direction: pct > 0 ? 'up' : 'down' }
}
