'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { metaCall } from '@/lib/meta'
import { efCall } from '@/lib/api'
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
  clienteName?: string
  clienteId?: string
  clienteUsername?: string
  periodLabel?: string
}

// Prompt template "Análise de Criativos (Meta Ads)" cadastrado no Supabase.
const CRIATIVOS_PROMPT_ID = 'fb871644-30dc-4eb8-a1ea-28cb9914c33b'

interface AiAnalysis {
  headline?: string
  diagnosis?: string
  wins?: string[]
  risks?: string[]
  opportunities?: string[]
  nextActions?: { title: string; detail: string; priority: 'high' | 'medium' | 'low' }[]
}

interface AdRow {
  id: string
  name: string
  thumb: string
  objective: string // objetivo legível (VENDAS, MENSAGENS, ...) ou 'Outros'
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

// Mapeia o objective bruto da Meta para o rótulo legível (mesma lógica do PresentMode).
function objectiveToTipo(raw: string): string {
  const o = (raw || '').toUpperCase()
  if (!o) return 'Outros'
  if (o.includes('SALES') || o.includes('CONVERSION') || o.includes('PRODUCT') || o.includes('CATALOG')) return 'Vendas'
  if (o.includes('LEAD')) return 'Leads'
  if (o.includes('MESSAG')) return 'Mensagens'
  if (o.includes('TRAFFIC') || o.includes('LINK_CLICK')) return 'Tráfego'
  if (o.includes('ENGAGE') || o.includes('POST')) return 'Engajamento'
  if (o.includes('AWARENESS') || o.includes('REACH') || o.includes('VIDEO')) return 'Reconhecimento'
  return 'Outros'
}

const MAX_CARDS = 20 // top N por gasto que recebem thumbnail e viram cards
const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtN = (n: number) => n.toLocaleString('pt-BR')
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

const median = (arr: number[]) => {
  const v = arr.filter(n => n > 0).sort((a, b) => a - b)
  if (!v.length) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

type Verdict = 'escalar' | 'pausar' | 'observar'
const VERDICT_STYLE: Record<Verdict, { label: string; bg: string; color: string }> = {
  escalar: { label: '↑ Escalar', bg: 'rgba(34,197,94,.18)', color: '#34d399' },
  pausar: { label: '↓ Pausar', bg: 'rgba(239,68,68,.16)', color: '#f87171' },
  observar: { label: '• Observar', bg: 'rgba(148,163,184,.15)', color: '#cbd5e1' },
}

// Classifica um criativo (regra transparente, sem IA). Usa medianas do conjunto e
// limiar de gasto RELATIVO ao total (escala entre contas grandes e pequenas).
// - escalar: CPA <= mediana E frequência < 2.5 (eficiente e não saturado)
// - pausar: gasto >= 3% do total E (0 resultados OU CPA >= 2x mediana) OU frequência > 4
// - observar: o resto
function classify(a: AdRow, medCpa: number, totalSpend: number): Verdict {
  const spendShare = totalSpend > 0 ? a.spend / totalSpend : 0
  const saturated = a.frequency > 4
  const noReturn = spendShare >= 0.03 && a.results === 0
  const tooExpensive = medCpa > 0 && a.cpa > 0 && a.cpa >= medCpa * 2 && spendShare >= 0.03
  if (noReturn || tooExpensive || saturated) return 'pausar'
  const efficient = medCpa > 0 && a.cpa > 0 && a.cpa <= medCpa
  if (efficient && a.frequency < 2.5 && a.results > 0) return 'escalar'
  return 'observar'
}

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

export default function AnunciosTab({ metaAccount, period, filteringParam, insightsDefaults, tipo, resultLabel, cprLabel, clienteName, clienteId, clienteUsername, periodLabel }: Props) {
  const [ads, setAds] = useState<AdRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('results')
  const [selected, setSelected] = useState<string[]>([])
  const [objectiveFilter, setObjectiveFilter] = useState<string | null>(null) // filtra o carrossel por objetivo
  const [compareOpen, setCompareOpen] = useState(false) // abre o modal de comparação
  const hasRevenue = useMemo(() => !!ads?.some(a => a.roas > 0), [ads])
  // Análise IA (sob demanda).
  const [ai, setAi] = useState<AiAnalysis | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => {
    let cancelled = false
    const keys = ACTION_KEYS[tipo] || ACTION_KEYS.LEADS
    const load = async () => {
      setLoading(true); setError('')
      try {
        const params: Record<string, string> = {
          ...insightsDefaults, level: 'ad', limit: '200',
          fields: 'ad_id,ad_name,objective,spend,ctr,actions,impressions,frequency,cpm,reach,inline_link_clicks,video_play_actions,video_thruplay_watched_actions,purchase_roas',
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
            id: ad.ad_id || '', name: ad.ad_name || '—', thumb: '', objective: objectiveToTipo(ad.objective), spend,
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

  // Invalida a análise IA quando muda o contexto. ANTES de qualquer early return
  // (Regra dos Hooks: nunca chamar hook depois de return condicional).
  useEffect(() => { setAi(null); setAiError('') }, [metaAccount, period, tipo, filteringParam])

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

  // Veredito por criativo (regra): mediana de CPA e gasto total do conjunto.
  const medCpa = median(ads.map(a => a.cpa))
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0)
  const verdictOf = (a: AdRow) => classify(a, medCpa, totalSpend)

  // Carrossel filtrado pelo objetivo selecionado na tabela (ou todos).
  const carouselAds = objectiveFilter ? sorted.filter(a => a.objective === objectiveFilter) : sorted

  async function gerarAnalise() {
    if (!ads || ads.length === 0) return
    setAiLoading(true); setAiError('')
    try {
      // Top 12 por gasto, payload enxuto (números + selo + objetivo). Limite evita
      // estourar o max_output_tokens da edge function e truncar o JSON da resposta.
      const criativos = [...ads].sort((a, b) => b.spend - a.spend).slice(0, 12).map(a => ({
        nome: a.name, objetivo: a.objective, veredito: verdictOf(a),
        gasto: Math.round(a.spend), resultados: a.results, custo_result: Math.round(a.cpa),
        roas: +a.roas.toFixed(1), ctr_pct: +a.ctr.toFixed(1), cpm: Math.round(a.cpm), freq: +a.frequency.toFixed(1),
      }))
      const data = await efCall('ai-generate-analysis', {
        action: 'generate',
        prompt_id: CRIATIVOS_PROMPT_ID,
        cliente_id: clienteId || undefined,
        cliente_username: clienteUsername || undefined,
        cliente_nome: clienteName || undefined,
        meta_account_id: metaAccount || undefined,
        period_label: periodLabel || undefined,
        metrics: { resultLabel, cprLabel, total_criativos: ads.length, criativos },
        extra_context: `Análise de criativos do Meta Ads. Métrica principal: ${resultLabel}. Custo: ${cprLabel}.`,
      })
      if (data.error) { setAiError(String(data.error)); return }
      const json = (data.analysis_json || data.analysis || null) as AiAnalysis | string | null
      setAi(typeof json === 'object' && json ? json : { diagnosis: String(data.analysis || '') })
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Não foi possível gerar a análise.')
    } finally {
      setAiLoading(false)
    }
  }
  const selectedAds = sorted.filter(a => selected.includes(a.id))
  const videoAds = sorted.filter(a => a.video3s > 0)

  // Agrupa por objetivo da campanha (comparação justa: vendas com vendas, etc).
  const byObjective = (() => {
    const map = new Map<string, AdRow[]>()
    for (const a of sorted) {
      const arr = map.get(a.objective) || []
      arr.push(a)
      map.set(a.objective, arr)
    }
    return Array.from(map.entries()).map(([objective, list]) => {
      const spend = list.reduce((s, x) => s + x.spend, 0)
      const results = list.reduce((s, x) => s + x.results, 0)
      const revenue = list.reduce((s, x) => s + (x.roas * x.spend), 0)
      // melhor criativo do grupo = mais resultados (desempate: menor custo)
      const best = [...list].sort((x, y) => y.results - x.results || (x.cpa || 1e9) - (y.cpa || 1e9))[0]
      return { objective, count: list.length, spend, results, cpr: results > 0 ? spend / results : 0, roas: spend > 0 ? revenue / spend : 0, best }
    }).sort((a, b) => b.spend - a.spend)
  })()

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
      {/* Botão flutuante de comparação — aparece quando há criativos marcados. */}
      {selectedAds.length > 0 && !compareOpen && (
        <button onClick={() => setCompareOpen(true)}
          style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1100,
            background: '#7dd3fc', color: '#0a2540', border: 'none', borderRadius: 99, padding: '12px 24px',
            fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
          Comparar {selectedAds.length} criativo{selectedAds.length > 1 ? 's' : ''}
        </button>
      )}

      {/* Modal de comparação: thumbnails + métricas, com seletor pra adicionar/remover sem fechar. */}
      {compareOpen && selectedAds.length > 0 && (
        <div onClick={() => setCompareOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(5,18,33,.78)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0a2540', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 20, maxWidth: 960, width: '100%', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '.04em' }}>Comparação ({selectedAds.length}/3)</div>
              <button onClick={() => setSelected([])} style={{ ...btnGhost, marginRight: 8 }}>Limpar</button>
              <button onClick={() => setCompareOpen(false)} style={btnGhost}>✕ Fechar</button>
            </div>
            <CompareGrid ads={selectedAds} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} />
            {/* Seletor: adiciona/remove criativos sem sair do modal */}
            <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 12 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Adicionar / remover (até 3)</div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                {carouselAds.map(a => {
                  const on = selected.includes(a.id)
                  const disabled = !on && selected.length >= 3
                  return (
                    <button key={a.id} onClick={() => !disabled && toggleSelect(a.id)} disabled={disabled}
                      title={a.name}
                      style={{ flex: '0 0 auto', width: 64, padding: 0, border: `2px solid ${on ? '#7dd3fc' : 'rgba(255,255,255,.12)'}`, borderRadius: 8, overflow: 'hidden', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, background: '#0f2942' }}>
                      <div style={{ width: '100%', aspectRatio: '1', position: 'relative' }}>
                        {a.thumb ? <img src={a.thumb} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 8 }}>—</div>}
                        {on && <div style={{ position: 'absolute', inset: 0, background: 'rgba(125,211,252,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16 }}>✓</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Carrossel de criativos campeões. flexShrink:0 + overflow visível impedem o
          card de colapsar (senão os blocos abaixo sobrepõem os cards). */}
      <Card
        title={objectiveFilter ? `Criativos — ${objectiveFilter} (${carouselAds.length})` : `Criativos — top ${ads.length} por relevância`}
        headerRight={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Chips de objetivo: filtram o carrossel. 'Todos' limpa. */}
            {byObjective.length > 1 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {chip('Todos', objectiveFilter === null, () => setObjectiveFilter(null))}
                {byObjective.map(g => chip(`${g.objective} (${g.count})`, objectiveFilter === g.objective, () => setObjectiveFilter(g.objective)))}
              </div>
            )}
            {sortButtons}
          </div>
        }
        style={{ flexShrink: 0, overflow: 'visible' }}
      >
        <CreativeCarousel
          ads={carouselAds} sortKey={sortKey} selected={selected} onSelect={toggleSelect}
          resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} verdictOf={verdictOf}
        />
      </Card>

      {/* Módulos de análise abaixo do carrossel — grid 2 colunas */}
      {/* Cards de mesma altura (340px); conteúdo rola por dentro quando passa. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'clamp(8px, 1.2vw, 18px)', alignItems: 'stretch', flexShrink: 0 }}>
        <Card title="Por objetivo da campanha" style={{ height: 340 }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {byObjective.length === 0
              ? <Empty msg="Sem objetivo identificado" />
              : <ObjectiveTable groups={byObjective} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} />}
          </div>
        </Card>
        {videoAds.length > 0 && (
          <Card title="Métricas de vídeo — retenção" style={{ height: 340 }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <VideoTable ads={videoAds} />
            </div>
          </Card>
        )}
      </div>

      {/* Análise da IA — sob demanda. Interpreta os criativos + selos por regra.
          flexShrink:0 + minHeight impedem o card de colapsar no flex da aba (igual carrossel). */}
      <Card
        title="🤖 Análise da IA — recomendações"
        style={{ flexShrink: 0, minHeight: 120, marginBottom: 8 }}
        headerRight={
          <button onClick={gerarAnalise} disabled={aiLoading} style={{ ...btnGhost, background: aiLoading ? 'rgba(255,255,255,.06)' : '#7dd3fc', color: aiLoading ? '#94a3b8' : '#0a2540', borderColor: '#7dd3fc', cursor: aiLoading ? 'wait' : 'pointer' }}>
            {aiLoading ? 'Gerando…' : ai ? 'Gerar de novo' : 'Gerar análise'}
          </button>
        }
      >
        {aiError ? <Empty msg={aiError} />
          : aiLoading && !ai ? <Empty msg="A IA está analisando os criativos…" />
          : !ai ? <Empty msg="Clique em 'Gerar análise' para a IA recomendar o que escalar, pausar, melhorar e replicar." />
          : <AiPanel ai={ai} />}
      </Card>
    </div>
  )
}

// Renderiza a análise estruturada da IA (headline + diagnóstico + ações priorizadas).
const PRIO_STYLE: Record<string, { label: string; color: string }> = {
  high: { label: 'Alta', color: '#f87171' },
  medium: { label: 'Média', color: '#fbbf24' },
  low: { label: 'Baixa', color: '#94a3b8' },
}
function AiPanel({ ai }: { ai: AiAnalysis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'Sora, sans-serif' }}>
      {ai.headline && <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{ai.headline}</div>}
      {ai.diagnosis && <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ai.diagnosis}</div>}
      {!!ai.nextActions?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>Ações recomendadas</div>
          {ai.nextActions.map((act, i) => {
            const p = PRIO_STYLE[act.priority] || PRIO_STYLE.medium
            return (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(255,255,255,.03)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: p.color, border: `1px solid ${p.color}`, borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap', marginTop: 1 }}>{p.label}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{act.title}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{act.detail}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {(!!ai.wins?.length || !!ai.opportunities?.length || !!ai.risks?.length) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {!!ai.wins?.length && <AiList title="Destaques" color="#34d399" items={ai.wins} />}
          {!!ai.opportunities?.length && <AiList title="Oportunidades" color="#7dd3fc" items={ai.opportunities} />}
          {!!ai.risks?.length && <AiList title="Riscos" color="#f87171" items={ai.risks} />}
        </div>
      )}
    </div>
  )
}
function AiList({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((it, i) => <li key={i} style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.4 }}>{it}</li>)}
      </ul>
    </div>
  )
}

// Resumo por objetivo: nº de criativos, gasto, resultado, custo médio, ROAS, melhor criativo.
function ObjectiveTable({ groups, resultLabel, cprLabel, hasRevenue }: {
  groups: { objective: string; count: number; spend: number; results: number; cpr: number; roas: number; best: AdRow }[]
  resultLabel: string; cprLabel: string; hasRevenue: boolean
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <th style={{ ...th, textAlign: 'left' }}>Objetivo</th>
            <th style={th}>Criativos</th>
            <th style={th}>Gasto</th>
            <th style={th}>{resultLabel}</th>
            <th style={th}>{cprLabel}</th>
            {hasRevenue && <th style={th}>ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.objective} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>
                {g.objective}
                <div style={{ fontSize: 9, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }} title={g.best?.name}>★ {g.best?.name}</div>
              </td>
              <td style={td}>{g.count}</td>
              <td style={td}>{fmtBrl(g.spend)}</td>
              <td style={td}>{g.results > 0 ? fmtN(g.results) : '—'}</td>
              <td style={td}>{g.cpr > 0 ? fmtBrl(g.cpr) : '—'}</td>
              {hasRevenue && <td style={{ ...td, fontWeight: 700 }}>{g.roas > 0 ? `${g.roas.toFixed(2)}x` : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>★ = melhor criativo do objetivo (mais resultados). Filtre o carrossel pelos chips acima.</div>
    </div>
  )
}

const btnGhost: React.CSSProperties = { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#cbd5e1', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }

// Chip de filtro (objetivo). Verde-claro quando ativo.
function chip(label: string, active: boolean, onClick: () => void) {
  return (
    <button key={label} onClick={onClick}
      style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
        background: active ? '#34d399' : 'rgba(255,255,255,.06)', border: `1px solid ${active ? '#34d399' : 'rgba(255,255,255,.14)'}`,
        color: active ? '#0a2540' : '#cbd5e1', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  )
}

// Carrossel horizontal de cards de criativo (thumbnail + métricas).
function CreativeCarousel({ ads, sortKey, selected, onSelect, resultLabel, cprLabel, hasRevenue, verdictOf }: {
  ads: AdRow[]; sortKey: SortKey; selected: string[]; onSelect: (id: string) => void
  resultLabel: string; cprLabel: string; hasRevenue: boolean; verdictOf: (a: AdRow) => Verdict
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
      {/* minHeight fixa a altura do carrossel — sem isso o flex colapsava e os blocos
          seguintes (vídeo) sobrepunham os cards. */}
      <div ref={scroller} style={{ display: 'flex', gap: 12, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 8, minHeight: 380, scrollbarWidth: 'thin' }}>
        {ads.map((a, rank) => {
          const on = selected.includes(a.id)
          const h = highlight(a)
          const disabled = !on && selected.length >= 3
          return (
            // Card inteiro clicável: clica pra marcar/desmarcar (padrão "comparar" de marketplace).
            <div key={a.id} onClick={() => !disabled && onSelect(a.id)} title={disabled ? 'Máximo de 3 para comparar' : on ? 'Clique para remover da comparação' : 'Clique para comparar'}
              style={{
                flex: '0 0 auto', width: 200, alignSelf: 'flex-start', background: on ? 'rgba(125,211,252,.10)' : 'rgba(255,255,255,.03)', borderRadius: 12,
                border: `2px solid ${on ? '#7dd3fc' : 'rgba(255,255,255,.08)'}`, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition: 'border-color .15s, background .15s',
              }}>
              {/* thumbnail */}
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1', background: '#0f2942' }}>
                {a.thumb
                  ? <img src={a.thumb} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 11 }}>sem prévia</div>}
                <div style={{ position: 'absolute', top: 6, left: 6, background: rank === 0 ? '#fbbf24' : 'rgba(10,37,64,.85)', color: rank === 0 ? '#0a2540' : '#cbd5e1', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99 }}>#{rank + 1}</div>
                {on && <div style={{ position: 'absolute', top: 6, right: 6, background: '#7dd3fc', color: '#0a2540', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>✓ comparar</div>}
                {/* selo de veredito (regra) */}
                {(() => { const v = verdictOf(a); const st = VERDICT_STYLE[v]; return (
                  <div style={{ position: 'absolute', bottom: 6, left: 6, background: st.bg, color: st.color, fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99, backdropFilter: 'blur(4px)' }}>{st.label}</div>
                ) })()}
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
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Clique num criativo para marcá-lo (até 3) e ver a comparação no topo. Botões acima reordenam.</div>
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
            {ads.map(a => (
              <th key={a.id} style={{ ...th, cursor: 'default', textAlign: 'center', padding: '4px 8px', verticalAlign: 'bottom' }} title={a.name}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', background: '#0f2942', flexShrink: 0 }}>
                    {a.thumb ? <img src={a.thumb} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 9 }}>sem prévia</div>}
                  </div>
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'none', fontWeight: 700, color: '#e2e8f0' }}>{a.name}</span>
                </div>
              </th>
            ))}
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
