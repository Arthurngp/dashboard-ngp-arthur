'use client'
import { useEffect, useMemo, useState } from 'react'
import { Campaign, DateParam } from '@/types'
import { metaCall } from '@/lib/meta'
import { fmt, fmtI } from '@/lib/utils'
import PeriodFilter from '@/components/PeriodFilter'

interface Props {
  clienteName: string
  metaAccount: string
  periodLabel: string
  period: DateParam
  campaigns: Campaign[]
  timeSeriesData: Array<{ date: string; spend: number; impressions: number; clicks: number }>
  onApplyPeriod: (dp: DateParam, label: string, cmpDp?: DateParam | null, cmpLabel?: string | null) => void
  onClose: () => void
}

interface Bucket { label: string; value: number }

interface AccountTotals {
  spend: number
  impressions: number
  clicks: number
  reach: number
  results: number
}

interface TopAd {
  id: string
  name: string
  spend: number
  ctr: number
  results: number
  cpl: number
  impressions: number
  frequency: number
  cpm: number
  reach: number
  thumb: string
  spendShare: number  // % do investimento total
}

interface TopCamp {
  id: string
  name: string
  spend: number
  results: number
  cpl: number
  spendShare: number
}

interface TopAdset {
  id: string
  name: string
  campaignId: string
  campaignName: string
  spend: number
  results: number
  cpl: number
  spendShare: number
}

// Action keys candidatos por tipo (cobre variações Pixel/CAPI/onsite)
const ACTION_KEYS: Record<string, string[]> = {
  VENDAS: ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'offline_conversion.purchase'],
  LEADS: ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
  MENSAGENS: ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply'],
  TRÁFEGO: ['link_click'],
  ENGAJAMENTO: ['post_engagement'],
  RECONHECIMENTO: [],
}

function sumActions(actions: any[], keys: string[]): number {
  if (!actions || !actions.length || !keys.length) return 0
  let total = 0
  for (const a of actions) {
    if (keys.some(k => a.action_type === k || a.action_type.endsWith('.' + k))) {
      total += +a.value || 0
    }
  }
  return total
}

const DEVICE_NAMES: Record<string, string> = {
  iphone: 'iPhone',
  ipad: 'iPad',
  android_smartphone: 'Android (smartphone)',
  android_tablet: 'Android (tablet)',
  desktop: 'Desktop',
  mobile_web: 'Mobile web',
  mobile_app: 'Mobile app',
  unknown: 'Outros',
  other: 'Outros',
}
const GENDER_NAMES: Record<string, string> = {
  female: 'Feminino',
  male: 'Masculino',
  unknown: 'Não informado',
}

