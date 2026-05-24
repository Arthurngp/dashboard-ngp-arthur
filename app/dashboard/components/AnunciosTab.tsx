'use client'

import { useEffect, useMemo, useState } from 'react'
import { metaCall } from '@/lib/meta'
import { ACTION_KEYS, sumActions } from '@/lib/meta-metrics'
import { DateParam } from '@/types'

// Primitives locais (iguais aos do PresentMode; triviais).
function Card({ title, children, style, headerRight }: { title: string; children: React.ReactNode; style?: React.CSSProperties; headerRight?: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 'clamp(10px, 1vw, 16px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'clamp(6px, .7vw, 10px)' }}>
        <div style={{ fontSize: 'clamp(9px, .75vw, 13px)', fontWeight: 700, color: '#fff', letterSpacing: '.06em', textTransform: 'uppercase', flex: 1 }}>{title}</div>
        {headerRight}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}
function Loading() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11, padding: 24 }}>Carregando…</div>
}
function Empty({ msg }: { msg: string }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 11, textAlign: 'center', padding: 14 }}>{msg}</div>
}

interface Props {
  metaAccount: string
  period: DateParam
  filteringParam?: string
  insightsDefaults: Record<string, string>
  tipo: string
  resultLabel: string
  cprLabel: string
}

interface AdRow {
  id: string
  name: string
  spend: number
  ctr: number
  results: number
  cpa: number
  roas: number
  impressions: number
  frequency: number
  cpm: number
  reach: number
  linkClicks: number
  cpc: number
  video3s: number
  videoThruplay: number
}

const MIN_SPEND = 1
const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtN = (n: number) => n.toLocaleString('pt-BR')
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

type SortKey = 'spend' | 'ctr' | 'cpc' | 'cpa' | 'roas' | 'results' | 'frequency'

export default function AnunciosTab({ metaAccount, period, filteringParam, insightsDefaults, tipo, resultLabel, cprLabel }: Props) {
  const [ads, setAds] = useState<AdRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<string[]>([]) // ids p/ comparação (máx 3)
  const hasRevenue = useMemo(() => !!ads?.some(a => a.roas > 0), [ads])

  useEffect(() => {
    let cancelled = false
    const keys = ACTION_KEYS[tipo] || ACTION_KEYS.LEADS
    const load = async () => {
      setLoading(true); setError('')
      try {
        const params: Record<string, string> = {
          ...insightsDefaults, level: 'ad', limit: '200',
          fields: 'ad_id,ad_name,spend,ctr,actions,impressions,frequency,cpm,reach,inline_link_clicks,video_play_actions,video_thruplay_watched_actions,purchase_roas',
          ...(period as Record<string, string>),
          ...(filteringParam ? { filtering: filteringParam } : {}),
        }
        const r = await metaCall('insights', params, metaAccount)
        if (cancelled) return
        const rows = Array.isArray(r?.data) ? r.data : []
        const mapped: AdRow[] = rows.map((ad: any): AdRow => {
          const spend = +ad.spend || 0
          const results = sumActions(ad.actions, keys)
          const linkClicks = +ad.inline_link_clicks || 0
          const video3s = +(ad.video_play_actions?.[0]?.value || 0)
          const videoThruplay = +(ad.video_thruplay_watched_actions?.[0]?.value || 0)
          const roas = +(ad.purchase_roas?.find((x: any) => x.action_type === 'omni_purchase')?.value || ad.purchase_roas?.[0]?.value || 0)
          return {
            id: ad.ad_id || '', name: ad.ad_name || '—', spend,
            ctr: +ad.ctr || 0, results, cpa: results > 0 ? spend / results : 0, roas,
            impressions: +ad.impressions || 0, frequency: +ad.frequency || 0, cpm: +ad.cpm || 0, reach: +ad.reach || 0,
            linkClicks, cpc: linkClicks > 0 ? spend / linkClicks : 0, video3s, videoThruplay,
          }
        }).filter((a: AdRow) => a.spend > 0 || a.results > 0)
        setAds(mapped)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar anúncios.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [metaAccount, period, filteringParam, insightsDefaults, tipo])

  const sorted = useMemo(() => {
    if (!ads) return []
    const arr = [...ads].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      return sortDir === 'desc' ? vb - va : va - vb
    })
    return arr
  }, [ads, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }
  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 3 ? prev : [...prev, id])
  }

  if (loading && !ads) return <div style={{ flex: 1, display: 'flex' }}><Loading /></div>
  if (error) return <div style={{ flex: 1, display: 'flex' }}><Empty msg={error} /></div>
  if (!ads || ads.length === 0) return <div style={{ flex: 1, display: 'flex' }}><Empty msg="Sem anúncios com dados no período" /></div>

  const selectedAds = sorted.filter(a => selected.includes(a.id))
  const videoAds = sorted.filter(a => a.video3s > 0)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.2vw, 18px)', minHeight: 0, overflow: 'auto' }}>
      {/* Comparação lado a lado (só quando há seleção) */}
      {selectedAds.length > 0 && (
        <Card title={`Comparação (${selectedAds.length}/3)`} headerRight={<button onClick={() => setSelected([])} style={btnGhost}>Limpar</button>}>
          <CompareGrid ads={selectedAds} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} />
        </Card>
      )}

      {/* Ranking multi-métrica */}
      <Card title={`Ranking de anúncios — ${ads.length} no período`}>
        <Ranking
          rows={sorted} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
          selected={selected} onSelect={toggleSelect}
          resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue}
        />
      </Card>

      {/* Métricas de vídeo */}
      {videoAds.length > 0 && (
        <Card title="Métricas de vídeo — retenção">
          <VideoTable ads={videoAds} />
        </Card>
      )}
    </div>
  )
}

