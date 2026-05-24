'use client'

// Modo apresentação para Google Ads — Layout Meta-like com painéis completos.
// Tem toggle Meta/Google no header, KPIs, top criativos, demografia, dispositivo,
// termos buscados, palavras-chave, top campanhas, série temporal.

import { useEffect, useMemo, useState } from 'react'
import { useGoogleAds } from '../hooks/useGoogleAds'
import { fmt } from '@/lib/utils'
import type { DateParam } from '@/types'
import PeriodFilter from '@/components/PeriodFilter'
import {
  DEVICE_LABELS, AGE_LABELS, GENDER_LABELS, MATCH_TYPE_LABELS, CHANNEL_TYPE_LABELS,
  type SearchTermRow, type KeywordRow, type DeviceRow, type DemoRow, type AdRow,
  type GoogleAdsCampaign,
} from '@/lib/google-ads-metrics'

interface Props {
  clienteName: string
  googleAdsCustomerId: string
  periodLabel: string
  /** Período do dashboard (preset OU time_range com since/until). */
  period: DateParam | string
  onApplyPeriod: (dp: DateParam, label: string, cmpDp?: DateParam, cmpLabel?: string) => void
  onSwitchToMeta: () => void
  onClose: () => void
}

function fmtI(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function fmtN(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value))
}

