'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  timeSeriesData: Array<{ date: string; spend: number; impressions: number; clicks: number; actions?: Array<{ action_type: string; value: string }> }>
  onApplyPeriod: (dp: DateParam, label: string, cmpDp?: DateParam, cmpLabel?: string) => void
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

// Resolve o valor de uma única "categoria" de evento (compras, leads, mensagens, etc.).
// CRÍTICO: a Meta retorna o MESMO evento com vários action_types (omni_purchase,
// offsite_conversion.fb_pixel_purchase, purchase). Somar todos infla o número.
// Estratégia: usa o PRIMEIRO action_type da lista de keys que existir nos actions.
// As keys devem estar em ordem de preferência (mais agregado/deduplicado primeiro).
function sumActions(actions: any[], keys: string[]): number {
  if (!actions || !actions.length || !keys.length) return 0
  // Indexar actions por action_type pra busca rápida
  const byType: Record<string, number> = {}
  for (const a of actions) {
    if (a?.action_type) byType[a.action_type] = +a.value || 0
  }
  // Procura match exato seguindo a ordem de preferência das keys
  for (const k of keys) {
    if (byType[k] !== undefined) return byType[k]
  }
  // Fallback: alguns events vêm como "ns_X.key" (raros) — tenta match por sufixo
  for (const k of keys) {
    for (const type of Object.keys(byType)) {
      if (type.endsWith('.' + k)) return byType[type]
    }
  }
  return 0
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

  // Tipo dominante detectado automaticamente, ponderado por spend.
  const tipoDetectado = useMemo(() => {
    if (!p.campaigns.length) return 'LEADS'
    const weight: Record<string, number> = {}
    p.campaigns.forEach(c => {
      const o = (c.objective as string) || ''
      const w = (c.spend || 0) + 1
      weight[o] = (weight[o] || 0) + w
    })
    const top = Object.entries(weight).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    if (top.includes('SALES') || top.includes('CONVERSIONS') || top.includes('PRODUCT') || top.includes('CATALOG')) return 'VENDAS'
    if (top.includes('LEADS') || top.includes('LEAD_GEN')) return 'LEADS'
    if (top.includes('MESSAG')) return 'MENSAGENS'
    if (top.includes('TRAFFIC') || top.includes('LINK_CLICK')) return 'TRÁFEGO'
    if (top.includes('ENGAGE') || top.includes('POST')) return 'ENGAJAMENTO'
    if (top.includes('AWARENESS') || top.includes('REACH') || top.includes('VIDEO')) return 'RECONHECIMENTO'
    return 'LEADS'
  }, [p.campaigns])

  // Tipo global: override manual do usuário (default = detectado automaticamente).
  // Quando p.campaigns muda (cliente trocou), sincroniza com o novo detectado.
  const [tipo, setTipo] = useState<string>(tipoDetectado)
  useEffect(() => { setTipo(tipoDetectado) }, [tipoDetectado])

  // Tipo local por card — null = usa o global. Permite comparar lentes sem mexer no resto.
  const [tipoIdade, setTipoIdade] = useState<string | null>(null)
  const [tipoCriativos, setTipoCriativos] = useState<string | null>(null)
  const [tipoTop, setTipoTop] = useState<string | null>(null)

  const labelOf = (t: string) => t === 'VENDAS' ? 'Compras' : t === 'MENSAGENS' ? 'Mensagens' : t === 'TRÁFEGO' ? 'Cliques' : t === 'ENGAJAMENTO' ? 'Engajamentos' : t === 'RECONHECIMENTO' ? 'Impressões' : 'Leads'
  const cprOf = (t: string) => t === 'VENDAS' ? 'Custo por Compra' : t === 'MENSAGENS' ? 'Custo por Mensagem' : t === 'TRÁFEGO' ? 'Custo por Clique' : t === 'ENGAJAMENTO' ? 'Custo por Engajamento' : t === 'RECONHECIMENTO' ? 'CPM' : 'Custo por Lead'

  const actionKeys = ACTION_KEYS[tipo] || ACTION_KEYS.LEADS
  const resultLabel = labelOf(tipo)
  const cprLabel = cprOf(tipo)

  // Tipos efetivos por card (local override > global). useMemo evita re-fetch desnecessário.
  const tipoIdadeEff = tipoIdade || tipo
  const tipoCriativosEff = tipoCriativos || tipo
  const tipoTopEff = tipoTop || tipo

  // Fetchers reutilizáveis. Cada card pode rodar com keys diferentes (local override).
  const fetchAge = async (t: string) => {
    const r = await metaCall('insights', { level: 'account', breakdowns: 'age', fields: 'actions,impressions', limit: '20', ...p.period }, p.metaAccount)
    const rows = Array.isArray(r?.data) ? r.data : []
    const keys = ACTION_KEYS[t] || []
    const isReconhec = t === 'RECONHECIMENTO'
    return rows.map((row: any) => ({
      label: String(row.age || '—'),
      value: isReconhec ? (+row.impressions || 0) : sumActions(row.actions, keys),
    })).filter((b: Bucket) => b.value > 0).sort((a: Bucket, b: Bucket) => {
      const order: Record<string, number> = { '13-17': 1, '18-24': 2, '25-34': 3, '35-44': 4, '45-54': 5, '55-64': 6, '65+': 7 }
      return (order[a.label] || 99) - (order[b.label] || 99)
    })
  }

  const fetchTopAds = async (t: string) => {
    const keys = ACTION_KEYS[t] || []
    const r = await metaCall('insights', {
      level: 'ad', limit: '50',
      fields: 'ad_id,ad_name,spend,ctr,actions,impressions,frequency,cpm,reach',
      ...p.period,
    }, p.metaAccount)
    const rows = Array.isArray(r?.data) ? r.data : []
    const totalSpend = rows.reduce((s: number, ad: any) => s + (+ad.spend || 0), 0) || 1
    const ranked = rows.map((ad: any) => {
      const results = sumActions(ad.actions, keys)
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
      .sort((a: TopAd, b: TopAd) => b.results - a.results || b.ctr - a.ctr)
      .slice(0, 5)

    await Promise.all(ranked.map(async (ad: TopAd) => {
      if (!ad.id) return
      try {
        const cr = await metaCall(`${ad.id}/`, { fields: 'creative{thumbnail_url.width(200).height(200),image_url}' }, p.metaAccount)
        ad.thumb = cr?.creative?.thumbnail_url || cr?.creative?.image_url || ''
      } catch {}
    }))
    return ranked
  }

  const fetchTopCamps = async (t: string) => {
    const keys = ACTION_KEYS[t] || []
    const r = await metaCall('insights', {
      level: 'campaign', limit: '50',
      fields: 'campaign_id,campaign_name,spend,actions',
      ...p.period,
    }, p.metaAccount)
    const rows = Array.isArray(r?.data) ? r.data : []
    const totalSpend = rows.reduce((s: number, c: any) => s + (+c.spend || 0), 0) || 1
    return rows.map((c: any) => {
      const results = sumActions(c.actions, keys)
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
      .sort((a: TopCamp, b: TopCamp) => b.results - a.results || b.spend - a.spend)
      .slice(0, 5)
  }

  const fetchTopAdsets = async (t: string) => {
    const keys = ACTION_KEYS[t] || []
    const r = await metaCall('insights', {
      level: 'adset', limit: '100',
      fields: 'adset_id,adset_name,campaign_id,campaign_name,spend,actions',
      ...p.period,
    }, p.metaAccount)
    const rows = Array.isArray(r?.data) ? r.data : []
    const totalSpend = rows.reduce((s: number, x: any) => s + (+x.spend || 0), 0) || 1
    return rows.map((x: any) => {
      const results = sumActions(x.actions, keys)
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
      .sort((a: TopAdset, b: TopAdset) => b.results - a.results || b.spend - a.spend)
  }

  // Effect principal: carrega tudo quando muda conta, período ou tipo global.
  useEffect(() => {
    if (!p.metaAccount) return
    let cancelled = false
    setLoading(true)
    setError('')

    const baseInsights = async () => {
      const r = await metaCall('insights', {
        level: 'account', limit: '1',
        fields: 'spend,impressions,clicks,reach,actions',
        ...p.period,
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

    const genderBreakdown = async () => {
      const r = await metaCall('insights', { level: 'account', breakdowns: 'gender', fields: 'impressions', limit: '10', ...p.period }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      return rows.map((row: any) => ({
        label: GENDER_NAMES[String(row.gender || '').toLowerCase()] || String(row.gender || '—'),
        value: +row.impressions || 0,
      })).filter((b: Bucket) => b.value > 0)
    }

    const deviceBreakdown = async () => {
      const r = await metaCall('insights', { level: 'account', breakdowns: 'impression_device', fields: 'impressions', limit: '20', ...p.period }, p.metaAccount)
      const rows = Array.isArray(r?.data) ? r.data : []
      return rows.map((row: any) => {
        const raw = String(row.impression_device || '').toLowerCase()
        return { label: DEVICE_NAMES[raw] || raw || '—', value: +row.impressions || 0 }
      }).filter((b: Bucket) => b.value > 0).sort((a: Bucket, b: Bucket) => b.value - a.value)
    }

    Promise.all([
      baseInsights(),
      fetchAge(tipoIdadeEff),
      genderBreakdown(),
      deviceBreakdown(),
      fetchTopAds(tipoCriativosEff),
      fetchTopCamps(tipoTopEff),
      fetchTopAdsets(tipoTopEff),
    ])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.metaAccount, p.period, tipo])

  // Effects locais: refetch SÓ quando o override local muda.
  // - tipoIdade=null → effect principal cuida (não dispara aqui)
  // - tipoIdade='VENDAS' → busca com 'VENDAS'
  // - tipoIdade volta pra null → busca com global pra restaurar
  // Pulamos o primeiro disparo (montagem) porque o effect principal já vai carregar.
  const skipIdade = useRef(true)
  useEffect(() => {
    if (skipIdade.current) { skipIdade.current = false; return }
    if (!p.metaAccount) return
    let cancelled = false
    fetchAge(tipoIdade || tipo).then(a => { if (!cancelled) setAge(a) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoIdade])

  const skipCriativos = useRef(true)
  useEffect(() => {
    if (skipCriativos.current) { skipCriativos.current = false; return }
    if (!p.metaAccount) return
    let cancelled = false
    fetchTopAds(tipoCriativos || tipo).then(ads => { if (!cancelled) setTopAds(ads) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoCriativos])

  const skipTop = useRef(true)
  useEffect(() => {
    if (skipTop.current) { skipTop.current = false; return }
    if (!p.metaAccount) return
    let cancelled = false
    Promise.all([fetchTopCamps(tipoTop || tipo), fetchTopAdsets(tipoTop || tipo)]).then(([camps, adsets]) => {
      if (cancelled) return
      setTopCamps(camps)
      setTopAdsets(adsets)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoTop])

  const totals = accountTotals || { spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0 }
  const cpr = totals.results > 0 ? totals.spend / totals.results : 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a2540', zIndex: 1000, padding: 'clamp(10px, 1.5vw, 24px) clamp(14px, 2vw, 32px)', fontFamily: 'Sora,sans-serif', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.2vw, 18px)', overflow: 'hidden', boxSizing: 'border-box', isolation: 'isolate' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.2vw, 20px)', flexShrink: 0 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 'clamp(16px, 1.6vw, 28px)', fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1 }}>DADOS DE CAMPANHAS</div>
          <div style={{ fontSize: 'clamp(9px, .8vw, 14px)', fontWeight: 700, color: '#7dd3fc', letterSpacing: '.08em', marginTop: 4 }}>
            {(p.clienteName || 'CLIENTE').toUpperCase()} — {labelOfTipo(tipo).toUpperCase()} — META ADS
          </div>
        </div>
        <TipoSelector value={tipo} onChange={(v) => {
          setTipo(v)
          // Resetar overrides locais quando troca global (faz sentido voltarem pra "Auto")
          setTipoIdade(null); setTipoCriativos(null); setTipoTop(null)
        }} />
        <div>
          <PeriodFilter onApply={p.onApplyPeriod} />
        </div>
        <button onClick={p.onClose} style={{ padding: 'clamp(7px, .7vw, 12px) clamp(10px, 1vw, 18px)', background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 10, color: '#fff', fontSize: 'clamp(10px, .8vw, 14px)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Voltar</button>
      </div>

      {/* Grid principal: 2 colunas */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 'clamp(8px, 1.2vw, 18px)', minHeight: 0 }}>
        {/* COLUNA ESQUERDA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px, 1vw, 14px)', minHeight: 0 }}>
          {/* 6 KPIs em 2x3 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'clamp(6px, .8vw, 12px)', flexShrink: 0 }}>
            <Kpi label="Valor Investido" value={`R$ ${fmt(totals.spend)}`} />
            <Kpi label={resultLabel} value={totals.results > 0 ? String(totals.results) : '—'} />
            <Kpi label={cprLabel} value={cpr > 0 ? `R$ ${cpr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} />
            <Kpi label="Impressões" value={fmtI(totals.impressions)} />
            <Kpi label="Alcance" value={fmtI(totals.reach)} />
            <Kpi label="Cliques" value={fmtI(totals.clicks)} />
          </div>
          <Card
            title={`Idade × ${labelOfTipo(tipoIdadeEff)}`}
            style={{ flex: '1 1 0', minHeight: 0 }}
            headerRight={<LocalTabs value={tipoIdade} globalValue={tipo} onChange={setTipoIdade} />}
          >
            {loading && !age.length ? <Loading /> : age.length === 0 ? <Empty msg={error || `Sem ${labelOfTipo(tipoIdadeEff).toLowerCase()} por idade`} /> : <BarChart data={age} color="#22d3ee" />}
          </Card>
          <Card title={`Investimento e ${cprOf(tipo)} — por dia`} style={{ flex: '1 1 0', minHeight: 0 }}>
            {p.timeSeriesData.length === 0 ? <Empty msg="Sem série temporal" /> : <TimelineChart data={p.timeSeriesData} resultLabel={resultLabel} actionKeys={actionKeys} />}
          </Card>
        </div>

        {/* COLUNA DIREITA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px, 1vw, 14px)', minHeight: 0 }}>
          <Card
            title={`🏆 Criativos campeões — ${labelOfTipo(tipoCriativosEff)}`}
            style={{ flex: '2 1 0', minHeight: 0 }}
            headerRight={<LocalTabs value={tipoCriativos} globalValue={tipo} onChange={setTipoCriativos} />}
          >
            {loading && !topAds.length ? <Loading /> : topAds.length === 0 ? <Empty msg={`Sem criativos com ${labelOfTipo(tipoCriativosEff).toLowerCase()} no período`} /> : <CreativesGrid creatives={topAds} resultLabel={labelOfTipo(tipoCriativosEff)} cprLabel={cprOf(tipoCriativosEff)} onClick={openAdPreview} />}
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr)', gap: 'clamp(8px, 1vw, 14px)', flex: '1 1 0', minHeight: 0 }}>
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
              resultLabel={labelOfTipo(tipoTopEff)}
              cprLabel={cprOf(tipoTopEff)}
              tipoLocal={tipoTop}
              tipoGlobal={tipo}
              onSetTipoLocal={setTipoTop}
            />
          </div>
        </div>
      </div>

      {/* Overlay de carregamento — aparece quando dados estão sendo buscados na Meta */}
      {loading && <LoadingOverlay />}

      {/* Modal de preview do criativo (iframe oficial Meta) — altura ajusta ao conteúdo */}
      {previewAd && <AdPreviewModal previewAd={previewAd} previewHtml={previewHtml} previewLoading={previewLoading} onClose={() => setPreviewAd(null)} />}
    </div>
  )
}

// Overlay de carregamento usado durante refetches do PresentMode.
function LoadingOverlay() {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(10,37,64,.7)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
      pointerEvents: 'auto',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: '3px solid rgba(34,211,238,.15)',
        borderTopColor: '#22d3ee',
        animation: 'present-spin .8s linear infinite',
      }} />
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: '#7dd3fc',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
      }}>
        Carregando dados…
      </div>
      <div style={{
        fontSize: 11,
        color: '#94a3b8',
        maxWidth: 320,
        textAlign: 'center',
      }}>
        Buscando informações na API da Meta. Pode levar alguns segundos.
      </div>
      <style>{`@keyframes present-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// Modal de preview do anúncio — renderiza o HTML da Meta direto no DOM via Shadow DOM
// (isolamento de CSS sem precisar de iframe). O modal cola exatamente na altura do conteúdo.
function AdPreviewModal({ previewAd, previewHtml, previewLoading, onClose }: { previewAd: TopAd; previewHtml: string; previewLoading: boolean; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  // Injeta o HTML da Meta dentro de um Shadow DOM (isola estilos do app).
  useEffect(() => {
    if (!hostRef.current || !previewHtml || previewLoading) return
    let shadow = hostRef.current.shadowRoot
    if (!shadow) {
      shadow = hostRef.current.attachShadow({ mode: 'open' })
    }
    // Limpa e injeta
    shadow.innerHTML = previewHtml
  }, [previewHtml, previewLoading])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0a2540', borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', width: 'min(420px, 95vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.5)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7dd3fc', letterSpacing: '.06em', textTransform: 'uppercase' }}>Preview do criativo</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewAd.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 8, color: '#fff', padding: '5px 9px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }} title="Fechar (ESC)">×</button>
        </div>
        <div style={{ background: '#fff', flexShrink: 0, overflow: 'auto', maxHeight: 'calc(92vh - 50px)' }}>
          {previewLoading ? (
            <div style={{ padding: 60, color: '#666', fontSize: 13, textAlign: 'center' }}>Carregando preview…</div>
          ) : (
            <div ref={hostRef} style={{ width: '100%' }} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 'clamp(8px, .9vw, 14px) clamp(10px, 1.1vw, 18px)', minWidth: 0 }}>
      <div style={{ fontSize: 'clamp(8px, .65vw, 12px)', color: '#94a3b8', fontWeight: 600, letterSpacing: '.04em', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 'clamp(14px, 1.3vw, 24px)', fontWeight: 800, color: '#fff', letterSpacing: '-.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  )
}

function Card({ title, children, style, headerRight }: { title: string; children: React.ReactNode; style?: React.CSSProperties; headerRight?: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 'clamp(10px, 1vw, 16px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'clamp(6px, .7vw, 10px)', flexShrink: 0 }}>
        <div style={{ fontSize: 'clamp(9px, .75vw, 13px)', fontWeight: 700, color: '#fff', letterSpacing: '.06em', textTransform: 'uppercase', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {headerRight}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

// Lista de tipos disponíveis no seletor (ordem importa: do mais comum pro menos)
const TIPOS_DISPONIVEIS = ['VENDAS', 'LEADS', 'MENSAGENS', 'TRÁFEGO', 'ENGAJAMENTO', 'RECONHECIMENTO'] as const

// Seletor global no header — dropdown nativo, estilo dark.
function TipoSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: 'clamp(6px, .7vw, 11px) clamp(10px, 1vw, 16px)',
        background: 'rgba(34,211,238,.1)',
        border: '1.5px solid rgba(34,211,238,.35)',
        borderRadius: 10,
        color: '#7dd3fc',
        fontSize: 'clamp(10px, .8vw, 14px)',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        outline: 'none',
        appearance: 'none',
        paddingRight: 'clamp(22px, 2vw, 32px)',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%237dd3fc' d='M6 8L2 4h8z'/></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
      }}
    >
      {TIPOS_DISPONIVEIS.map(t => (
        <option key={t} value={t} style={{ background: '#0a2540' }}>{labelOfTipo(t)}</option>
      ))}
    </select>
  )
}

// Tabs locais — chips clicáveis discretos no header dos cards.
// "Auto" = sem override (usa o global). Outros = override desse card.
// Em cards estreitos vira dropdown nativo (compact mode), em cards largos vira chips horizontais.
function LocalTabs({ value, onChange, globalValue, compact }: { value: string | null; onChange: (v: string | null) => void; globalValue: string; compact?: boolean }) {
  const opts: Array<{ v: string | null; lbl: string; title: string }> = [
    { v: null, lbl: 'Auto', title: `Acompanha o tipo global (${labelOfTipo(globalValue)})` },
    ...TIPOS_DISPONIVEIS.map(t => ({ v: t as string, lbl: labelOfTipo(t), title: `Forçar ${labelOfTipo(t)} apenas neste card` })),
  ]
  if (compact) {
    return (
      <select
        value={value ?? '__auto__'}
        onChange={(e) => onChange(e.target.value === '__auto__' ? null : e.target.value)}
        style={{
          padding: '3px 6px',
          background: value === null ? 'rgba(0,0,0,.25)' : 'linear-gradient(135deg, #22d3ee, #3b82f6)',
          border: '1px solid rgba(255,255,255,.08)',
          borderRadius: 4,
          color: value === null ? '#94a3b8' : '#0a2540',
          fontSize: 'clamp(8px, .65vw, 11px)',
          fontWeight: 800,
          cursor: 'pointer',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      >
        {opts.map(o => (
          <option key={o.v ?? '__auto__'} value={o.v ?? '__auto__'} style={{ background: '#0a2540', color: '#fff' }}>{o.lbl}</option>
        ))}
      </select>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: 2, overflowX: 'auto', maxWidth: '100%' }}>
      {opts.map(o => {
        const active = value === o.v
        return (
          <button
            key={o.v ?? '_auto'}
            type="button"
            onClick={() => onChange(o.v)}
            title={o.title}
            style={{
              background: active ? 'linear-gradient(135deg, #22d3ee, #3b82f6)' : 'transparent',
              border: 'none',
              color: active ? '#0a2540' : '#94a3b8',
              fontSize: 'clamp(8px, .65vw, 11px)',
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >{o.lbl}</button>
        )
      })}
    </div>
  )
}

function labelOfTipo(t: string): string {
  if (t === 'VENDAS') return 'Compras'
  if (t === 'LEADS') return 'Leads'
  if (t === 'MENSAGENS') return 'Mensagens'
  if (t === 'TRÁFEGO') return 'Cliques'
  if (t === 'ENGAJAMENTO') return 'Engajamentos'
  if (t === 'RECONHECIMENTO') return 'Impressões'
  return t
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
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'clamp(6px, .8vw, 12px)', minHeight: 0 }}>
      <svg viewBox="0 0 140 140" style={{ width: 'clamp(80px, 8vw, 140px)', height: 'clamp(80px, 8vw, 140px)', flexShrink: 0 }}>
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
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'clamp(2px, .25vw, 5px)' }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'clamp(8px, .7vw, 12px)', color: '#cbd5e1' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0 }} />
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
            <strong style={{ color: '#fff' }}>{((d.value / total) * 100).toFixed(1)}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineChart({ data, resultLabel, actionKeys }: { data: Array<{ date: string; spend: number; impressions: number; clicks: number; actions?: Array<{ action_type: string; value: string }> }>; resultLabel: string; actionKeys: string[] }) {
  // CPL/CPA real por dia: usa actions do dia se disponível; fallback pra CPC (spend/clicks).
  const enriched = data.map(d => {
    const results = d.actions ? sumActions(d.actions, actionKeys) : 0
    return {
      label: d.date,
      spend: d.spend,
      clicks: d.clicks,
      impressions: d.impressions,
      results,
      cpl: results > 0 ? d.spend / results : (d.clicks > 0 ? d.spend / d.clicks : 0),
      isFallback: results === 0,
    }
  })
  const hasAnyResults = enriched.some(d => d.results > 0)
  const w = 600, h = 200, pad = { l: 36, r: 36, t: 12, b: 30 }
  const investMax = Math.max(...enriched.map(d => d.spend)) || 1
  const cplValues = enriched.filter(d => !d.isFallback || !hasAnyResults).map(d => d.cpl).filter(v => v > 0).sort((a, b) => a - b)
  const cplP95 = cplValues.length > 0 ? cplValues[Math.floor(cplValues.length * 0.95)] : 1
  const cplMax = cplP95 * 1.1 || 1
  const stepX = enriched.length > 1 ? (w - pad.l - pad.r) / (enriched.length - 1) : 0
  const xy = (i: number, v: number, max: number): [number, number] => [pad.l + i * stepX, h - pad.b - (h - pad.t - pad.b) * Math.min(1, v / max)]
  const bw = Math.max(6, stepX * 0.55)

  const labelStep = Math.max(1, Math.floor(enriched.length / 6))
  const fmtDate = (s: string) => s
  const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtN = (n: number) => n.toLocaleString('pt-BR')

  const cplPoints = enriched.map((d, i) => ({ d, i })).filter(p => p.d.results > 0)

  const totalSpend = enriched.reduce((s, d) => s + d.spend, 0)
  const totalResults = enriched.reduce((s, d) => s + d.results, 0)
  const cprMedio = totalResults > 0 ? totalSpend / totalResults : 0

  // Tooltip: hover-x detecta o dia mais próximo do cursor
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || enriched.length === 0) return
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // Converte px do DOM pra coordenada do viewBox
    const xInView = (px / rect.width) * w
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < enriched.length; i++) {
      const [x] = xy(i, 0, 1)
      const dist = Math.abs(x - xInView)
      if (dist < best) { best = dist; nearest = i }
    }
    setHover({ i: nearest, px, py })
  }
  const onLeave = () => setHover(null)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ flex: 1, width: '100%' }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* Eixo Y direito: marcadores de CPL */}
        {[0.25, 0.5, 0.75, 1].map(frac => {
          const y = pad.t + (h - pad.t - pad.b) * (1 - frac)
          return (
            <g key={frac}>
              <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="rgba(255,255,255,.05)" strokeDasharray="2 4" />
              <text x={w - pad.r + 4} y={y + 3} fontSize={8} fill="#64748b" fontFamily="Sora">{fmtBrl(cplMax * frac).replace('R$ ', '')}</text>
            </g>
          )
        })}
        {/* Linha de referência: CPL médio */}
        {cprMedio > 0 && cprMedio < cplMax && (() => {
          const y = h - pad.b - (h - pad.t - pad.b) * (cprMedio / cplMax)
          return (
            <g>
              <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#fbbf24" strokeWidth={.5} strokeDasharray="4 3" opacity={.4} />
            </g>
          )
        })()}
        {/* Barras de investimento */}
        {enriched.map((d, i) => {
          const [x] = xy(i, d.spend, investMax)
          const bh = (h - pad.t - pad.b) * (d.spend / investMax)
          const isHovered = hover?.i === i
          return <rect key={i} x={x - bw / 2} y={h - pad.b - bh} width={bw} height={bh} rx={2} fill="#22d3ee" opacity={isHovered ? 1 : .7} />
        })}
        {/* Linha de CPL */}
        {cplPoints.length > 1 && (
          <polyline
            points={cplPoints.map(({ d, i }) => { const [x, y] = xy(i, d.cpl, cplMax); return `${x},${y}` }).join(' ')}
            fill="none" stroke="#fbbf24" strokeWidth={2}
          />
        )}
        {cplPoints.map(({ d, i }) => {
          const [x, y] = xy(i, d.cpl, cplMax)
          const isHovered = hover?.i === i
          return <circle key={`c${i}`} cx={x} cy={y} r={isHovered ? 5 : 3} fill="#fbbf24" stroke={isHovered ? '#fff' : 'none'} strokeWidth={1} />
        })}
        {/* Linha vertical no hover */}
        {hover && (() => {
          const [x] = xy(hover.i, 0, 1)
          return <line x1={x} y1={pad.t} x2={x} y2={h - pad.b} stroke="rgba(255,255,255,.2)" strokeWidth={.5} />
        })()}
        {/* Labels do eixo X */}
        {enriched.map((d, i) => {
          if (i % labelStep !== 0 && i !== enriched.length - 1) return null
          const [x] = xy(i, 0, 1)
          return <text key={`l${i}`} x={x} y={h - pad.b + 14} textAnchor="middle" fontSize={9} fill="#94a3b8" fontFamily="Sora">{fmtDate(d.label)}</text>
        })}
      </svg>

      {/* Tooltip custom */}
      {hover && (() => {
        const d = enriched[hover.i]
        // Tooltip segue o mouse mas evita cortar nas bordas
        const TOOLTIP_W = 180
        const TOOLTIP_H = 110
        const offsetX = hover.px + 14
        const offsetY = hover.py - TOOLTIP_H - 10
        const finalX = offsetX + TOOLTIP_W > (svgRef.current?.getBoundingClientRect().width || 0) ? hover.px - TOOLTIP_W - 14 : offsetX
        const finalY = offsetY < 0 ? hover.py + 14 : offsetY
        return (
          <div style={{
            position: 'absolute',
            left: finalX,
            top: finalY,
            background: 'rgba(10,37,64,.96)',
            border: '1px solid rgba(34,211,238,.4)',
            borderRadius: 8,
            padding: '8px 10px',
            pointerEvents: 'none',
            fontSize: 11,
            color: '#fff',
            minWidth: 160,
            boxShadow: '0 6px 20px rgba(0,0,0,.5)',
            zIndex: 10,
            lineHeight: 1.4,
          }}>
            <div style={{ fontWeight: 700, color: '#7dd3fc', fontSize: 12, marginBottom: 4, letterSpacing: '.04em', textTransform: 'uppercase' }}>{d.label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#94a3b8' }}>Investimento</span>
              <strong style={{ color: '#22d3ee', fontVariantNumeric: 'tabular-nums' }}>{fmtBrl(d.spend)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#94a3b8' }}>{resultLabel}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{d.results > 0 ? fmtN(d.results) : '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#94a3b8' }}>{d.results > 0 ? `Custo por ${resultLabel.replace(/s$/, '')}` : 'CPC'}</span>
              <strong style={{ color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>{d.cpl > 0 ? fmtBrl(d.cpl) : '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#94a3b8' }}>Cliques</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(d.clicks)}</strong>
            </div>
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 14, fontSize: 'clamp(8px, .7vw, 11px)', color: '#cbd5e1', justifyContent: 'center', marginTop: 4, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#22d3ee', marginRight: 4, verticalAlign: 'middle' }} />Investimento</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#fbbf24', marginRight: 4, verticalAlign: 'middle' }} />Custo por {resultLabel.replace(/s$/, '')}</span>
        {!hasAnyResults && <span style={{ color: '#fbbf24', fontStyle: 'italic' }}>Sem conversões por dia — exibindo CPC</span>}
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
  tipoLocal: string | null
  tipoGlobal: string
  onSetTipoLocal: (v: string | null) => void
}) {
  const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const isLoading = p.loading && !p.camps.length && !p.adsets.length
  const isEmpty = p.view === 'campanhas' ? p.camps.length === 0 : p.adsets.length === 0

  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 'clamp(10px, 1vw, 16px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {/* Header com toggle + tabs locais */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'clamp(6px, .7vw, 10px)', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'clamp(9px, .75vw, 13px)', fontWeight: 700, color: '#fff', letterSpacing: '.06em', textTransform: 'uppercase', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🥇 Top {p.view === 'campanhas' ? 'campanhas' : 'conjuntos'} ({p.resultLabel.toLowerCase()})</div>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: 2 }}>
          <button onClick={() => p.onSetView('campanhas')} style={toggleBtnStyle(p.view === 'campanhas')}>C</button>
          <button onClick={() => p.onSetView('conjuntos')} style={toggleBtnStyle(p.view === 'conjuntos')}>S</button>
        </div>
      </div>
      <div style={{ marginBottom: 'clamp(6px, .7vw, 10px)' }}>
        <LocalTabs value={p.tipoLocal} globalValue={p.tipoGlobal} onChange={p.onSetTipoLocal} compact />
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'clamp(9px, .75vw, 13px)' }}>
                      <span style={{ width: 'clamp(14px, 1.2vw, 20px)', height: 'clamp(14px, 1.2vw, 20px)', borderRadius: '50%', background: i === 0 ? '#fbbf24' : '#475569', color: '#0a2540', fontWeight: 800, fontSize: 'clamp(8px, .7vw, 11px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={c.name}>{c.name}</span>
                      <strong style={{ color: '#7dd3fc', fontSize: 'clamp(11px, .9vw, 15px)' }}>{c.results}</strong>
                      <span style={{ fontSize: 'clamp(7px, .6vw, 10px)', color: '#94a3b8', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .12s', display: 'inline-block' }}>▶</span>
                    </div>
                    <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${(c.results / max) * 100}%`, height: '100%', background: '#22d3ee' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 'clamp(8px, .7vw, 11px)', color: '#94a3b8' }}>
                      <span>{p.cprLabel}: <strong style={{ color: '#cbd5e1' }}>{c.cpl > 0 ? fmtBrl(c.cpl) : '—'}</strong></span>
                      <span style={{ marginLeft: 'auto' }}>{c.spendShare.toFixed(1)}% invest.</span>
                    </div>
                  </button>

                  {/* Adsets da campanha expandida */}
                  {expanded && (
                    <div style={{ paddingLeft: 14, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {childAdsets.length === 0 ? (
                        <div style={{ fontSize: 'clamp(8px, .7vw, 11px)', color: '#64748b', padding: '4px 8px', fontStyle: 'italic' }}>Sem conjuntos com dados no período</div>
                      ) : childAdsets.slice(0, 5).map((a, ai) => (
                        <div key={a.id || ai} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'clamp(8px, .7vw, 11px)', padding: '4px 8px', background: 'rgba(255,255,255,.02)', borderRadius: 4 }}>
                          <span style={{ color: '#7dd3fc' }}>↳</span>
                          <span style={{ flex: 1, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={a.name}>{a.name}</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'clamp(9px, .75vw, 13px)' }}>
                  <span style={{ width: 'clamp(14px, 1.2vw, 20px)', height: 'clamp(14px, 1.2vw, 20px)', borderRadius: '50%', background: i === 0 ? '#fbbf24' : '#475569', color: '#0a2540', fontWeight: 800, fontSize: 'clamp(8px, .7vw, 11px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</span>
                    <span style={{ display: 'block', color: '#64748b', fontSize: 'clamp(7px, .6vw, 10px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.campaignName}>↳ {a.campaignName}</span>
                  </span>
                  <strong style={{ color: '#7dd3fc', fontSize: 'clamp(11px, .9vw, 15px)' }}>{a.results}</strong>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(a.results / max) * 100}%`, height: '100%', background: '#22d3ee' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 'clamp(8px, .7vw, 11px)', color: '#94a3b8' }}>
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
  const rows = [
    { lbl: resultLabel, val: (c: TopAd) => String(c.results), highlight: true },
    { lbl: cprLabel, val: (c: TopAd) => c.cpl > 0 ? fmtBrl(c.cpl) : '—', highlight: true },
    { lbl: 'CTR', val: (c: TopAd) => c.ctr.toFixed(2) + '%' },
    { lbl: 'Investido', val: (c: TopAd) => fmtBrl(c.spend) },
    { lbl: '% Investimento', val: (c: TopAd) => c.spendShare.toFixed(1) + '%' },
    { lbl: 'Impressões', val: (c: TopAd) => fmtN(c.impressions) },
    { lbl: 'Alcance', val: (c: TopAd) => c.reach > 0 ? fmtN(c.reach) : '—' },
    { lbl: 'Frequência', val: (c: TopAd) => c.frequency > 0 ? c.frequency.toFixed(2) : '—' },
    { lbl: 'CPM', val: (c: TopAd) => c.cpm > 0 ? fmtBrl(c.cpm) : '—' },
  ]
  // Grid compartilhado: 1ª coluna fixa pro rótulo (auto), demais colunas iguais — alinha rótulo/valor à thumb correspondente.
  const gridCols = `minmax(110px, max-content) repeat(${creatives.length}, minmax(0, 1fr))`
  const colGap = 'clamp(4px, .5vw, 10px)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px, .7vw, 12px)', minHeight: 0, flex: 1 }}>
      {/* Linha de Thumbnails — primeira coluna vazia, alinhada com rótulos */}
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, columnGap: colGap, flexShrink: 0, alignItems: 'stretch' }}>
        <div /> {/* placeholder pra coluna de rótulos */}
        {creatives.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onClick?.(c)}
            title={`Clique para ver preview: ${c.name}`}
            style={{ all: 'unset', aspectRatio: '1', background: '#0a2540', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.05)', cursor: onClick ? 'pointer' : 'default', transition: 'transform .12s, box-shadow .12s', position: 'relative', boxSizing: 'border-box' }}
            onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(34,211,238,.25)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,.5)' } }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'rgba(255,255,255,.05)' }}
          >
            {c.thumb ? <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18, opacity: .4 }}>📷</span>}
            {onClick && <span style={{ position: 'absolute', bottom: 3, right: 3, fontSize: 'clamp(7px, .55vw, 10px)', background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 5px', borderRadius: 4, fontWeight: 700 }}>👁 ver</span>}
          </button>
        ))}
      </div>
      {/* "Tabela" de métricas — mesma grade dos thumbs, garante alinhamento perfeito */}
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: gridCols, columnGap: colGap, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
            <div style={{ padding: 'clamp(4px, .5vw, 8px) 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, fontSize: 'clamp(8px, .65vw, 11px)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{row.lbl}</div>
            {creatives.map((c, ci) => (
              <div key={ci} style={{ padding: 'clamp(4px, .5vw, 8px) 8px', textAlign: 'right', fontWeight: 700, color: row.highlight ? '#7dd3fc' : '#fff', fontSize: row.highlight ? 'clamp(10px, .9vw, 14px)' : 'clamp(9px, .8vw, 13px)', borderLeft: ci === 0 ? '1px solid rgba(255,255,255,.06)' : '1px solid rgba(255,255,255,.04)', fontVariantNumeric: 'tabular-nums' }}>{row.val(c)}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
