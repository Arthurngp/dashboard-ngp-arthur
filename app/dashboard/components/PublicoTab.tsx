'use client'

import { useEffect, useRef, useState } from 'react'
import { metaCall } from '@/lib/meta'
import { ACTION_KEYS, GENDER_NAMES, sumActions } from '@/lib/meta-metrics'
import { DateParam } from '@/types'

// Primitives locais (mesma aparência dos do PresentMode; triviais, evita acoplar os arquivos).
function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 'clamp(10px, 1vw, 16px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
      <div style={{ fontSize: 'clamp(9px, .75vw, 13px)', fontWeight: 700, color: '#fff', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 'clamp(6px, .7vw, 10px)', flexShrink: 0 }}>{title}</div>
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

interface Props {
  metaAccount: string
  period: DateParam
  /** filtering JSON da Meta API quando há seleção de campanhas (ou undefined). */
  filteringParam?: string
  /** defaults Meta insights (ADR-002) já resolvidos pelo pai. */
  insightsDefaults: Record<string, string>
  /** tipo global atual (VENDAS, LEADS, ...). */
  tipo: string
  resultLabel: string
  cprLabel: string
}

// Linha genérica de segmento (idade, gênero ou posicionamento): volume + custo + receita.
type SegRow = { label: string; sub?: string; results: number; spend: number; revenue: number }
type MatrixCell = { results: number; spend: number; cpr: number }
type Matrix = {
  ages: string[]
  genders: string[]
  cells: Record<string, MatrixCell> // chave `${age}|${gender}`
  best?: string
  worst?: string
}
type Data = {
  matrix: Matrix
  byAge: SegRow[]
  byGender: SegRow[]
  byPlacement: SegRow[]
  hasRevenue: boolean
}

const AGE_ORDER: Record<string, number> = { '13-17': 1, '18-24': 2, '25-34': 3, '35-44': 4, '45-54': 5, '55-64': 6, '65+': 7 }
const GENDER_ORDER: Record<string, number> = { female: 1, male: 2, unknown: 3 }

const PLATFORM_NAMES: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network', messenger: 'Messenger', unknown: 'Outros' }
const POSITION_NAMES: Record<string, string> = {
  feed: 'Feed', story: 'Stories', reels: 'Reels', instagram_reels: 'Reels', instagram_stories: 'Stories',
  facebook_reels: 'Reels', instream_video: 'Vídeo in-stream', marketplace: 'Marketplace', search: 'Busca',
  right_hand_column: 'Coluna direita', explore: 'Explorar', video_feeds: 'Feed de vídeo', biz_inbox: 'Inbox',
}

// Gasto mínimo p/ uma linha/célula contar no destaque melhor/pior e no ROAS exibido.
// Evita anomalias (ex: "Unknown R$0,01 → ROAS 3958x") distorcerem a leitura.
const MIN_SPEND = 1

const fmtBrl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtN = (n: number) => n.toLocaleString('pt-BR')
const cprOf = (spend: number, results: number) => results > 0 ? spend / results : 0
const roasOf = (revenue: number, spend: number) => spend > 0 ? revenue / spend : 0