function formatCustomerId(id: string): string {
  const clean = String(id).replace(/-/g, '')
  if (clean.length !== 10) return id
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`
}

export default function PresentModeGoogle(p: Props) {
  const data = useGoogleAds({ customerId: p.googleAdsCustomerId })
  const { summary, campaigns, searchTerms, keywords, devices, ageGroups, genders, ads, loading, error, load, hasPmax, hasSearch, hasDisplay, channelTypes } = data

  const periodKey = typeof p.period === 'string'
    ? p.period
    : `${p.period?.date_preset || ''}|${p.period?.time_range || ''}`

  useEffect(() => {
    void load(p.period)
  }, [periodKey, load, p.period])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const activeCampaigns = useMemo(() => campaigns.filter(c => c.spend > 0 || c.impressions > 0), [campaigns])
  const topCampaigns = activeCampaigns.slice(0, 5)

  // Insights de termos buscados: termos com gasto > 0 mas conversão = 0 (otimização)
  const wasteTerms = useMemo(() => {
    return searchTerms
      .filter(t => t.spend > 5 && t.conversions === 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5)
  }, [searchTerms])

  const showSearchPanels = hasSearch || hasDisplay
  const hasAnyData = (summary?.impressions || 0) > 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a2540', zIndex: 1000, padding: 'clamp(10px, 1.5vw, 24px) clamp(14px, 2vw, 32px)', fontFamily: 'Sora,sans-serif', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.2vw, 18px)', overflow: 'hidden', boxSizing: 'border-box', isolation: 'isolate' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.2vw, 20px)', flexShrink: 0 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 'clamp(16px, 1.6vw, 28px)', fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1 }}>DADOS DE CAMPANHAS</div>
          <div style={{ fontSize: 'clamp(9px, .8vw, 14px)', fontWeight: 700, color: '#fbbf24', letterSpacing: '.08em', marginTop: 4 }}>
            {(p.clienteName || 'CLIENTE').toUpperCase()} — GOOGLE ADS — {formatCustomerId(p.googleAdsCustomerId)}
            {channelTypes.length > 0 && (
              <span style={{ marginLeft: 8, color: '#94a3b8' }}>· {channelTypes.map(t => CHANNEL_TYPE_LABELS[t] || t).join(' · ')}</span>
            )}
          </div>
        </div>

        {/* Toggle Meta/Google */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 10, overflow: 'hidden' }}>
          <button onClick={p.onSwitchToMeta} style={{ padding: 'clamp(7px, .7vw, 12px) clamp(10px, 1vw, 18px)', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 'clamp(10px, .8vw, 14px)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Meta Ads</button>
          <button style={{ padding: 'clamp(7px, .7vw, 12px) clamp(10px, 1vw, 18px)', background: '#fbbf24', border: 'none', color: '#0a2540', fontSize: 'clamp(10px, .8vw, 14px)', fontWeight: 700, cursor: 'default', fontFamily: 'inherit' }}>Google Ads</button>
        </div>

        <div>
          <PeriodFilter onApply={p.onApplyPeriod} />
        </div>
        <button onClick={p.onClose} style={{ padding: 'clamp(7px, .7vw, 12px) clamp(10px, 1vw, 18px)', background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 10, color: '#fff', fontSize: 'clamp(10px, .8vw, 14px)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Voltar</button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, .2)', border: '1.5px solid #ef4444', borderRadius: 10, color: '#fecaca', fontSize: 14 }}>
          ⚠️ Erro: {error}
        </div>
      )}

      {loading && !summary && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
          Carregando Google Ads...
        </div>
      )}

      {summary && !hasAnyData && !loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: 24 }}>
          Sem atividade no período selecionado.<br/>Conta {formatCustomerId(p.googleAdsCustomerId)} sem impressões.
        </div>
      )}

      {summary && hasAnyData && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.2vw, 18px)', minHeight: 0, overflow: 'hidden' }}>
          {/* KPIs no topo (8 cards horizontais). ROAS e Valor em Vendas mostram '—'
              quando a conta não rastreia valor de conversão (varia por cliente). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 'clamp(6px, .8vw, 12px)', flexShrink: 0 }}>
            <Kpi label="Valor Investido" value={`R$ ${fmt(summary.spend)}`} accent="#fbbf24" />
            <Kpi label="Valor em Vendas" value={(summary.conversion_value ?? 0) > 0 ? `R$ ${fmt(summary.conversion_value ?? 0)}` : '—'} accent="#34d399" />
            <Kpi label="Conversões" value={fmtN(summary.conversions)} accent="#fbbf24" />
            <Kpi label="CPA" value={summary.cpa > 0 ? `R$ ${fmt(summary.cpa)}` : '—'} accent="#fbbf24" />
            <Kpi label="ROAS" value={(summary.roas ?? 0) > 0 ? `${(summary.roas ?? 0).toFixed(2)}x` : '—'} accent="#34d399" />
            <Kpi label="Impressões" value={fmtI(summary.impressions)} />
            <Kpi label="Cliques" value={fmtN(summary.clicks)} />
            <Kpi label="CTR" value={`${(summary.ctr * 100).toFixed(2)}%`} />
          </div>

          {/* Grid principal: 2 colunas, cards lado a lado com scroll interno */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'clamp(8px, 1.2vw, 18px)', minHeight: 0 }}>
            {/* COLUNA ESQUERDA — 3 cards empilhados */}
            <div style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 'clamp(8px, 1vw, 14px)', minHeight: 0 }}>
              <Card title={`🏆 Top campanhas — ${topCampaigns.length} ativas`}>
                <ScrollArea>
                  {topCampaigns.length === 0
                    ? <Empty msg="Sem campanhas ativas" />
                    : <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {topCampaigns.map(c => <CampaignBar key={c.id} c={c} totalSpend={summary.spend} />)}
                      </div>
                  }
                </ScrollArea>
              </Card>

              <Card title="📱 Dispositivos">
                <ScrollArea>
                  <DevicesChart devices={devices} />
                </ScrollArea>
              </Card>

              <Card title="👥 Idade × Investimento">
                <ScrollArea>
                  <DemoBars rows={ageGroups} labelKey="age_range" labels={AGE_LABELS} />
                </ScrollArea>
              </Card>
            </div>

            {/* COLUNA DIREITA — cards dinâmicos baseados em tipo de campanha */}
            <div style={{ display: 'grid', gridTemplateRows: showSearchPanels ? 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr)' : 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 'clamp(8px, 1vw, 14px)', minHeight: 0 }}>
              {/* Termos buscados (Search/Display) */}
              {showSearchPanels && searchTerms.length > 0 && (
                <Card title="🔍 Top termos buscados">
                  <ScrollArea>
                    <SearchTermsList rows={searchTerms} />
                  </ScrollArea>
                </Card>
              )}

              {/* Pmax: top criativos no lugar de termos */}
              {!showSearchPanels && hasPmax && ads.length > 0 && (
                <Card title="🎨 Top criativos (Pmax)">
                  <ScrollArea>
                    <AdsList rows={ads} />
                  </ScrollArea>
                </Card>
              )}

              {/* Termos pra otimizar */}
              {showSearchPanels && wasteTerms.length > 0 && (
                <Card title="💡 Termos pra otimizar (gasto sem conversão)">
                  <ScrollArea>
                    <WasteTermsList rows={wasteTerms} />
                  </ScrollArea>
                </Card>
              )}

              {/* Pmax: gênero no lugar de waste */}
              {!showSearchPanels && hasPmax && genders.length > 0 && (
                <Card title="⚧ Gênero × Investimento">
                  <ScrollArea>
                    <DemoBars rows={genders} labelKey="gender" labels={GENDER_LABELS} />
                  </ScrollArea>
                </Card>
              )}

              {/* Keywords + QS (quando Search) */}
              {showSearchPanels && keywords.length > 0 && (
                <Card title="🔑 Palavras-chave + Quality Score">
                  <ScrollArea>
                    <KeywordsList rows={keywords} />
                  </ScrollArea>
                </Card>
              )}

              {/* Pmax sem search nem ads: mostra todas as campanhas */}
              {!showSearchPanels && !hasPmax && (
                <Card title="📊 Sem dados de termos">
                  <Empty msg="Tipos de campanha ativos não expõem termos buscados" />
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES
// ═════════════════════════════════════════════════════════════════

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', border: `1.5px solid ${accent ? accent + '40' : 'rgba(255,255,255,.12)'}`, borderRadius: 12, padding: 'clamp(10px, 1.2vw, 18px)', minWidth: 0 }}>
      <div style={{ fontSize: 'clamp(9px, .75vw, 12px)', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 'clamp(18px, 1.8vw, 30px)', fontWeight: 800, color: accent || '#fff', marginTop: 4, lineHeight: 1.1 }}>{value}</div>
    </div>
  )
}

function Card({ title, style, children }: { title: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1.5px solid rgba(255,255,255,.1)', borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.08)', fontSize: 12, fontWeight: 700, color: '#cbd5e1', flexShrink: 0, letterSpacing: '.02em' }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

// Scroll vertical com estilização sutil — preenche todo o espaço do Card pai.
function ScrollArea({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      // Estilização do scrollbar (Webkit + Firefox)
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(251, 191, 36, .3) transparent',
    }}>
      {children}
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12, padding: 16, textAlign: 'center' }}>{msg}</div>
}

function CampaignBar({ c, totalSpend }: { c: GoogleAdsCampaign; totalSpend: number }) {
  const share = totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0
  const statusColor = c.status === 'ENABLED' ? '#10b981' : c.status === 'PAUSED' ? '#f59e0b' : '#9ca3af'
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          <strong style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || `#${c.id}`}</strong>
          {c.channel_type && <span style={{ fontSize: 9, padding: '2px 5px', background: 'rgba(251, 191, 36, .15)', color: '#fbbf24', borderRadius: 4, flexShrink: 0 }}>{CHANNEL_TYPE_LABELS[c.channel_type] || c.channel_type}</span>}
        </div>
        <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{share.toFixed(1)}%</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(share, 100)}%`, height: '100%', background: '#fbbf24' }} />
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 10, color: '#94a3b8' }}>
        <span>R$ {fmt(c.spend)}</span>
        <span>{fmtN(c.conversions)} conv</span>
        <span>{fmtN(c.clicks)} cliques</span>
        {c.cpa > 0 && <span>CPA R$ {fmt(c.cpa)}</span>}
      </div>
    </div>
  )
}

function DevicesChart({ devices }: { devices: DeviceRow[] }) {
  const totalSpend = devices.reduce((s, d) => s + d.spend, 0)
  const sorted = [...devices].filter(d => d.spend > 0).sort((a, b) => b.spend - a.spend)
  if (sorted.length === 0) return <Empty msg="Sem dados de dispositivo" />
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map(d => {
        const pct = totalSpend > 0 ? (d.spend / totalSpend) * 100 : 0
        return (
          <div key={d.device} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <strong style={{ color: '#fff' }}>{DEVICE_LABELS[d.device] || d.device}</strong>
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>{pct.toFixed(1)}%</span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#fbbf24' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#94a3b8' }}>
              <span>R$ {fmt(d.spend)}</span>
              <span>{fmtN(d.clicks)} cliques</span>
              <span>{fmtN(d.conversions)} conv</span>
              {d.cpa > 0 && <span>CPA R$ {fmt(d.cpa)}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DemoBars({ rows, labelKey, labels }: { rows: DemoRow[]; labelKey: 'age_range' | 'gender'; labels: Record<string, string> }) {
  const filtered = rows.filter(r => (r.impressions || 0) > 0 || (r.spend || 0) > 0)
  // Agrupa pelo label (várias rows mesma faixa em ad groups diferentes — somar)
  const grouped: Record<string, DemoRow> = {}
  for (const r of filtered) {
    const key = String((r as any)[labelKey] || 'UNDETERMINED')
    if (!grouped[key]) grouped[key] = { ...r, [labelKey]: key } as any
    else {
      grouped[key].impressions += r.impressions || 0
      grouped[key].clicks += r.clicks || 0
      grouped[key].spend += r.spend || 0
      grouped[key].conversions += r.conversions || 0
    }
  }
  const sorted = Object.values(grouped).sort((a, b) => b.spend - a.spend)
  if (sorted.length === 0) return <Empty msg="Sem dados demográficos (Pmax não popula)" />
  const max = Math.max(...sorted.map(r => r.spend))
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map(r => {
        const key = String((r as any)[labelKey] || '')
        const pct = max > 0 ? (r.spend / max) * 100 : 0
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1' }}>
              <strong>{labels[key] || key}</strong>
              <span>R$ {fmt(r.spend)}</span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#22d3ee' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SearchTermsList({ rows }: { rows: SearchTermRow[] }) {
  return (
    <div style={{ padding: 8 }}>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#64748b', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <th style={{ padding: '6px 4px', fontWeight: 600 }}>Termo</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Cliques</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Conv</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Gasto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '6px 4px', color: '#fff', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{t.term}</strong>
                {t.match_type && <span style={{ marginLeft: 6, fontSize: 9, color: '#fbbf24' }}>{MATCH_TYPE_LABELS[t.match_type] || t.match_type}</span>}
              </td>
              <td style={{ padding: '6px 4px', textAlign: 'right', color: '#cbd5e1' }}>{fmtN(t.clicks)}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right', color: t.conversions > 0 ? '#10b981' : '#64748b' }}>{fmtN(t.conversions)}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right', color: '#fbbf24', fontWeight: 600 }}>R$ {fmt(t.spend)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WasteTermsList({ rows }: { rows: SearchTermRow[] }) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(239, 68, 68, .08)', border: '1px solid rgba(239, 68, 68, .2)', borderRadius: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.term}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{fmtN(t.clicks)} cliques · 0 conversões</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f87171', flexShrink: 0 }}>R$ {fmt(t.spend)}</div>
        </div>
      ))}
    </div>
  )
}

function KeywordsList({ rows }: { rows: KeywordRow[] }) {
  return (
    <div style={{ padding: 8 }}>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#64748b', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <th style={{ padding: '6px 4px', fontWeight: 600 }}>Palavra-chave</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'center' }}>QS</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Cliques</th>
            <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Gasto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '6px 4px', color: '#fff', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{k.text}</strong>
                {k.match_type && <span style={{ marginLeft: 6, fontSize: 9, color: '#fbbf24' }}>{MATCH_TYPE_LABELS[k.match_type] || k.match_type}</span>}
              </td>
              <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                <QualityScore score={k.quality_score} />
              </td>
              <td style={{ padding: '6px 4px', textAlign: 'right', color: '#cbd5e1' }}>{fmtN(k.clicks)}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right', color: '#fbbf24', fontWeight: 600 }}>R$ {fmt(k.spend)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QualityScore({ score }: { score: number }) {
  if (!score || score === 0) return <span style={{ fontSize: 9, color: '#64748b' }}>—</span>
  const color = score >= 7 ? '#10b981' : score >= 4 ? '#f59e0b' : '#ef4444'
  return (
    <span style={{ display: 'inline-block', minWidth: 22, padding: '2px 6px', background: color + '20', color, borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
      {score}/10
    </span>
  )
}

function AdsList({ rows }: { rows: AdRow[] }) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(a => (
        <div key={a.id} style={{ padding: 10, background: 'rgba(255,255,255,.04)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{a.campaign} · {a.type}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>R$ {fmt(a.spend)}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{fmtN(a.conversions)} conv</div>
          </div>
        </div>
      ))}
    </div>
  )
}
