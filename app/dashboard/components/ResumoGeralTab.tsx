'use client'

// Tab "Resumo Geral" — visão unificada Meta + Google Ads com layout limpo.
// Cada métrica mostra: título, valor unificado, comparação ao período anterior, split por plataforma.

import { useEffect } from 'react'
import { META_METRICS, type MetaMetricDef } from '@/lib/meta-metrics'
import { useGoogleAds } from '../hooks/useGoogleAds'
import { unifyAllMetrics, formatMetricValue, calcVariation, type UnifiedMetric } from '@/lib/cross-platform-metrics'
import type { DateParam } from '@/types'

export type ResumoPlatform = 'all' | 'meta' | 'google'

interface Props {
  metaParsed: Record<string, number>
  prevMetaParsed: Record<string, number>
  cmpLabel: string
  cmpPeriodActive: boolean
  visibleMetrics: string[]
  googleAdsCustomerId?: string | null
  /** Período do dashboard (preset OU time_range com since/until). */
  period: DateParam | string
  periodLabel: string
  onPersonalize: () => void
  platform?: ResumoPlatform
}

export default function ResumoGeralTab(p: Props) {
  const platform: ResumoPlatform = p.platform || 'all'
  const google = useGoogleAds({ customerId: p.googleAdsCustomerId, enabled: platform !== 'meta' })

  // Chave estável que muda quando QUALQUER parte do período muda
  const periodKey = typeof p.period === 'string'
    ? p.period
    : `${p.period?.date_preset || ''}|${p.period?.time_range || ''}`

  useEffect(() => {
    if (p.googleAdsCustomerId && platform !== 'meta') {
      void google.load(p.period)
    }
  }, [p.googleAdsCustomerId, periodKey, platform, google.load, p.period])

  // Pega definições das métricas visíveis
  const metricDefs = p.visibleMetrics
    .map(id => META_METRICS.find(m => m.id === id))
    .filter(Boolean) as MetaMetricDef[]

  // Aplica filtro por plataforma:
  // - 'meta' → zera googleSummary (só Meta na unificação)
  // - 'google' → zera metaParsed (só Google)
  // - 'all' → tudo unificado (default)
  const filteredMeta = platform === 'google' ? {} : p.metaParsed
  const filteredPrevMeta = platform === 'google' ? {} : p.prevMetaParsed
  const filteredGoogle = platform === 'meta' ? null : google.summary

  const unified = unifyAllMetrics({
    metaParsed: filteredMeta,
    prevMetaParsed: filteredPrevMeta,
    googleSummary: filteredGoogle,
    prevGoogleSummary: null,
    metricDefs: metricDefs.map(d => ({ id: d.id, label: d.label, section: d.section, format: d.format, lowerIsBetter: d.lowerIsBetter })),
  })

  // Em modo 'google', filtra fora métricas que não têm equivalente Google
  const finalUnified = platform === 'google'
    ? unified.filter(m => m.hasGoogleEquivalent)
    : unified

  // Agrupa por seção
  const sections: Record<string, UnifiedMetric[]> = {}
  finalUnified.forEach(m => {
    if (!sections[m.section]) sections[m.section] = []
    sections[m.section].push(m)
  })

  const hasGoogle = !!p.googleAdsCustomerId && !!google.summary

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1d1d1f', margin: 0, lineHeight: 1.2 }}>
            {platform === 'meta' && '🔵 Meta Ads'}
            {platform === 'google' && '🟡 Google Ads'}
            {platform === 'all' && '📊 Resumo Geral'}
          </h2>
          <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 4 }}>
            {p.periodLabel}
            {platform === 'all' && (hasGoogle ? ' · Meta + Google Ads' : ' · Meta Ads (Google não vinculado)')}
            {platform === 'meta' && ' · só dados Meta'}
            {platform === 'google' && (p.googleAdsCustomerId ? ' · só dados Google' : ' · Google Ads não vinculado para este cliente')}
          </div>
        </div>
        <button
          onClick={p.onPersonalize}
          style={{ padding: '8px 14px', background: '#fff', border: '1.5px solid #E5E5EA', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer' }}
        >
          + Personalizar métricas
        </button>
      </div>

      {/* Loading indicator do Google */}
      {p.googleAdsCustomerId && google.loading && !google.summary && (
        <div style={{ padding: 12, background: '#FEF3C7', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
          Carregando dados Google Ads...
        </div>
      )}
      {google.error && (
        <div style={{ padding: 12, background: '#FEE2E2', borderRadius: 8, fontSize: 12, color: '#991B1B' }}>
          Google Ads: {google.error}
        </div>
      )}

      {/* Seções */}
      {Object.keys(sections).map(section => (
        <div key={section}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12, paddingLeft: 4 }}>
            {section}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {sections[section].map(m => (
              <MetricCard key={m.id} m={m} cmpActive={p.cmpPeriodActive} cmpLabel={p.cmpLabel} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MetricCard({ m, cmpActive, cmpLabel }: { m: UnifiedMetric; cmpActive: boolean; cmpLabel: string }) {
  const variation = cmpActive && m.prevValue !== undefined ? calcVariation(m.value, m.prevValue) : null

  // Cor da variação: padrão "subir = verde" mas inverte se lowerIsBetter
  let variationColor = '#6E6E73'
  if (variation && variation.direction !== 'flat') {
    const isGood = m.lowerIsBetter ? variation.direction === 'down' : variation.direction === 'up'
    variationColor = isGood ? '#10b981' : '#ef4444'
  }

  return (
    <div style={{ padding: 18, background: '#fff', border: '1px solid #F2F2F7', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Label */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{m.label}</span>
        {!m.hasGoogleEquivalent && (
          <span style={{ fontSize: 9, padding: '2px 5px', background: '#DBEAFE', color: '#1E40AF', borderRadius: 4, fontWeight: 600, letterSpacing: 0 }}>Meta</span>
        )}
      </div>

      {/* Valor principal */}
      <div style={{ fontSize: 24, fontWeight: 800, color: '#1d1d1f', lineHeight: 1.1 }}>
        {formatMetricValue(m.value, m.format)}
      </div>

      {/* Comparativo período anterior */}
      {variation && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ color: variationColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}>
            {variation.direction === 'up' ? '▲' : variation.direction === 'down' ? '▼' : '–'} {Math.abs(variation.pct).toFixed(1)}%
          </span>
          <span style={{ color: '#9CA3AF', fontSize: 11 }}>vs {cmpLabel || 'anterior'}</span>
        </div>
      )}

      {/* Split por plataforma (só pra métricas que têm Google equivalente E ambos > 0) */}
      {m.hasGoogleEquivalent && (m.metaValue > 0 || m.googleValue > 0) && (
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#6E6E73', marginTop: 4, paddingTop: 8, borderTop: '1px dashed #F2F2F7' }}>
          {m.metaValue > 0 && (
            <span><span style={{ color: '#1877F2', fontWeight: 700 }}>Meta</span> {formatMetricValue(m.metaValue, m.format)}</span>
          )}
          {m.googleValue > 0 && (
            <span><span style={{ color: '#FBBC05', fontWeight: 700 }}>Google</span> {formatMetricValue(m.googleValue, m.format)}</span>
          )}
        </div>
      )}
    </div>
  )
}
