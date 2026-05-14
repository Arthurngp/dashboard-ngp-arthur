'use client'
import { useEffect, useMemo, useState } from 'react'
import { Campaign, DateParam } from '@/types'
import { metaCall } from '@/lib/meta'
import { fmt, fmtN, fmtI } from '@/lib/utils'
import PeriodFilter from '@/components/PeriodFilter'

interface Props {
  clienteName: string
  metaAccount: string
  periodLabel: string
  period: DateParam
  campaigns: Campaign[]
  timeSeriesData: Array<{ date: string; spend: number; impressions: number; clicks: number }>
  loadedAds?: Record<string, any[]>
  onApplyPeriod: (dp: DateParam, label: string, cmpDp?: DateParam | null, cmpLabel?: string | null) => void
  onClose: () => void
}

interface Bucket { label: string; value: number }

export default function PresentMode(p: Props) {
  const [age, setAge] = useState<Bucket[]>([])
  const [gender, setGender] = useState<Bucket[]>([])
  const [device, setDevice] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Tipo dominante (LEADS/VENDAS/MENSAGENS) baseado em campaign.objective
  const tipo = useMemo(() => {
    if (!p.campaigns.length) return 'CAMPANHAS'
    const counts: Record<string, number> = {}
    p.campaigns.forEach(c => { const o = (c.objective as string) || ''; counts[o] = (counts[o] || 0) + 1 })
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    if (top.includes('SALES') || top.includes('CONVERSIONS') || top.includes('PRODUCT')) return 'VENDAS'
    if (top.includes('LEADS') || top.includes('LEAD_GEN')) return 'LEADS'
    if (top.includes('MESSAG')) return 'MENSAGENS'
    if (top.includes('TRAFFIC') || top.includes('LINK_CLICK')) return 'TRÁFEGO'
    if (top.includes('ENGAGE') || top.includes('POST')) return 'ENGAJAMENTO'
    if (top.includes('AWARENESS') || top.includes('REACH') || top.includes('VIDEO')) return 'RECONHECIMENTO'
    return 'CAMPANHAS'
  }, [p.campaigns])

  // Totais
  const totals = useMemo(() => {
    const t = { spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0 }
    p.campaigns.forEach(c => {
      t.spend += +c.spend || 0
      t.impressions += +c.impressions || 0
      t.clicks += +c.clicks || 0
      t.reach += +c.reach || 0
    })
    // Resultados: tenta extrair "actions" - se cada campaign tem actions, soma o tipo principal
    const actionKey = tipo === 'VENDAS' ? 'purchase' : tipo === 'MENSAGENS' ? 'messaging_conversation_started_7d' : 'lead'
    p.campaigns.forEach(c => {
      const acts = ((c as any).actions || []) as Array<{ action_type: string; value: string }>
      acts.forEach(a => {
        if (a.action_type === actionKey || a.action_type.endsWith('.' + actionKey)) {
          t.results += +a.value || 0
        }
      })
    })
    const cpr = t.results > 0 ? t.spend / t.results : 0
    return { ...t, cpr }
  }, [p.campaigns, tipo])

  // Top 5 criativos campeões (extrai de loadedAds)
  const topCreatives = useMemo(() => {
    if (!p.loadedAds) return []
    const all: any[] = []
    Object.values(p.loadedAds).forEach(ads => {
      if (Array.isArray(ads)) all.push(...ads)
    })
    const actionKey = tipo === 'VENDAS' ? 'purchase' : tipo === 'MENSAGENS' ? 'messaging_conversation_started_7d' : 'lead'
    const getResults = (ad: any) => {
      const acts = (ad.actions || []) as Array<{ action_type: string; value: string }>
      let total = 0
      for (const a of acts) {
        if (a.action_type === actionKey || a.action_type.endsWith('.' + actionKey)) total += +a.value || 0
      }
      return total
    }
    return all
      .map(ad => ({
        id: ad.id || ad.ad_id,
        name: ad.name || ad.ad_name || '—',
        spend: +ad.spend || 0,
        ctr: +ad.ctr || 0,
        results: getResults(ad),
        cpl: getResults(ad) > 0 ? (+ad.spend || 0) / getResults(ad) : 0,
        thumb: ad.thumbnail_url || ad.creative?.thumbnail_url || '',
      }))
      .sort((a, b) => b.results - a.results || b.ctr - a.ctr)
      .slice(0, 5)
  }, [p.loadedAds, tipo])

  // Carrega breakdowns ao abrir / mudar período
  useEffect(() => {
    if (!p.metaAccount) return
    let cancelled = false
    setLoading(true)
    setError('')
    const dp = p.period
    const fetchBreakdown = async (breakdowns: string, valueKey: 'impressions' | 'actions') => {
      const params: Record<string, string> = {
        level: 'account',
        fields: valueKey === 'actions' ? 'actions' : 'impressions',
        limit: '50',
        breakdowns,
        ...dp,
      }
      const r = await metaCall('insights', params, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      const actionKey = tipo === 'VENDAS' ? 'purchase' : tipo === 'MENSAGENS' ? 'messaging_conversation_started_7d' : 'lead'
      return rows.map((row: any) => {
        let label = String(row[breakdowns] || '—')
        let value = 0
        if (valueKey === 'impressions') value = +row.impressions || 0
        else {
          const acts = row.actions || []
          for (const a of acts) {
            if (a.action_type === actionKey || a.action_type.endsWith('.' + actionKey)) value += +a.value || 0
          }
        }
        return { label, value }
      }).filter((b: Bucket) => b.value > 0)
    }
    Promise.all([
      fetchBreakdown('age', 'actions'),
      fetchBreakdown('gender', 'impressions'),
      fetchBreakdown('device_platform', 'impressions'),
    ]).then(([a, g, d]) => {
      if (cancelled) return
      setAge(a)
      setGender(g)
      setDevice(d)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Falha ao carregar breakdowns')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [p.metaAccount, p.period, tipo])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a2540', zIndex: 1000, padding: '18px 24px', fontFamily: 'Sora,sans-serif', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1 }}>DADOS DE CAMPANHAS</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc', letterSpacing: '.08em', marginTop: 4 }}>
            {(p.clienteName || 'CLIENTE').toUpperCase()} — {tipo} — META ADS
          </div>
        </div>
        <div style={{ filter: 'invert(1) hue-rotate(180deg)', borderRadius: 999, overflow: 'hidden' }}>
          <PeriodFilter onApply={p.onApplyPeriod} />
        </div>
        <button onClick={p.onClose} style={{ padding: '9px 14px', background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Voltar</button>
      </div>

      {/* Grid principal: 2 colunas */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 14, minHeight: 0 }}>
        {/* COLUNA ESQUERDA: KPIs + 2 charts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {/* 6 KPIs em 2x3 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Kpi label="Valor Investido" value={`R$ ${fmt(totals.spend)}`} />
            <Kpi label={tipo === 'VENDAS' ? 'Compras' : tipo === 'MENSAGENS' ? 'Mensagens' : 'Leads'} value={String(totals.results || '—')} />
            <Kpi label={tipo === 'VENDAS' ? 'CPA' : tipo === 'MENSAGENS' ? 'Custo/Msg' : 'Custo por Lead'} value={totals.cpr > 0 ? `R$ ${totals.cpr.toFixed(2)}` : '—'} />
            <Kpi label="Impressões" value={fmtI(totals.impressions)} />
            <Kpi label="Alcance" value={fmtI(totals.reach)} />
            <Kpi label="Cliques" value={fmtI(totals.clicks)} />
          </div>
          {/* Idade × Resultados */}
          <Card title={`Idade × ${tipo === 'VENDAS' ? 'Compras' : tipo === 'MENSAGENS' ? 'Mensagens' : 'Leads'}`} style={{ flex: 1 }}>
            {loading ? <Loading /> : age.length === 0 ? <Empty msg={error || 'Sem dados de idade'} /> : <BarChart data={age} color="#22d3ee" />}
          </Card>
          {/* Timeline Investimento × CPL/CTR */}
          <Card title="Investimento e Custo por Lead — por dia" style={{ flex: 1 }}>
            {p.timeSeriesData.length === 0 ? <Empty msg="Sem série temporal" /> : <TimelineChart data={p.timeSeriesData} totalResults={totals.results} />}
          </Card>
        </div>

        {/* COLUNA DIREITA: criativos + tabela + 2 donuts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <Card title="🏆 Criativos campeões" style={{ flexShrink: 0 }}>
            {topCreatives.length === 0
              ? <Empty msg="Sem criativos no período" />
              : <CreativesGrid creatives={topCreatives} tipo={tipo} />}
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1, minHeight: 0 }}>
            <Card title="Gênero × impressões">
              {loading ? <Loading /> : gender.length === 0 ? <Empty msg="Sem dados" /> : <DonutChart data={gender} />}
            </Card>
            <Card title="Dispositivos">
              {loading ? <Loading /> : device.length === 0 ? <Empty msg="Sem dados" /> : <DonutChart data={device} />}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, letterSpacing: '.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-.02em' }}>{value}</div>
    </div>
  )
}

function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, flexShrink: 0 }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

function Loading() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>Carregando…</div>
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 11, textAlign: 'center', padding: 14 }}>{msg}</div>
}

function BarChart({ data, color }: { data: Bucket[]; color: string }) {
  const max = Math.max(...data.map(d => d.value)) || 1
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 6, padding: '10px 4px 0' }}>
      {data.map(d => {
        const h = (d.value / max) * 100
        return (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{d.value}</div>
            <div style={{ width: '70%', height: `${h}%`, minHeight: 2, background: color, borderRadius: '4px 4px 0 0', opacity: .85 }} />
            <div style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', textAlign: 'center' }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function DonutChart({ data }: { data: Bucket[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const colors = ['#22d3ee', '#7dd3fc', '#3b82f6', '#a78bfa', '#f472b6', '#fbbf24']
  let a0 = -Math.PI / 2
  const r = 60, ir = 38, cx = 70, cy = 70
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minHeight: 0 }}>
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flexShrink: 0 }}>
        {data.map((d, i) => {
          const a1 = a0 + (d.value / total) * Math.PI * 2
          const large = a1 - a0 > Math.PI ? 1 : 0
          const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
          const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
          const xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0)
          const xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1)
          const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z`
          a0 = a1
          return <path key={i} d={path} fill={colors[i % colors.length]} opacity={.92} />
        })}
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#cbd5e1' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0 }} />
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
            <strong style={{ color: '#fff' }}>{((d.value / total) * 100).toFixed(1)}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineChart({ data, totalResults }: { data: Array<{ date: string; spend: number; impressions: number; clicks: number }>; totalResults: number }) {
  // Como timeSeriesData não tem leads/results por dia (só spend/imp/clicks), aproxima CPL = spend/(results proporcional ao clicks)
  // Se tiver totalResults > 0, distribui proporcional ao spend
  const totalSpend = data.reduce((s, d) => s + d.spend, 0) || 1
  const enriched = data.map(d => ({
    label: d.date,
    spend: d.spend,
    leads: totalResults > 0 ? (d.spend / totalSpend) * totalResults : d.clicks,
    cpl: totalResults > 0 ? (d.spend / ((d.spend / totalSpend) * totalResults)) : (d.clicks > 0 ? d.spend / d.clicks : 0),
  }))
  const w = 600, h = 200, pad = { l: 36, r: 36, t: 12, b: 30 }
  const investMax = Math.max(...enriched.map(d => d.spend)) || 1
  const cplMax = Math.max(...enriched.map(d => d.cpl)) || 1
  const stepX = enriched.length > 1 ? (w - pad.l - pad.r) / (enriched.length - 1) : 0
  const xy = (i: number, v: number, max: number): [number, number] => [pad.l + i * stepX, h - pad.b - (h - pad.t - pad.b) * (v / max)]
  const bw = Math.max(8, stepX * 0.55)
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ flex: 1, width: '100%' }}>
        {enriched.map((d, i) => {
          const [x] = xy(i, d.spend, investMax)
          const bh = (h - pad.t - pad.b) * (d.spend / investMax)
          return <rect key={i} x={x - bw / 2} y={h - pad.b - bh} width={bw} height={bh} rx={2} fill="#22d3ee" opacity={.7} />
        })}
        <polyline
          points={enriched.map((d, i) => { const [x, y] = xy(i, d.cpl, cplMax); return `${x},${y}` }).join(' ')}
          fill="none" stroke="#fbbf24" strokeWidth={2}
        />
        {enriched.map((d, i) => { const [x, y] = xy(i, d.cpl, cplMax); return <circle key={`c${i}`} cx={x} cy={y} r={3} fill="#fbbf24" /> })}
        {enriched.map((d, i) => { const [x] = xy(i, 0, 1); return <text key={`l${i}`} x={x} y={h - pad.b + 14} textAnchor="middle" fontSize={9} fill="#94a3b8" fontFamily="Sora">{d.label.slice(5)}</text> })}
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 10, color: '#cbd5e1', justifyContent: 'center', marginTop: 4 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#22d3ee', marginRight: 4, verticalAlign: 'middle' }} />Investimento</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#fbbf24', marginRight: 4, verticalAlign: 'middle' }} />Custo por {totalResults > 0 ? 'Lead' : 'Clique'}</span>
      </div>
    </div>
  )
}

function CreativesGrid({ creatives, tipo }: { creatives: any[]; tipo: string }) {
  const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      {/* Thumbnails */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${creatives.length}, 1fr)`, gap: 6 }}>
        {creatives.map((c, i) => (
          <div key={i} style={{ aspectRatio: '1', background: '#0a2540', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {c.thumb ? <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18, opacity: .4 }}>📷</span>}
          </div>
        ))}
      </div>
      {/* Tabela comparativa */}
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, color: '#e2e8f0' }}>
          <tbody>
            {[
              { lbl: tipo === 'VENDAS' ? 'Compras' : tipo === 'MENSAGENS' ? 'Mensagens' : 'Leads', val: (c: any) => String(c.results) },
              { lbl: tipo === 'VENDAS' ? 'CPA' : 'Custo por Lead', val: (c: any) => c.cpl > 0 ? fmtBrl(c.cpl) : '—' },
              { lbl: 'CTR', val: (c: any) => c.ctr.toFixed(2) + '%' },
              { lbl: 'Investido', val: (c: any) => fmtBrl(c.spend) },
            ].map((row, ri) => (
              <tr key={ri}>
                <td style={{ padding: '5px 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,.04)' }}>{row.lbl}</td>
                {creatives.map((c, ci) => (
                  <td key={ci} style={{ padding: '5px 4px', textAlign: 'right', fontWeight: 700, color: '#fff', borderBottom: '1px solid rgba(255,255,255,.04)' }}>{row.val(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