export default function PublicoTab({ metaAccount, period, filteringParam, insightsDefaults, tipo, resultLabel, cprLabel }: Props) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const keys = ACTION_KEYS[tipo] || ACTION_KEYS.LEADS
    const isReconhec = tipo === 'RECONHECIMENTO'

    // Monta params com defaults + filtering quando há seleção de campanhas.
    const buildParams = (breakdowns: string): Record<string, string> => {
      const base: Record<string, string> = {
        ...insightsDefaults, level: 'account', breakdowns,
        fields: 'actions,action_values,spend,impressions', limit: '200',
        ...(period as Record<string, string>),
      }
      return filteringParam ? { ...base, filtering: filteringParam } : base
    }
    const resultsOf = (row: any) => isReconhec ? (+row.impressions || 0) : sumActions(row.actions, keys)
    const revenueOf = (row: any) => sumActions(row.action_values, keys)

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [ageGender, byAgeRaw, byGenderRaw, placementRaw] = await Promise.all([
          metaCall('insights', buildParams('age,gender'), metaAccount).catch(() => null),
          metaCall('insights', buildParams('age'), metaAccount).catch(() => null),
          metaCall('insights', buildParams('gender'), metaAccount).catch(() => null),
          metaCall('insights', buildParams('publisher_platform,platform_position'), metaAccount).catch(() => null),
        ])
        if (cancelled) return

        // ── Matriz idade × gênero ──
        const cells: Record<string, MatrixCell> = {}
        const ageSet = new Set<string>(), genderSet = new Set<string>()
        let matrixHasRevenue = false
        for (const row of (Array.isArray(ageGender?.data) ? ageGender.data : [])) {
          const age = String(row.age || '—'), gender = String(row.gender || 'unknown')
          const spend = +row.spend || 0, results = resultsOf(row)
          if (revenueOf(row) > 0) matrixHasRevenue = true
          ageSet.add(age); genderSet.add(gender)
          cells[`${age}|${gender}`] = { results, spend, cpr: cprOf(spend, results) }
        }
        const ages = Array.from(ageSet).sort((a, b) => (AGE_ORDER[a] || 99) - (AGE_ORDER[b] || 99))
        const genders = Array.from(genderSet).sort((a, b) => (GENDER_ORDER[a] || 99) - (GENDER_ORDER[b] || 99))
        let best: string | undefined, worst: string | undefined, bestV = Infinity, worstV = -Infinity
        for (const [key, c] of Object.entries(cells)) {
          if (c.results <= 0 || c.cpr <= 0 || c.spend < MIN_SPEND) continue
          if (c.cpr < bestV) { bestV = c.cpr; best = key }
          if (c.cpr > worstV) { worstV = c.cpr; worst = key }
        }
        if (best && best === worst) worst = undefined

        // ── Tabela por dimensão simples (idade / gênero) ──
        const toSegRows = (resp: any, field: string, labelMap?: Record<string, string>, order?: Record<string, number>): SegRow[] => {
          type SegRowRaw = SegRow & { _raw: string }
          const rows: any[] = Array.isArray(resp?.data) ? resp.data : []
          const mapped: SegRowRaw[] = rows.map((row: any): SegRowRaw => {
            const raw = String(row[field] || 'unknown')
            return { label: labelMap?.[raw] || raw, sub: undefined, results: resultsOf(row), spend: +row.spend || 0, revenue: revenueOf(row), _raw: raw }
          })
          const out: SegRowRaw[] = mapped.filter((r) => r.results > 0 || r.spend > 0)
          if (order) out.sort((a, b) => (order[a._raw] || 99) - (order[b._raw] || 99))
          else out.sort((a, b) => b.spend - a.spend)
          return out.map(({ _raw, ...rest }) => rest)
        }
        const byAge = toSegRows(byAgeRaw, 'age', undefined, AGE_ORDER)
        const byGender = toSegRows(byGenderRaw, 'gender', GENDER_NAMES, GENDER_ORDER)

        // ── Posicionamento (plataforma + posição), top 8 por spend ──
        const placAll: SegRow[] = (Array.isArray(placementRaw?.data) ? placementRaw.data : [])
          .map((row: any): SegRow => {
            const plat = String(row.publisher_platform || 'unknown')
            const pos = String(row.platform_position || '')
            return {
              label: PLATFORM_NAMES[plat] || plat,
              sub: POSITION_NAMES[pos] || pos,
              results: resultsOf(row), spend: +row.spend || 0, revenue: revenueOf(row),
            }
          })
        const placRows: SegRow[] = placAll
          .filter((r) => r.spend > 0 || r.results > 0)
          .sort((a, b) => b.spend - a.spend)
          .slice(0, 8)

        const hasRevenue = matrixHasRevenue
          || byAge.some(r => r.revenue > 0) || byGender.some(r => r.revenue > 0) || placRows.some(r => r.revenue > 0)

        setData({ matrix: { ages, genders, cells, best, worst }, byAge, byGender, byPlacement: placRows, hasRevenue })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar público.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [metaAccount, period, filteringParam, insightsDefaults, tipo])

  if (loading && !data) return <div style={{ flex: 1, display: 'flex' }}><Loading /></div>
  if (error) return <div style={{ flex: 1, display: 'flex' }}><Empty msg={error} /></div>
  if (!data || data.matrix.ages.length === 0) return <div style={{ flex: 1, display: 'flex' }}><Empty msg="Sem dados de público no período" /></div>

  const { matrix, byAge, byGender, byPlacement, hasRevenue } = data

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.2vw, 18px)', minHeight: 0, overflow: 'auto' }}>
      {/* Matriz idade × gênero: tabela compacta (metade) + barras agrupadas (metade) */}
      <Card title={`Idade × Gênero — ${cprLabel}`} style={{ flex: '0 0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'clamp(10px, 1.4vw, 20px)', alignItems: 'start' }}>
          <Heatmap matrix={matrix} cprLabel={cprLabel} />
          <GroupedBars matrix={matrix} />
        </div>
      </Card>

      {/* Tabelas por idade e por gênero, lado a lado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'clamp(8px, 1.2vw, 18px)', flex: '0 0 auto' }}>
        <Card title={`Por idade`}>
          <SegTable rows={byAge} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} dimLabel="Faixa" />
          <AgeLineChart rows={byAge} cprLabel={cprLabel} hasRevenue={hasRevenue} resultLabel={resultLabel} />
        </Card>
        <Card title={`Por gênero`}>
          <SegTable rows={byGender} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} dimLabel="Gênero" />
          <GenderColumns rows={byGender} hasRevenue={hasRevenue} resultLabel={resultLabel} cprLabel={cprLabel} />
        </Card>
      </div>

      {/* Onde aparece: tabela (metade) + barras horizontais por posição (metade) */}
      <Card title="Onde aparece — plataforma e posicionamento" style={{ flex: '0 0 auto' }}>
        {byPlacement.length === 0
          ? <Empty msg="Sem dados de posicionamento no período" />
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'clamp(10px, 1.4vw, 20px)', alignItems: 'start' }}>
              <SegTable rows={byPlacement} resultLabel={resultLabel} cprLabel={cprLabel} hasRevenue={hasRevenue} dimLabel="Posição" showSub />
              <HBars
                rows={byPlacement.map(r => ({ label: `${r.label}${r.sub ? ' · ' + r.sub : ''}`, value: hasRevenue ? r.revenue : r.results }))}
                caption={hasRevenue ? 'Vendas por posição' : `${resultLabel} por posição`}
                money={hasRevenue}
              />
            </div>
          )}
      </Card>
    </div>
  )
}

