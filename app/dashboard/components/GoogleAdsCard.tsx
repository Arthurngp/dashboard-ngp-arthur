'use client'

import { useEffect } from 'react'
import { useGoogleAds } from '../hooks/useGoogleAds'
import type { GoogleAdsCampaign } from '@/lib/google-ads-metrics'
import type { DateParam } from '@/types'
import { fmt } from '@/lib/utils'
import styles from '../dashboard.module.css'

interface GoogleAdsCardProps {
  customerId?: string | null
  /** Período do dashboard (suporta preset OU time_range com since/until). */
  period: DateParam | string
  customerName?: string
}

function fmtI(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function fmtN(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value))
}

export default function GoogleAdsCard({ customerId, period, customerName }: GoogleAdsCardProps) {
  const fullData = useGoogleAds({ customerId })
  const { campaigns, summary, loading, error, load } = fullData

  // Recarrega quando muda customer ou QUALQUER parte do período (preset ou time_range)
  const periodKey = typeof period === 'string'
    ? period
    : `${period?.date_preset || ''}|${period?.time_range || ''}`

  useEffect(() => {
    void load(period)
  }, [customerId, periodKey, load, period])

  if (!customerId) {
    return (
      <div className={styles.sectionCard}>
        <div className={styles.platHead}>
          <span className={styles.platTitle}>Google Ads</span>
          <span className={styles.platId} style={{ background: '#fef3c7', color: '#92400e' }}>Não vinculado</span>
        </div>
        <div style={{ padding: '20px 0', color: '#6E6E73', fontSize: 13 }}>
          Este cliente ainda não tem Customer ID Google Ads cadastrado.
          {customerName && <> Vincule em <strong>Admin → Clientes → {customerName}</strong>.</>}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.sectionCard}>
      <div className={styles.platHead}>
        <span className={styles.platTitle}>Google Ads</span>
        <span className={styles.platId}>{formatCustomerId(customerId)}</span>
      </div>

      {loading && (
        <div style={{ padding: '12px 0', fontSize: 13, color: '#6E6E73' }}>Carregando Google Ads...</div>
      )}
      {error && !loading && (
        <div style={{ padding: '12px', background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {summary && !loading && !error && (
        <>
          <div className={styles.kpiRow}>
            {[
              { label: 'Investido', value: `R$ ${fmt(summary.spend)}` },
              { label: 'Imp', value: fmtI(summary.impressions) },
              { label: 'Cliques', value: fmtN(summary.clicks) },
              { label: 'CTR', value: `${(summary.ctr * 100).toFixed(2)}%` },
              { label: 'Conversões', value: fmtN(summary.conversions) },
              { label: 'CPA', value: `R$ ${fmt(summary.cpa)}` },
            ].map(k => (
              <div key={k.label} className={styles.kpiMini}>
                <div className={styles.kpiMiniLabel}>{k.label}</div>
                <div className={styles.kpiMiniValue}>{k.value}</div>
              </div>
            ))}
          </div>

          {campaigns.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6E6E73', marginBottom: 8 }}>
                Campanhas ({campaigns.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {campaigns.slice(0, 5).map(c => (
                  <CampaignRow key={c.id} c={c} />
                ))}
                {campaigns.length > 5 && (
                  <div style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', padding: '4px 0' }}>
                    +{campaigns.length - 5} campanhas
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CampaignRow({ c }: { c: GoogleAdsCampaign }) {
  const statusColor =
    c.status === 'ENABLED' ? '#10b981' :
    c.status === 'PAUSED' ? '#f59e0b' :
    '#9ca3af'

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{c.name || `#${c.id}`}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#6E6E73', flexShrink: 0 }}>
        <span>R$ {fmt(c.spend)}</span>
        <span>{fmtN(c.conversions)} conv</span>
      </div>
    </div>
  )
}

function formatCustomerId(id: string): string {
  const clean = String(id).replace(/-/g, '')
  if (clean.length !== 10) return id
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`
}
