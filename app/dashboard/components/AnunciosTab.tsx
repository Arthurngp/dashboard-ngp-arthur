'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { metaCall } from '@/lib/meta'
import { ACTION_KEYS, sumActions } from '@/lib/meta-metrics'
import { DateParam } from '@/types'

// Primitives locais (iguais aos do PresentMode; triviais).
function Card({ title, children, style, headerRight }: { title: string; children: React.ReactNode; style?: React.CSSProperties; headerRight?: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 'clamp(10px, 1vw, 16px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'clamp(6px, .7vw, 10px)', flexWrap: 'wrap' }}>
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
  thumb: string
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

const MAX_CARDS = 20 // top N por gasto que recebem thumbnail e viram cards
const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtN = (n: number) => n.toLocaleString('pt-BR')
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

// Critérios de ordenação do carrossel. `lower` = menor é melhor.
type SortKey = 'results' | 'cpa' | 'cpm' | 'ctr' | 'spend' | 'roas'
const SORTS: { k: SortKey; label: string; lower?: boolean; needsRevenue?: boolean }[] = [
  { k: 'results', label: 'Mais resultados' },
  { k: 'cpa', label: 'Menor custo', lower: true },
  { k: 'cpm', label: 'Menor CPM', lower: true },
  { k: 'ctr', label: 'Maior CTR' },
  { k: 'spend', label: 'Maior investimento' },
  { k: 'roas', label: 'Melhor ROAS', needsRevenue: true },
]

export default function AnunciosTab({ metaAccount, period, filteringParam, insightsDefaults, tipo, resultLabel, cprLabel }: Props) {
  const [ads, setAds] = useState<AdRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('results')
  const [selected, setSelected] = useState<string[]>([])
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
        const rows: any[] = Array.isArray(r?.data) ? r.data : []
        const all: AdRow[] = rows.map((ad: any): AdRow => {
          const spend = +ad.spend || 0
          const results = sumActions(ad.actions, keys)
          const linkClicks = +ad.inline_link_clicks || 0
          const video3s = +(ad.video_play_actions?.[0]?.value || 0)
          const videoThruplay = +(ad.video_thruplay_watched_actions?.[0]?.value || 0)
          const roas = +(ad.purchase_roas?.find((x: any) => x.action_type === 'omni_purchase')?.value || ad.purchase_roas?.[0]?.value || 0)
          return {
            id: ad.ad_id || '', name: ad.ad_name || '—', thumb: '', spend,
            ctr: +ad.ctr || 0, results, cpa: results > 0 ? spend / results : 0, roas,
            impressions: +ad.impressions || 0, frequency: +ad.frequency || 0, cpm: +ad.cpm || 0, reach: +ad.reach || 0,
            linkClicks, cpc: linkClicks > 0 ? spend / linkClicks : 0, video3s, videoThruplay,
          }
        })
        const mapped: AdRow[] = all
          .filter((a) => a.spend > 0 || a.results > 0)
          .sort((a, b) => b.spend - a.spend)
          .slice(0, MAX_CARDS)

        // Busca thumbnail só dos top N (1 chamada por anúncio).
        await Promise.all(mapped.map(async (ad) => {
          if (!ad.id) return
          try {
            const cr = await metaCall(`${ad.id}/`, { fields: 'creative{thumbnail_url.width(320).height(320),image_url}' }, metaAccount)
            ad.thumb = cr?.creative?.thumbnail_url || cr?.creative?.image_url || ''
          } catch {}
        }))
        if (cancelled) return
        setAds([...mapped])
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
    const cfg = SORTS.find(s => s.k === sortKey) || SORTS[0]
    return [...ads].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      // métricas "menor é melhor" (cpa/cpm) com valor 0 vão pro fim (0 = sem dado)
      if (cfg.lower) {
        if (va === 0) return 1
        if (vb === 0) return -1
        return va - vb
      }
      return vb - va
    })
  }, [ads, sortKey])

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 3 ? prev : [...prev, id])
  }

  if (loading && !ads) return <div style={{ flex: 1, display: 'flex' }}><Loading /></div>
  if (error) return <div style={{ flex: 1, display: 'flex' }}><Empty msg={error} /></div>
  if (!ads || ads.length === 0) return <div style={{ flex: 1, display: 'flex' }}><Empty msg="Sem anúncios com dados no período" /></div>

  const selectedAds = sorted.filter(a => selected.includes(a.id))
  const videoAds = sorted.filter(a => a.video3s > 0)

  const sortButtons = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {SORTS.filter(s => !s.needsRevenue || hasRevenue).map(s => {
        const on = sortKey === s.k
        return (
          <button key={s.k} onClick={() => setSortKey(s.k)}
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
              background: on ? '#7dd3fc' : 'rgba(255,255,255,.06)', border: `1px solid ${on ? '#7dd3fc' : 'rgba(255,255,255,.14)'}`,
              color: on ? '#0a2540' : '#cbd5e1' }}>
            {s.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.2vw, 18px)', minHeight: 0, overflow: 'auto' }}>
      {/* Comparação lado a lado (quando há seleção) */}
      {selectedAds.length > 0 && (
        <Card title={`Comparação (${selectedAds.length}/3)`} headerRight={<button onClick={() => setSelected([])} style={btnGhost}>Limpar</button>}>
          <CompareGrid ads={selectedAds} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} />
        </Card>
      )}

      {/* Carrossel de criativos campeões */}
      <Card title={`Criativos — top ${ads.length} por relevância`} headerRight={sortButtons}>
        <CreativeCarousel
          ads={sorted} sortKey={sortKey} selected={selected} onSelect={toggleSelect}
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

// Carrossel horizontal de cards de criativo (thumbnail + métricas).
function CreativeCarousel({ ads, sortKey, selected, onSelect, resultLabel, cprLabel, hasRevenue }: {
  ads: AdRow[]; sortKey: SortKey; selected: string[]; onSelect: (id: string) => void
  resultLabel: string; cprLabel: string; hasRevenue: boolean
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const scroll = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * 320, behavior: 'smooth' })

  // métrica em destaque conforme o critério ativo
  const highlight = (a: AdRow): { label: string; value: string } => {
    switch (sortKey) {
      case 'cpa': return { label: cprLabel, value: a.cpa > 0 ? fmtBrl(a.cpa) : '—' }
      case 'cpm': return { label: 'CPM', value: a.cpm > 0 ? fmtBrl(a.cpm) : '—' }
      case 'ctr': return { label: 'CTR', value: pct(a.ctr / 100) }
      case 'spend': return { label: 'Investido', value: fmtBrl(a.spend) }
      case 'roas': return { label: 'ROAS', value: a.roas > 0 ? `${a.roas.toFixed(2)}x` : '—' }
      default: return { label: resultLabel, value: a.results > 0 ? fmtN(a.results) : '—' }
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={scroller} style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }}>
        {ads.map((a, rank) => {
          const on = selected.includes(a.id)
          const h = highlight(a)
          return (
            <div key={a.id} style={{
              flex: '0 0 auto', width: 200, background: 'rgba(255,255,255,.03)', borderRadius: 12,
              border: `1.5px solid ${on ? '#7dd3fc' : 'rgba(255,255,255,.08)'}`, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
              {/* thumbnail */}
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1', background: '#0f2942' }}>
                {a.thumb
                  ? <img src={a.thumb} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 11 }}>sem prévia</div>}
                <div style={{ position: 'absolute', top: 6, left: 6, background: rank === 0 ? '#fbbf24' : 'rgba(10,37,64,.85)', color: rank === 0 ? '#0a2540' : '#cbd5e1', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99 }}>#{rank + 1}</div>
                <label style={{ position: 'absolute', top: 6, right: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => onSelect(a.id)} style={{ cursor: 'pointer' }} />
                </label>
              </div>
              {/* destaque do critério */}
              <div style={{ padding: '8px 10px 4px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{h.value}</div>
              </div>
              {/* nome + métricas secundárias */}
              <div style={{ padding: '6px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</div>
                <Mini label={resultLabel} value={a.results > 0 ? fmtN(a.results) : '—'} />
                <Mini label={cprLabel} value={a.cpa > 0 ? fmtBrl(a.cpa) : '—'} />
                {hasRevenue && <Mini label="ROAS" value={a.roas > 0 ? `${a.roas.toFixed(2)}x` : '—'} />}
                <Mini label="CTR" value={pct(a.ctr / 100)} />
                <Mini label="CPM" value={a.cpm > 0 ? fmtBrl(a.cpm) : '—'} />
                <Mini label="Freq." value={a.frequency.toFixed(1)} warn={a.frequency > 3} />
              </div>
            </div>
          )
        })}
      </div>
      {ads.length > 2 && (
        <>
          <button onClick={() => scroll(-1)} style={navBtn('left')} aria-label="Anterior">‹</button>
          <button onClick={() => scroll(1)} style={navBtn('right')} aria-label="Próximo">›</button>
        </>
      )}
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Marque até 3 (caixa no canto do card) pra comparar. Botões acima reordenam.</div>
    </div>
  )
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ color: warn ? '#f87171' : '#e2e8f0', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

const navBtn = (side: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute', top: '38%', [side]: -6, width: 30, height: 30, borderRadius: 99,
  background: 'rgba(10,37,64,.9)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 18, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
})

const th: React.CSSProperties = { color: '#94a3b8', fontSize: 10, fontWeight: 700, padding: '5px 6px', textTransform: 'uppercase', letterSpacing: '.03em', textAlign: 'right', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: 12, padding: '5px 6px', textAlign: 'right', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }

function CompareGrid({ ads, resultLabel, cprLabel, hasRevenue }: { ads: AdRow[]; resultLabel: string; cprLabel: string; hasRevenue: boolean }) {
  const metrics: { label: string; get: (a: AdRow) => number; fmt: (n: number) => string; better: 'high' | 'low'; show: boolean }[] = [
    { label: 'Gasto', get: a => a.spend, fmt: fmtBrl, better: 'low', show: true },
    { label: resultLabel, get: a => a.results, fmt: fmtN, better: 'high', show: true },
    { label: cprLabel, get: a => a.cpa, fmt: (n) => n > 0 ? fmtBrl(n) : '—', better: 'low', show: true },
    { label: 'ROAS', get: a => a.roas, fmt: (n) => n > 0 ? `${n.toFixed(2)}x` : '—', better: 'high', show: hasRevenue },
    { label: 'CTR', get: a => a.ctr, fmt: (n) => pct(n / 100), better: 'high', show: true },
    { label: 'CPC', get: a => a.cpc, fmt: (n) => n > 0 ? fmtBrl(n) : '—', better: 'low', show: true },
    { label: 'CPM', get: a => a.cpm, fmt: (n) => n > 0 ? fmtBrl(n) : '—', better: 'low', show: true },
    { label: 'Frequência', get: a => a.frequency, fmt: (n) => n.toFixed(1), better: 'low', show: true },
  ]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <th style={{ ...th, textAlign: 'left' }}>Métrica</th>
            {ads.map(a => <th key={a.id} style={{ ...th, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</th>)}
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
            <th style={{ ...th, textAlign: 'left' }}>Anúncio</th>
            <th style={{ ...th, textAlign: 'left', width: '34%' }}>Hook rate (3s/impr.)</th>
            <th style={th}>Thruplay/3s</th>
            <th style={th}>Views 3s</th>
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