function Heatmap({ matrix, cprLabel }: { matrix: Matrix; cprLabel: string }) {
  const { ages, genders, cells, best, worst } = matrix
  const cellBg = (key: string, c: MatrixCell) => {
    if (c.results <= 0) return 'rgba(255,255,255,.02)'
    if (key === best) return 'rgba(34,197,94,.18)'
    if (key === worst) return 'rgba(239,68,68,.16)'
    return 'rgba(255,255,255,.04)'
  }
  const cellBorder = (key: string) => {
    if (key === best) return '1px solid rgba(34,197,94,.5)'
    if (key === worst) return '1px solid rgba(239,68,68,.45)'
    return '1px solid rgba(255,255,255,.06)'
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 10, fontWeight: 700, padding: '2px 6px' }}>Idade</th>
            {genders.map(g => (
              <th key={g} style={{ color: '#7dd3fc', fontSize: 10, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '.04em' }}>{GENDER_NAMES[g] || g}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ages.map(age => (
            <tr key={age}>
              <td style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, padding: '2px 6px', whiteSpace: 'nowrap' }}>{age}</td>
              {genders.map(g => {
                const key = `${age}|${g}`
                const c = cells[key] || { results: 0, spend: 0, cpr: 0 }
                return (
                  <td key={g} style={{ background: cellBg(key, c), border: cellBorder(key), borderRadius: 7, padding: '4px 8px', minWidth: 84, textAlign: 'center' }}>
                    {c.results > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{c.cpr > 0 ? fmtBrl(c.cpr) : '—'}</span>
                        <span style={{ fontSize: 9, color: '#94a3b8' }}>{fmtN(c.results)}</span>
                      </div>
                    ) : <div style={{ fontSize: 11, color: '#475569' }}>—</div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {(best || worst) && (
        <div style={{ display: 'flex', gap: 14, marginTop: 7, fontSize: 10, color: '#94a3b8', flexWrap: 'wrap' }}>
          {best && <span><Dot c="rgba(34,197,94,.6)" />Menor {cprLabel.toLowerCase()}</span>}
          {worst && <span><Dot c="rgba(239,68,68,.6)" />Maior {cprLabel.toLowerCase()}</span>}
          <span style={{ color: '#64748b' }}>· valor = {cprLabel.toLowerCase()}, ao lado = nº de resultados</span>
        </div>
      )}
    </div>
  )
}

// Tabela rica de segmento: dimensão | resultados | vendas (com barra de proporção) | custo | ROAS.
// Vendas e ROAS só aparecem quando hasRevenue. Destaca melhor (verde) / pior (vermelho) custo.
// A barra embutida mostra a proporção de vendas (ou resultados, sem receita) vs o maior da coluna.
function SegTable({ rows, resultLabel, cprLabel, hasRevenue, dimLabel, showSub }: {
  rows: SegRow[]; resultLabel: string; cprLabel: string; hasRevenue: boolean; dimLabel: string; showSub?: boolean
}) {
  if (rows.length === 0) return <Empty msg="Sem dados no período" />
  // Só linhas com gasto relevante entram no destaque de melhor/pior custo.
  const cprs = rows.filter(r => r.spend >= MIN_SPEND).map(r => cprOf(r.spend, r.results)).filter(v => v > 0)
  const minCpr = cprs.length ? Math.min(...cprs) : 0
  const maxCpr = cprs.length ? Math.max(...cprs) : 0
  // Base da barra: vendas se há receita, senão volume de resultados.
  const barVal = (r: SegRow) => hasRevenue ? r.revenue : r.results
  const barMax = Math.max(...rows.map(barVal), 0) || 1

  const th: React.CSSProperties = { color: '#94a3b8', fontSize: 10, fontWeight: 700, padding: '4px 6px', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { fontSize: 12, padding: '5px 6px', textAlign: 'right', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }
  const valCol = hasRevenue ? 'Vendas' : resultLabel

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Sora, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <th style={{ ...th, textAlign: 'left' }}>{dimLabel}</th>
            {hasRevenue && <th style={th}>{resultLabel}</th>}
            <th style={{ ...th, textAlign: 'left', width: '38%' }}>{valCol}</th>
            <th style={th}>{cprLabel}</th>
            {hasRevenue && <th style={th}>ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const relevant = r.spend >= MIN_SPEND
            const cpr = cprOf(r.spend, r.results)
            const roas = roasOf(r.revenue, r.spend)
            const cprColor = relevant && cpr > 0 && cprs.length > 1
              ? (cpr === minCpr ? '#34d399' : cpr === maxCpr ? '#f87171' : '#e2e8f0')
              : '#e2e8f0'
            const pct = Math.round((barVal(r) / barMax) * 100)
            const valTxt = hasRevenue ? (r.revenue > 0 ? fmtBrl(r.revenue) : '—') : (r.results > 0 ? fmtN(r.results) : '—')
            return (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {r.label}{showSub && r.sub ? <span style={{ color: '#7dd3fc', fontWeight: 600 }}> · {r.sub}</span> : ''}
                </td>
                {hasRevenue && <td style={td}>{r.results > 0 ? fmtN(r.results) : '—'}</td>}
                {/* coluna valor com barra de proporção embutida */}
                <td style={{ ...td, textAlign: 'left' }}>
                  <div style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'rgba(125,211,252,.18)', borderRadius: 4 }} />
                    <span style={{ position: 'relative', zIndex: 1, paddingLeft: 4, fontWeight: 600 }}>{valTxt}</span>
                  </div>
                </td>
                <td style={{ ...td, color: cprColor, fontWeight: 700 }}>{cpr > 0 ? fmtBrl(cpr) : '—'}</td>
                {hasRevenue && <td style={{ ...td, fontWeight: 700 }}>{roas > 0 && relevant ? `${roas.toFixed(2)}x` : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Dot({ c }: { c: string }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: 2, marginRight: 5, verticalAlign: 'middle' }} />
}

// Barras VERTICAIS agrupadas por idade: eixo X = faixas; dentro de cada faixa,
// uma barra por gênero (volume de resultados). Comunica comparação de grupos.
const GENDER_COLOR: Record<string, string> = { female: '#f0abfc', male: '#7dd3fc', unknown: '#94a3b8' }
function GroupedBars({ matrix }: { matrix: Matrix }) {
  const { ages, genders, cells } = matrix
  const agesWithData = ages.filter(age => genders.some(g => (cells[`${age}|${g}`]?.results || 0) > 0))
  const max = Math.max(...agesWithData.flatMap(age => genders.map(g => cells[`${age}|${g}`]?.results || 0)), 0) || 1
  if (agesWithData.length === 0) return <Empty msg="Sem volume por faixa" />
  const H = 200 // altura útil das barras — ocupa melhor o bloco
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'Sora, sans-serif' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>Resultados por faixa × gênero</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 'clamp(6px, 1.5vw, 24px)', height: H + 22 }}>
        {agesWithData.map(age => (
          <div key={age} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 5, height: H, width: '100%' }}>
              {genders.map(g => {
                const v = cells[`${age}|${g}`]?.results || 0
                const barH = v > 0 ? Math.max(4, (v / max) * H) : 0
                if (v <= 0) return null
                return (
                  <div key={g} title={`${age} · ${GENDER_NAMES[g] || g}: ${fmtN(v)} resultados`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    <span style={{ fontSize: 9, color: '#cbd5e1', fontWeight: 700, marginBottom: 2 }}>{fmtN(v)}</span>
                    <div style={{ width: 'clamp(14px, 1.6vw, 26px)', height: barH, background: GENDER_COLOR[g] || '#94a3b8', borderRadius: '4px 4px 0 0' }} />
                  </div>
                )
              })}
            </div>
            <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 700, whiteSpace: 'nowrap' }}>{age}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {genders.map(g => (
          <span key={g} style={{ fontSize: 10, color: '#94a3b8' }}><Dot c={GENDER_COLOR[g] || '#94a3b8'} />{GENDER_NAMES[g] || g}</span>
        ))}
      </div>
    </div>
  )
}

// Gráfico de linha pelas faixas etárias (idade é ordenada → tendência faz sentido).
// Duas séries em escalas próprias: custo por resultado (amarelo) e vendas ou
// volume de resultados (ciano). Conecta só faixas com gasto relevante.
function AgeLineChart({ rows, cprLabel, hasRevenue, resultLabel }: {
  rows: SegRow[]; cprLabel: string; hasRevenue: boolean; resultLabel: string
}) {
  const pts = rows.filter(r => r.spend >= MIN_SPEND && r.results > 0)
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  if (pts.length < 2) return null

  // viewBox SEM preserveAspectRatio="none" (evita distorção de fonte). Padding
  // lateral generoso pra rótulos das pontas (18-24 / 55-64) não cortarem.
  const w = 460, h = 150, pad = { l: 34, r: 34, t: 16, b: 26 }
  const valLabel = hasRevenue ? 'Vendas' : resultLabel
  const cprs = pts.map(p => cprOf(p.spend, p.results))
  const vals = pts.map(p => hasRevenue ? p.revenue : p.results)
  const cprMax = Math.max(...cprs) || 1
  const valMax = Math.max(...vals) || 1
  const stepX = pts.length > 1 ? (w - pad.l - pad.r) / (pts.length - 1) : 0
  const x = (i: number) => pad.l + i * stepX
  const yCpr = (v: number) => h - pad.b - (h - pad.t - pad.b) * (v / cprMax)
  const yVal = (v: number) => h - pad.b - (h - pad.t - pad.b) * (v / valMax)
  const valAt = (p: SegRow) => yVal(hasRevenue ? p.revenue : p.results)
  const cprAt = (p: SegRow) => yCpr(cprOf(p.spend, p.results))

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const xInView = ((e.clientX - rect.left) / rect.width) * w
    let nearest = 0, best = Infinity
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(x(i) - xInView)
      if (d < best) { best = d; nearest = i }
    }
    setHover(nearest)
  }

  return (
    <div style={{ marginTop: 10, position: 'relative' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Tendência por faixa etária</div>
      <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 150, display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* linha vertical do hover */}
        {hover !== null && <line x1={x(hover)} y1={pad.t} x2={x(hover)} y2={h - pad.b} stroke="rgba(255,255,255,.2)" strokeWidth={1} />}
        {/* vendas/resultados (ciano) */}
        <polyline points={pts.map((p, i) => `${x(i)},${valAt(p)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={2.5} />
        {pts.map((p, i) => <circle key={`v${i}`} cx={x(i)} cy={valAt(p)} r={hover === i ? 5 : 3} fill="#22d3ee" stroke={hover === i ? '#fff' : 'none'} strokeWidth={1.5} />)}
        {/* custo por resultado (amarelo) */}
        <polyline points={pts.map((p, i) => `${x(i)},${cprAt(p)}`).join(' ')} fill="none" stroke="#fbbf24" strokeWidth={2.5} />
        {pts.map((p, i) => <circle key={`c${i}`} cx={x(i)} cy={cprAt(p)} r={hover === i ? 5 : 3} fill="#fbbf24" stroke={hover === i ? '#fff' : 'none'} strokeWidth={1.5} />)}
        {/* rótulos faixa */}
        {pts.map((p, i) => <text key={`l${i}`} x={x(i)} y={h - 8} textAnchor="middle" fontSize={11} fill="#94a3b8" fontFamily="Sora">{p.label}</text>)}
      </svg>
      {/* tooltip — preso dentro do gráfico (não vaza nas pontas) */}
      {hover !== null && (() => {
        const p = pts[hover]
        const leftPct = (x(hover) / w) * 100
        // Ancora à esquerda nas pontas iniciais, à direita nas finais, centralizado no meio.
        const anchorLeft = leftPct < 28
        const anchorRight = leftPct > 72
        const transform = anchorLeft ? 'translateX(0)' : anchorRight ? 'translateX(-100%)' : 'translateX(-50%)'
        const left = anchorLeft ? '2%' : anchorRight ? '98%' : `${leftPct}%`
        return (
          <div style={{
            position: 'absolute', left, top: 22, transform,
            background: '#0f2942', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '6px 10px',
            fontSize: 11, color: '#e2e8f0', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5, boxShadow: '0 6px 18px rgba(0,0,0,.4)',
          }}>
            <div style={{ fontWeight: 700, color: '#7dd3fc', marginBottom: 3 }}>{p.label}</div>
            <div><Dot c="#22d3ee" />{valLabel}: <strong>{hasRevenue ? fmtBrl(p.revenue) : fmtN(p.results)}</strong></div>
            <div><Dot c="#fbbf24" />{cprLabel}: <strong>{fmtBrl(cprOf(p.spend, p.results))}</strong></div>
          </div>
        )
      })()}
      <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#94a3b8' }}><Dot c="#22d3ee" />{valLabel}</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}><Dot c="#fbbf24" />{cprLabel}</span>
      </div>
    </div>
  )
}

// Barras horizontais ranqueadas (ex: vendas por posicionamento).
function HBars({ rows, caption, money }: { rows: { label: string; value: number }[]; caption: string; money?: boolean }) {
  const data = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value)
  const max = Math.max(...data.map(r => r.value), 0) || 1
  if (data.length === 0) return <Empty msg="Sem dados" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontFamily: 'Sora, sans-serif' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{caption}</div>
      {data.map((r, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
            <span style={{ color: '#cbd5e1', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>{r.label}</span>
            <span style={{ color: '#e2e8f0', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money ? fmtBrl(r.value) : fmtN(r.value)}</span>
          </div>
          <div style={{ height: 8, width: `${Math.max(2, (r.value / max) * 100)}%`, background: 'linear-gradient(90deg, #2563eb, #7dd3fc)', borderRadius: 3 }} />
        </div>
      ))}
    </div>
  )
}

// Colunas verticais por gênero (largura toda, abaixo da tabela). Cada coluna mostra
// vendas/resultados; hover (title nativo) revela o valor + custo. Comparação direta.
const GENDER_BAR_COLOR: Record<string, string> = { Feminino: '#f0abfc', Masculino: '#7dd3fc', 'Não informado': '#94a3b8' }
function GenderColumns({ rows, hasRevenue, resultLabel, cprLabel }: {
  rows: SegRow[]; hasRevenue: boolean; resultLabel: string; cprLabel: string
}) {
  const data = rows.filter(r => (hasRevenue ? r.revenue : r.results) > 0)
  if (data.length === 0) return null
  const max = Math.max(...data.map(r => hasRevenue ? r.revenue : r.results), 0) || 1
  const total = data.reduce((s, r) => s + (hasRevenue ? r.revenue : r.results), 0) || 1
  const H = 130          // altura máxima da barra
  const LABEL_TOP = 22   // espaço reservado p/ o valor acima da barra (evita estourar no título)
  const valLabel = hasRevenue ? 'Vendas' : resultLabel
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>{valLabel} por gênero</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 'clamp(12px, 3vw, 48px)', padding: '0 8px' }}>
        {data.map((r, i) => {
          const v = hasRevenue ? r.revenue : r.results
          const barH = Math.max(6, (v / max) * H)
          const pct = Math.round((v / total) * 100)
          const cpr = cprOf(r.spend, r.results)
          return (
            <div key={i} title={`${r.label}: ${hasRevenue ? fmtBrl(r.revenue) : fmtN(r.results)} · ${cprLabel} ${fmtBrl(cpr)}`}
              style={{ flex: 1, maxWidth: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              {/* zona da barra com altura fixa (H + espaço do label) → barra alinha embaixo, valor nunca estoura pra cima */}
              <div style={{ height: H + LABEL_TOP, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{hasRevenue ? fmtBrl(r.revenue) : fmtN(r.results)}</span>
                <div style={{ width: '100%', maxWidth: 70, height: barH, background: GENDER_BAR_COLOR[r.label] || '#7dd3fc', borderRadius: '6px 6px 0 0' }} />
              </div>
              <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700 }}>{r.label}</span>
              <span style={{ fontSize: 9, color: '#94a3b8' }}>{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