export default function PresentMode(p: Props) {
  const [age, setAge] = useState<Bucket[]>([])
  const [gender, setGender] = useState<Bucket[]>([])
  const [device, setDevice] = useState<Bucket[]>([])
  const [accountTotals, setAccountTotals] = useState<AccountTotals | null>(null)
  const [topAds, setTopAds] = useState<TopAd[]>([])
  const [topCamps, setTopCamps] = useState<TopCamp[]>([])
  const [topAdsets, setTopAdsets] = useState<TopAdset[]>([])
  const [topView, setTopView] = useState<'campanhas' | 'conjuntos'>('campanhas')
  const [expandedCampId, setExpandedCampId] = useState<string | null>(null)
  const [previewAd, setPreviewAd] = useState<TopAd | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)

  // ESC fecha modal de preview
  useEffect(() => {
    if (!previewAd) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewAd(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewAd])

  async function openAdPreview(ad: TopAd) {
    if (!ad.id) return
    setPreviewAd(ad)
    setPreviewHtml('')
    setPreviewLoading(true)
    try {
      let r = await metaCall(`${ad.id}/previews`, { ad_format: 'MOBILE_FEED_STANDARD' }, p.metaAccount)
      let html = r?.data?.[0]?.body || ''
      if (!html) {
        r = await metaCall(`${ad.id}/previews`, { ad_format: 'DESKTOP_FEED_STANDARD' }, p.metaAccount)
        html = r?.data?.[0]?.body || ''
      }
      setPreviewHtml(html || '<div style="padding:40px;color:#666;text-align:center">Preview indisponível para este formato.</div>')
    } catch (e) {
      setPreviewHtml(`<div style="padding:40px;color:#dc2626;text-align:center">Erro: ${e instanceof Error ? e.message : 'falha ao carregar'}</div>`)
    }
    setPreviewLoading(false)
  }
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

  const actionKeys = ACTION_KEYS[tipo] || ACTION_KEYS.LEADS
  const resultLabel = tipo === 'VENDAS' ? 'Compras' : tipo === 'MENSAGENS' ? 'Mensagens' : tipo === 'TRÁFEGO' ? 'Cliques' : tipo === 'ENGAJAMENTO' ? 'Engajamentos' : tipo === 'RECONHECIMENTO' ? 'Impressões' : 'Leads'
  const cprLabel = tipo === 'VENDAS' ? 'Custo por Compra' : tipo === 'MENSAGENS' ? 'Custo por Mensagem' : 'Custo por Lead'

  // Carrega tudo em paralelo
  useEffect(() => {
    if (!p.metaAccount) return
    let cancelled = false
    setLoading(true)
    setError('')
    const dp = p.period

    const baseInsights = async () => {
      const r = await metaCall('insights', {
        level: 'account', limit: '1',
        fields: 'spend,impressions,clicks,reach,actions',
        ...dp,
      }, p.metaAccount)
      const row = (r?.data && r.data[0]) || {}
      return {
        spend: +row.spend || 0,
        impressions: +row.impressions || 0,
        clicks: +row.clicks || 0,
        reach: +row.reach || 0,
        results: sumActions(row.actions, actionKeys),
      } as AccountTotals
    }

    const ageBreakdown = async () => {
      const r = await metaCall('insights', { level: 'account', breakdowns: 'age', fields: 'actions,impressions', limit: '20', ...dp }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      const isReconhec = tipo === 'RECONHECIMENTO'
      return rows.map((row: any) => ({
        label: String(row.age || '—'),
        value: isReconhec ? (+row.impressions || 0) : sumActions(row.actions, actionKeys),
      })).filter((b: Bucket) => b.value > 0).sort((a: Bucket, b: Bucket) => {
        // Ordena por faixa etária natural
        const order: Record<string, number> = { '13-17': 1, '18-24': 2, '25-34': 3, '35-44': 4, '45-54': 5, '55-64': 6, '65+': 7 }
        return (order[a.label] || 99) - (order[b.label] || 99)
      })
    }

    const genderBreakdown = async () => {
      const r = await metaCall('insights', { level: 'account', breakdowns: 'gender', fields: 'impressions', limit: '10', ...dp }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      return rows.map((row: any) => ({
        label: GENDER_NAMES[String(row.gender || '').toLowerCase()] || String(row.gender || '—'),
        value: +row.impressions || 0,
      })).filter((b: Bucket) => b.value > 0)
    }

    const deviceBreakdown = async () => {
      // impression_device é mais granular: iphone, ipad, android_smartphone, etc
      const r = await metaCall('insights', { level: 'account', breakdowns: 'impression_device', fields: 'impressions', limit: '20', ...dp }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      return rows.map((row: any) => {
        const raw = String(row.impression_device || '').toLowerCase()
        return { label: DEVICE_NAMES[raw] || raw || '—', value: +row.impressions || 0 }
      }).filter((b: Bucket) => b.value > 0).sort((a: Bucket, b: Bucket) => b.value - a.value)
    }

    const topCreatives = async () => {
      // Busca top 50 ads e ranqueia local por results do tipo correto
      const r = await metaCall('insights', {
        level: 'ad', limit: '50',
        fields: 'ad_id,ad_name,spend,ctr,actions,impressions,frequency,cpm,reach',
        ...dp,
      }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      const totalSpend = rows.reduce((s: number, ad: any) => s + (+ad.spend || 0), 0) || 1
      const ranked = rows.map((ad: any) => {
        const results = sumActions(ad.actions, actionKeys)
        const spend = +ad.spend || 0
        return {
          id: ad.ad_id || '',
          name: ad.ad_name || '—',
          spend,
          ctr: +ad.ctr || 0,
          results,
          cpl: results > 0 ? spend / results : 0,
          impressions: +ad.impressions || 0,
          frequency: +ad.frequency || 0,
          cpm: +ad.cpm || 0,
          reach: +ad.reach || 0,
          spendShare: (spend / totalSpend) * 100,
          thumb: '',
        } as TopAd
      })
        .sort((a, b) => b.results - a.results || b.ctr - a.ctr)
        .slice(0, 5)

      // Busca thumbnails em paralelo (best-effort)
      await Promise.all(ranked.map(async ad => {
        if (!ad.id) return
        try {
          const cr = await metaCall(`${ad.id}/`, { fields: 'creative{thumbnail_url.width(200).height(200),image_url}' }, p.metaAccount)
          ad.thumb = cr?.creative?.thumbnail_url || cr?.creative?.image_url || ''
        } catch {}
      }))
      return ranked
    }

    const topCampaigns = async () => {
      const r = await metaCall('insights', {
        level: 'campaign', limit: '50',
        fields: 'campaign_id,campaign_name,spend,actions',
        ...dp,
      }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      const totalSpend = rows.reduce((s: number, c: any) => s + (+c.spend || 0), 0) || 1
      return rows.map((c: any) => {
        const results = sumActions(c.actions, actionKeys)
        const spend = +c.spend || 0
        return {
          id: c.campaign_id || '',
          name: c.campaign_name || '—',
          spend,
          results,
          cpl: results > 0 ? spend / results : 0,
          spendShare: (spend / totalSpend) * 100,
        } as TopCamp
      })
        .sort((a, b) => b.results - a.results || b.spend - a.spend)
        .slice(0, 5)
    }

    const topAdsetsAll = async () => {
      const r = await metaCall('insights', {
        level: 'adset', limit: '100',
        fields: 'adset_id,adset_name,campaign_id,campaign_name,spend,actions',
        ...dp,
      }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      const totalSpend = rows.reduce((s: number, x: any) => s + (+x.spend || 0), 0) || 1
      return rows.map((x: any) => {
        const results = sumActions(x.actions, actionKeys)
        const spend = +x.spend || 0
        return {
          id: x.adset_id || '',
          name: x.adset_name || '—',
          campaignId: x.campaign_id || '',
          campaignName: x.campaign_name || '—',
          spend,
          results,
          cpl: results > 0 ? spend / results : 0,
          spendShare: (spend / totalSpend) * 100,
        } as TopAdset
      })
        .sort((a, b) => b.results - a.results || b.spend - a.spend)
    }

    Promise.all([baseInsights(), ageBreakdown(), genderBreakdown(), deviceBreakdown(), topCreatives(), topCampaigns(), topAdsetsAll()])
      .then(([totals, a, g, d, ads, camps, adsets]) => {
        if (cancelled) return
        setAccountTotals(totals)
        setAge(a)
        setGender(g)
        setDevice(d)
        setTopAds(ads)
        setTopCamps(camps)
        setTopAdsets(adsets)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Falha ao carregar dados')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [p.metaAccount, p.period, tipo])

  const totals = accountTotals || { spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0 }
  const cpr = totals.results > 0 ? totals.spend / totals.results : 0

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
        <div>
          <PeriodFilter onApply={p.onApplyPeriod} />
        </div>
        <button onClick={p.onClose} style={{ padding: '9px 14px', background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Voltar</button>
      </div>

      {/* Grid principal: 2 colunas */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 14, minHeight: 0 }}>
        {/* COLUNA ESQUERDA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {/* 6 KPIs em 2x3 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Kpi label="Valor Investido" value={`R$ ${fmt(totals.spend)}`} />
            <Kpi label={resultLabel} value={totals.results > 0 ? String(totals.results) : '—'} />
            <Kpi label={cprLabel} value={cpr > 0 ? `R$ ${cpr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} />
            <Kpi label="Impressões" value={fmtI(totals.impressions)} />
            <Kpi label="Alcance" value={fmtI(totals.reach)} />
            <Kpi label="Cliques" value={fmtI(totals.clicks)} />
          </div>
          <Card title={`Idade × ${resultLabel}`} style={{ flex: 1 }}>
            {loading && !age.length ? <Loading /> : age.length === 0 ? <Empty msg={error || `Sem ${resultLabel.toLowerCase()} por idade`} /> : <BarChart data={age} color="#22d3ee" />}
          </Card>
          <Card title="Investimento e Custo por Lead — por dia" style={{ flex: 1 }}>
            {p.timeSeriesData.length === 0 ? <Empty msg="Sem série temporal" /> : <TimelineChart data={p.timeSeriesData} totalResults={totals.results} resultLabel={resultLabel} />}
          </Card>
        </div>

        {/* COLUNA DIREITA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <Card title="🏆 Criativos campeões" style={{ flex: 2, minHeight: 0 }}>
            {loading && !topAds.length ? <Loading /> : topAds.length === 0 ? <Empty msg="Sem criativos no período" /> : <CreativesGrid creatives={topAds} resultLabel={resultLabel} cprLabel={cprLabel} onClick={openAdPreview} />}
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 12, flex: 1, minHeight: 0, maxHeight: 260 }}>
            <Card title="Gênero × impressões">
              {loading && !gender.length ? <Loading /> : gender.length === 0 ? <Empty msg="Sem dados" /> : <DonutChart data={gender} />}
            </Card>
            <Card title="Dispositivos">
              {loading && !device.length ? <Loading /> : device.length === 0 ? <Empty msg="Sem dados" /> : <DonutChart data={device} />}
            </Card>
            <TopBox
              loading={loading}
              view={topView}
              onSetView={(v) => { setTopView(v); setExpandedCampId(null) }}
              camps={topCamps}
              adsets={topAdsets}
              expandedCampId={expandedCampId}
              onToggleCamp={(id) => setExpandedCampId(prev => prev === id ? null : id)}
              resultLabel={resultLabel}
              cprLabel={cprLabel}
            />
          </div>
        </div>
      </div>

      {/* Modal de preview do criativo (iframe oficial Meta) */}
      {previewAd && (
        <div onClick={() => setPreviewAd(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0a2540', borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', width: 'min(520px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#7dd3fc', letterSpacing: '.06em', textTransform: 'uppercase' }}>Preview do criativo</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewAd.name}</div>
              </div>
              <button onClick={() => setPreviewAd(null)} style={{ background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 8, color: '#fff', padding: '6px 10px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }} title="Fechar (ESC)">×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: '#fff' }}>
              {previewLoading ? (
                <div style={{ padding: 60, color: '#666', fontSize: 13 }}>Carregando preview…</div>
              ) : (
                <iframe
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  style={{ width: '100%', height: 600, border: 0, display: 'block' }}
                  title="Preview"
                />
              )}
            </div>
          </div>
        </div>
      )}
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
  // SVG escala automaticamente ao container (preserveAspectRatio:none),
  // não depende de height definido no pai.
  const w = 600, h = 240, pad = { l: 10, r: 10, t: 28, b: 32 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const slot = innerW / data.length
  const bw = slot * 0.6
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {data.map((d, i) => {
          const bh = (d.value / max) * innerH
          const x = pad.l + i * slot + (slot - bw) / 2
          const y = h - pad.b - bh
          return (
            <g key={d.label}>
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff" fontFamily="Sora">{d.value}</text>
              <rect x={x} y={y} width={bw} height={bh} rx={3} fill={color} opacity={.85} />
              <text x={x + bw / 2} y={h - pad.b + 18} textAnchor="middle" fontSize={11} fill="#94a3b8" fontFamily="Sora">{d.label}</text>
            </g>
          )
        })}
      </svg>
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

function TimelineChart({ data, totalResults, resultLabel }: { data: Array<{ date: string; spend: number; impressions: number; clicks: number }>; totalResults: number; resultLabel: string }) {
  const totalSpend = data.reduce((s, d) => s + d.spend, 0) || 1
  const enriched = data.map(d => ({
    label: d.date,
    spend: d.spend,
    leads: totalResults > 0 ? (d.spend / totalSpend) * totalResults : d.clicks,
    cpl: totalResults > 0 ? (d.spend / Math.max(.0001, (d.spend / totalSpend) * totalResults)) : (d.clicks > 0 ? d.spend / d.clicks : 0),
  }))
  const w = 600, h = 200, pad = { l: 36, r: 36, t: 12, b: 30 }
  const investMax = Math.max(...enriched.map(d => d.spend)) || 1
  const cplMax = Math.max(...enriched.map(d => d.cpl)) || 1
  const stepX = enriched.length > 1 ? (w - pad.l - pad.r) / (enriched.length - 1) : 0
  const xy = (i: number, v: number, max: number): [number, number] => [pad.l + i * stepX, h - pad.b - (h - pad.t - pad.b) * (v / max)]
  const bw = Math.max(6, stepX * 0.55)

  // Eixo X: mostra só ~6 labels distribuídos pra não sobrepor.
  // useDashboard.ts já formata o date como "17 mai" (pt-BR) — uso direto.
  const labelStep = Math.max(1, Math.floor(enriched.length / 6))
  const fmtDate = (s: string) => s

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
        {enriched.map((d, i) => {
          if (i % labelStep !== 0 && i !== enriched.length - 1) return null
          const [x] = xy(i, 0, 1)
          return <text key={`l${i}`} x={x} y={h - pad.b + 14} textAnchor="middle" fontSize={9} fill="#94a3b8" fontFamily="Sora">{fmtDate(d.label)}</text>
        })}
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 10, color: '#cbd5e1', justifyContent: 'center', marginTop: 4 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#22d3ee', marginRight: 4, verticalAlign: 'middle' }} />Investimento</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#fbbf24', marginRight: 4, verticalAlign: 'middle' }} />Custo por {totalResults > 0 ? resultLabel.replace(/s$/, '') : 'Clique'}</span>
      </div>
    </div>
  )
}

function TopBox(p: {
  loading: boolean
  view: 'campanhas' | 'conjuntos'
  onSetView: (v: 'campanhas' | 'conjuntos') => void
  camps: TopCamp[]
  adsets: TopAdset[]
  expandedCampId: string | null
  onToggleCamp: (id: string) => void
  resultLabel: string
  cprLabel: string
}) {
  const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const isLoading = p.loading && !p.camps.length && !p.adsets.length
  const isEmpty = p.view === 'campanhas' ? p.camps.length === 0 : p.adsets.length === 0

  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header com toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '.06em', textTransform: 'uppercase', flex: 1 }}>🥇 Top {p.view === 'campanhas' ? 'campanhas' : 'conjuntos'} ({p.resultLabel.toLowerCase()})</div>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: 2 }}>
          <button onClick={() => p.onSetView('campanhas')} style={toggleBtnStyle(p.view === 'campanhas')}>C</button>
          <button onClick={() => p.onSetView('conjuntos')} style={toggleBtnStyle(p.view === 'conjuntos')}>S</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>Carregando…</div>
        ) : isEmpty ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 11, textAlign: 'center', padding: 14 }}>
            Sem {p.view === 'campanhas' ? 'campanhas' : 'conjuntos'} no período
          </div>
        ) : p.view === 'campanhas' ? (
          // CAMPANHAS — clicáveis pra expandir e mostrar adsets dela
          (() => {
            const max = Math.max(...p.camps.map(c => c.results)) || 1
            return p.camps.map((c, i) => {
              const expanded = p.expandedCampId === c.id
              const childAdsets = expanded ? p.adsets.filter(a => a.campaignId === c.id) : []
              return (
                <div key={c.id || i}>
                  <button
                    type="button"
                    onClick={() => p.onToggleCamp(c.id)}
                    style={{ all: 'unset', display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: expanded ? 'rgba(34,211,238,.08)' : 'rgba(255,255,255,.03)', borderRadius: 6, cursor: 'pointer', width: '100%', boxSizing: 'border-box', borderLeft: expanded ? '2px solid #22d3ee' : '2px solid transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', background: i === 0 ? '#fbbf24' : '#475569', color: '#0a2540', fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>{c.name}</span>
                      <strong style={{ color: '#7dd3fc', fontSize: 13 }}>{c.results}</strong>
                      <span style={{ fontSize: 9, color: '#94a3b8', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .12s', display: 'inline-block' }}>▶</span>
                    </div>
                    <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${(c.results / max) * 100}%`, height: '100%', background: '#22d3ee' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#94a3b8' }}>
                      <span>{p.cprLabel}: <strong style={{ color: '#cbd5e1' }}>{c.cpl > 0 ? fmtBrl(c.cpl) : '—'}</strong></span>
                      <span style={{ marginLeft: 'auto' }}>{c.spendShare.toFixed(1)}% invest.</span>
                    </div>
                  </button>

                  {/* Adsets da campanha expandida */}
                  {expanded && (
                    <div style={{ paddingLeft: 16, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {childAdsets.length === 0 ? (
                        <div style={{ fontSize: 10, color: '#64748b', padding: '4px 8px', fontStyle: 'italic' }}>Sem conjuntos com dados no período</div>
                      ) : childAdsets.slice(0, 5).map((a, ai) => (
                        <div key={a.id || ai} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '4px 8px', background: 'rgba(255,255,255,.02)', borderRadius: 4 }}>
                          <span style={{ color: '#7dd3fc' }}>↳</span>
                          <span style={{ flex: 1, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</span>
                          <strong style={{ color: '#fff' }}>{a.results}</strong>
                          <span style={{ color: '#94a3b8' }}>·</span>
                          <span style={{ color: '#94a3b8' }}>{a.cpl > 0 ? fmtBrl(a.cpl) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          })()
        ) : (
          // CONJUNTOS — lista flat (top 8) com nome do adset + nome da campanha em cima
          (() => {
            const top = p.adsets.slice(0, 8)
            const max = Math.max(...top.map(a => a.results)) || 1
            return top.map((a, i) => (
              <div key={a.id || i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: i === 0 ? '#fbbf24' : '#475569', color: '#0a2540', fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</span>
                    <span style={{ display: 'block', color: '#64748b', fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.campaignName}>↳ {a.campaignName}</span>
                  </span>
                  <strong style={{ color: '#7dd3fc', fontSize: 13 }}>{a.results}</strong>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(a.results / max) * 100}%`, height: '100%', background: '#22d3ee' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#94a3b8' }}>
                  <span>{p.cprLabel}: <strong style={{ color: '#cbd5e1' }}>{a.cpl > 0 ? fmtBrl(a.cpl) : '—'}</strong></span>
                  <span style={{ marginLeft: 'auto' }}>{a.spendShare.toFixed(1)}% invest.</span>
                </div>
              </div>
            ))
          })()
        )}
      </div>
    </div>
  )
}

function toggleBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'linear-gradient(135deg, #22d3ee, #3b82f6)' : 'transparent',
    border: 'none',
    color: active ? '#0a2540' : '#94a3b8',
    fontSize: 10,
    fontWeight: 800,
    padding: '4px 9px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 22,
  }
}

function CreativesGrid({ creatives, resultLabel, cprLabel, onClick }: { creatives: TopAd[]; resultLabel: string; cprLabel: string; onClick?: (c: TopAd) => void }) {
  const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtN = (n: number) => n.toLocaleString('pt-BR')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }}>
      {/* Thumbnails — clicáveis para abrir preview do anúncio */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${creatives.length}, 1fr)`, gap: 8, flexShrink: 0 }}>
        {creatives.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onClick?.(c)}
            title={`Clique para ver preview: ${c.name}`}
            style={{ all: 'unset', aspectRatio: '1', background: '#0a2540', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.05)', cursor: onClick ? 'pointer' : 'default', transition: 'transform .12s, box-shadow .12s', position: 'relative' }}
            onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(34,211,238,.25)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,.5)' } }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'rgba(255,255,255,.05)' }}
          >
            {c.thumb ? <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 20, opacity: .4 }}>📷</span>}
            {onClick && <span style={{ position: 'absolute', bottom: 4, right: 4, fontSize: 9, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 5px', borderRadius: 4, fontWeight: 700 }}>👁 ver</span>}
          </button>
        ))}
      </div>
      {/* Tabela comparativa — 8 métricas pra análise rica */}
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, color: '#e2e8f0' }}>
          <tbody>
            {[
              { lbl: resultLabel, val: (c: TopAd) => String(c.results), highlight: true },
              { lbl: cprLabel, val: (c: TopAd) => c.cpl > 0 ? fmtBrl(c.cpl) : '—', highlight: true },
              { lbl: 'CTR', val: (c: TopAd) => c.ctr.toFixed(2) + '%' },
              { lbl: 'Investido', val: (c: TopAd) => fmtBrl(c.spend) },
              { lbl: '% Investimento', val: (c: TopAd) => c.spendShare.toFixed(1) + '%' },
              { lbl: 'Impressões', val: (c: TopAd) => fmtN(c.impressions) },
              { lbl: 'Alcance', val: (c: TopAd) => c.reach > 0 ? fmtN(c.reach) : '—' },
              { lbl: 'Frequência', val: (c: TopAd) => c.frequency > 0 ? c.frequency.toFixed(2) : '—' },
              { lbl: 'CPM', val: (c: TopAd) => c.cpm > 0 ? fmtBrl(c.cpm) : '—' },
            ].map((row, ri) => (
              <tr key={ri}>
                <td style={{ padding: '6px 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,.04)' }}>{row.lbl}</td>
                {creatives.map((c, ci) => (
                  <td key={ci} style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: row.highlight ? '#7dd3fc' : '#fff', fontSize: row.highlight ? 13 : 12, borderBottom: '1px solid rgba(255,255,255,.04)' }}>{row.val(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