const btnGhost: React.CSSProperties = { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#cbd5e1', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }

const th: React.CSSProperties = { color: '#94a3b8', fontSize: 10, fontWeight: 700, padding: '5px 6px', textTransform: 'uppercase', letterSpacing: '.03em', textAlign: 'right', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const td: React.CSSProperties = { fontSize: 12, padding: '5px 6px', textAlign: 'right', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }

function Ranking({ rows, sortKey, sortDir, onSort, selected, onSelect, resultLabel, cprLabel, hasRevenue }: {
  rows: AdRow[]; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void
  selected: string[]; onSelect: (id: string) => void; resultLabel: string; cprLabel: string; hasRevenue: boolean
}) {
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''
  const cols: { k: SortKey; label: string; show: boolean }[] = [
    { k: 'spend', label: 'Gasto', show: true },
    { k: 'results', label: resultLabel, show: true },
    { k: 'cpa', label: cprLabel, show: true },
    { k: 'roas', label: 'ROAS', show: hasRevenue },
    { k: 'ctr', label: 'CTR', show: true },
    { k: 'cpc', label: 'CPC', show: true },
    { k: 'frequency', label: 'Freq.', show: true },
  ]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <th style={{ ...th, cursor: 'default', textAlign: 'center', width: 32 }}>✓</th>
            <th style={{ ...th, cursor: 'default', textAlign: 'left' }}>Anúncio</th>
            {cols.filter(c => c.show).map(c => (
              <th key={c.k} style={th} onClick={() => onSort(c.k)}>{c.label}{arrow(c.k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(a => {
            const on = selected.includes(a.id)
            return (
              <tr key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,.05)', background: on ? 'rgba(125,211,252,.08)' : 'transparent' }}>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input type="checkbox" checked={on} onChange={() => onSelect(a.id)} style={{ cursor: 'pointer' }} />
                </td>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</td>
                <td style={td}>{fmtBrl(a.spend)}</td>
                <td style={td}>{a.results > 0 ? fmtN(a.results) : '—'}</td>
                <td style={td}>{a.cpa > 0 ? fmtBrl(a.cpa) : '—'}</td>
                {hasRevenue && <td style={{ ...td, fontWeight: 700 }}>{a.roas > 0 ? `${a.roas.toFixed(2)}x` : '—'}</td>}
                <td style={td}>{pct(a.ctr / 100)}</td>
                <td style={td}>{a.cpc > 0 ? fmtBrl(a.cpc) : '—'}</td>
                <td style={{ ...td, color: a.frequency > 3 ? '#f87171' : '#e2e8f0' }}>{a.frequency.toFixed(1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Clique no cabeçalho pra ordenar. Marque até 3 anúncios pra comparar.</div>
    </div>
  )
}

function CompareGrid({ ads, resultLabel, cprLabel, hasRevenue }: { ads: AdRow[]; resultLabel: string; cprLabel: string; hasRevenue: boolean }) {
  // métricas em linhas, anúncios em colunas. Destaca melhor por linha.
  const metrics: { label: string; get: (a: AdRow) => number; fmt: (n: number) => string; better: 'high' | 'low'; show: boolean }[] = [
    { label: 'Gasto', get: a => a.spend, fmt: fmtBrl, better: 'low', show: true },
    { label: resultLabel, get: a => a.results, fmt: fmtN, better: 'high', show: true },
    { label: cprLabel, get: a => a.cpa, fmt: (n) => n > 0 ? fmtBrl(n) : '—', better: 'low', show: true },
    { label: 'ROAS', get: a => a.roas, fmt: (n) => n > 0 ? `${n.toFixed(2)}x` : '—', better: 'high', show: hasRevenue },
    { label: 'CTR', get: a => a.ctr, fmt: (n) => pct(n / 100), better: 'high', show: true },
    { label: 'CPC', get: a => a.cpc, fmt: (n) => n > 0 ? fmtBrl(n) : '—', better: 'low', show: true },
    { label: 'Frequência', get: a => a.frequency, fmt: (n) => n.toFixed(1), better: 'low', show: true },
  ]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <th style={{ ...th, cursor: 'default', textAlign: 'left' }}>Métrica</th>
            {ads.map(a => <th key={a.id} style={{ ...th, cursor: 'default', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {metrics.filter(m => m.show).map(m => {
            const vals = ads.map(m.get).filter(v => v > 0)
            const best = vals.length ? (m.better === 'high' ? Math.max(...vals) : Math.min(...vals)) : null
            return (
              <tr key={m.label} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <td style={{ ...td, textAlign: 'left', color: '#94a3b8', fontWeight: 600 }}>{m.label}</td>
                {ads.map(a => {
                  const v = m.get(a)
                  const isBest = best !== null && v === best && v > 0 && ads.length > 1
                  return <td key={a.id} style={{ ...td, color: isBest ? '#34d399' : '#e2e8f0', fontWeight: isBest ? 800 : 500 }}>{m.fmt(v)}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function VideoTable({ ads }: { ads: AdRow[] }) {
  // hook rate = video3s / impressions; thruplay rate = thruplay / video3s
  const rows = ads.map(a => ({
    name: a.name,
    hook: a.impressions > 0 ? a.video3s / a.impressions : 0,
    thru: a.video3s > 0 ? a.videoThruplay / a.video3s : 0,
    video3s: a.video3s,
  })).sort((x, y) => y.hook - x.hook)
  const maxHook = Math.max(...rows.map(r => r.hook), 0) || 1
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <th style={{ ...th, cursor: 'default', textAlign: 'left' }}>Anúncio</th>
            <th style={{ ...th, cursor: 'default', textAlign: 'left', width: '34%' }}>Hook rate (3s/impr.)</th>
            <th style={{ ...th, cursor: 'default' }}>Thruplay/3s</th>
            <th style={{ ...th, cursor: 'default' }}>Views 3s</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
              <td style={{ ...td, textAlign: 'left' }}>
                <div style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(r.hook / maxHook) * 100}%`, background: 'rgba(125,211,252,.2)', borderRadius: 4 }} />
                  <span style={{ position: 'relative', zIndex: 1, paddingLeft: 4, fontWeight: 600 }}>{pct(r.hook)}</span>
                </div>
              </td>
              <td style={td}>{pct(r.thru)}</td>
              <td style={td}>{fmtN(r.video3s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Hook rate alto = prende nos 3s. Thruplay/3s alto = retém até o fim.</div>
    </div>
  )
}
