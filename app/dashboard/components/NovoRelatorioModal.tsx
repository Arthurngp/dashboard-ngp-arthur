'use client'

import { useMemo, useState, useEffect } from 'react'
import type { Campaign } from '@/types'

interface NovoRelatorioModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (config: NovoRelatorioConfig) => void
  clienteName: string
  campaigns?: Campaign[]
  hasGoogleAds?: boolean
}

export type RelatorioPlatform = 'meta' | 'google' | 'both'

export interface NovoRelatorioConfig {
  period: string
  metrics: string[]
  importCriativos: boolean
  objective: string
  audience: string
  topN: number
  platform: RelatorioPlatform
}

const PERIODS = [
  { label: 'Hoje',       value: 'today' },
  { label: 'Ontem',      value: 'yesterday' },
  { label: '7 dias',     value: 'last_7d' },
  { label: '14 dias',    value: 'last_14d' },
  { label: '30 dias',    value: 'last_30d' },
  { label: 'Este mês',   value: 'this_month' },
  { label: 'Mês ant.',   value: 'last_month' },
  { label: 'Este trim.', value: 'this_quarter' },
  { label: 'Trim. ant.', value: 'last_quarter' },
  { label: 'Este ano',   value: 'this_year' },
  { label: 'Ano ant.',   value: 'last_year' },
]

// Cada métrica indica em quais plataformas existe. UI filtra com base na
// plataforma escolhida: 'both' mostra todas (mas marca tag Meta-only),
// 'meta' mostra todas, 'google' mostra só as compatíveis com Google Ads.
type MetricPlat = 'meta' | 'google' | 'both'
const METRICS: { key: string; label: string; plat: MetricPlat }[] = [
  { key: 'spend',       label: 'Investimento',         plat: 'both' },
  { key: 'results',     label: 'Leads / Resultados',   plat: 'both' },
  { key: 'cpl',         label: 'CPL / CPA',            plat: 'both' },
  { key: 'reach',       label: 'Alcance',              plat: 'meta' },
  { key: 'impressions', label: 'Impressões',           plat: 'both' },
  { key: 'clicks',      label: 'Cliques',              plat: 'both' },
  { key: 'ctr',         label: 'CTR',                  plat: 'both' },
  { key: 'frequency',   label: 'Frequência',           plat: 'meta' },
  { key: 'cpm',         label: 'CPM',                  plat: 'both' },
]

// Inclui objetivos legados (CONVERSIONS, LEAD_GENERATION, etc) para casar
// com campanhas antigas — ver AD_OBJECTIVES no relatorio-static.html
const OBJECTIVES = [
  { label: 'Vendas',      value: 'OUTCOME_SALES,CONVERSIONS,PRODUCT_CATALOG_SALES' },
  { label: 'Leads',       value: 'OUTCOME_LEADS,LEAD_GENERATION' },
  { label: 'Mensagens',   value: 'OUTCOME_ENGAGEMENT,MESSAGES,OUTCOME_LEADS,LEAD_GENERATION' },
  { label: 'Tráfego',     value: 'OUTCOME_TRAFFIC,LINK_CLICKS' },
  { label: 'Engajamento', value: 'OUTCOME_ENGAGEMENT,POST_ENGAGEMENT,PAGE_LIKES,EVENT_RESPONSES' },
  { label: 'Reconhec.',   value: 'OUTCOME_AWARENESS,BRAND_AWARENESS,REACH,VIDEO_VIEWS' },
  { label: 'Todos',       value: '' },
]

// Mapeia o objective de uma campanha (vem da Meta) para qual categoria do
// nosso wizard ela pertence. Cada categoria tem seu match exato baseado nos
// objectives novos (OUTCOME_*) e legados. Retorna '' quando não classifica.
function categoriaDoObjective(objective: string): string {
  if (!objective) return ''
  const o = objective.toUpperCase()
  if (o === 'OUTCOME_SALES' || o === 'CONVERSIONS' || o === 'PRODUCT_CATALOG_SALES') return 'Vendas'
  if (o === 'OUTCOME_LEADS' || o === 'LEAD_GENERATION') return 'Leads'
  if (o === 'MESSAGES') return 'Mensagens'
  if (o === 'OUTCOME_TRAFFIC' || o === 'LINK_CLICKS') return 'Tráfego'
  if (o === 'OUTCOME_ENGAGEMENT' || o === 'POST_ENGAGEMENT' || o === 'PAGE_LIKES' || o === 'EVENT_RESPONSES') return 'Engajamento'
  if (o === 'OUTCOME_AWARENESS' || o === 'BRAND_AWARENESS' || o === 'REACH' || o === 'VIDEO_VIEWS') return 'Reconhec.'
  return ''
}

// Tokens no NOME da campanha que indicam categoria real. Útil quando o
// objective Meta diverge do uso (ex: "NGP - Vendas/Mensagens" tem objective
// OUTCOME_SALES mas converte via mensagem). normalizamos: lowercase + sem
// acento + sem pontuação, e procuramos como SUBSTRING.
const NAME_TOKENS: Record<string, string[]> = {
  Vendas:       ['vendas', 'venda', 'sales', 'compras', 'ecom', 'ecommerce', 'checkout'],
  Leads:        ['leads', 'lead', 'cadastro', 'cadastros', 'formulario', 'form'],
  Mensagens:    ['mensagens', 'mensagem', 'msg', 'whats', 'whatsapp', 'wpp', 'direct', 'dm', 'chat'],
  Tráfego:      ['trafego', 'traffic', 'site', 'cliques', 'click'],
  Engajamento:  ['engajamento', 'engagement', 'curtidas', 'engaja'],
  'Reconhec.':  ['reconhecimento', 'awareness', 'alcance', 'brand', 'institucional', 'marca'],
}

function normName(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Retorna lista de categorias detectadas pelo NOME (pode ser múltiplas).
// Vazio se nada bater.
function categoriasDoNome(name: string): string[] {
  const n = normName(name)
  if (!n) return []
  const found: string[] = []
  for (const [cat, tokens] of Object.entries(NAME_TOKENS)) {
    if (tokens.some(t => n.includes(t))) found.push(cat)
  }
  return found
}

function fmtBRL(v: number): string {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`
  return `R$ ${v.toFixed(0)}`
}

// Públicos (temperatura) — filtra resultado pelo nome da campanha
const AUDIENCES = [
  { label: 'Todos', value: '' },
  { label: 'Frio',  value: 'frio' },
  { label: 'Rmkt',  value: 'rmkt' },
  { label: 'Black', value: 'black' },
]

export default function NovoRelatorioModal({ isOpen, onClose, onConfirm, clienteName, campaigns, hasGoogleAds }: NovoRelatorioModalProps) {
  const [period, setPeriod] = useState('last_7d')
  const [platform, setPlatform] = useState<RelatorioPlatform>(hasGoogleAds ? 'both' : 'meta')
  const [selMetrics, setSelMetrics] = useState<Set<string>>(new Set(METRICS.map(m => m.key)))
  const [objective, setObjective] = useState('OUTCOME_SALES,CONVERSIONS,PRODUCT_CATALOG_SALES')
  const [audience, setAudience] = useState('')
  const [topN, setTopN] = useState(2)
  // Importação de criativos é sempre ON — ficaram só os controles de configuração
  const importCriativos = true

  // Quando muda a plataforma, reajusta as métricas selecionadas pra manter só
  // as compatíveis (evita marcar Frequência num relatório só Google).
  useEffect(() => {
    setSelMetrics(prev => {
      const next = new Set<string>()
      METRICS.forEach(m => {
        if (platform === 'google' && m.plat === 'meta') return
        if (prev.has(m.key)) next.add(m.key)
      })
      // Se ficou vazio, recompõe com defaults compatíveis
      if (next.size === 0) {
        METRICS.forEach(m => {
          if (platform === 'google' && m.plat === 'meta') return
          next.add(m.key)
        })
      }
      return next
    })
  }, [platform])

  // Soma spend por categoria de objetivo, com base nas campanhas já carregadas
  // no dashboard. Permite mostrar "Vendas (R$ 12k)" no pill e ordenar pra
  // colocar o objetivo dominante primeiro.
  //
  // Lógica de classificação (em cascata):
  //   1) Categorias detectadas pelo NOME (NAME_TOKENS) — fonte mais confiável,
  //      porque o gestor já nomeia pra refletir o uso real (ex: "Vendas/Mensagens"
  //      indica que a campanha gera ambos, mesmo que objective Meta seja só SALES).
  //   2) Se o nome não classificou, usa a categoria do objective Meta.
  //   3) Se o nome detectou MÚLTIPLAS, divide o spend igualmente entre elas
  //      (ex: "Vendas/Mensagens" → 50% pra cada).
  const spendPorCategoria = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of (campaigns || [])) {
      const spend = c.spend || 0
      if (spend <= 0) continue
      const cats = categoriasDoNome(c.name || '')
      if (cats.length > 0) {
        const share = spend / cats.length
        for (const cat of cats) m[cat] = (m[cat] || 0) + share
      } else {
        const cat = categoriaDoObjective(c.objective || '')
        if (cat) m[cat] = (m[cat] || 0) + spend
      }
    }
    return m
  }, [campaigns])

  // Objetivos ordenados: os com gasto primeiro (maior → menor), depois os sem
  // gasto na ordem original. "Todos" sempre por último.
  const objetivosOrdenados = useMemo(() => {
    const semTodos = OBJECTIVES.filter(o => o.label !== 'Todos')
    const todos = OBJECTIVES.find(o => o.label === 'Todos')
    const sorted = [...semTodos].sort((a, b) => {
      const sa = spendPorCategoria[a.label] || 0
      const sb = spendPorCategoria[b.label] || 0
      if (sa !== sb) return sb - sa
      return 0
    })
    return todos ? [...sorted, todos] : sorted
  }, [spendPorCategoria])

  // Pré-seleciona o objetivo com maior gasto quando o modal abre.
  // Só roda quando isOpen vira true e há campanhas — não derruba seleção manual.
  useEffect(() => {
    if (!isOpen) return
    const top = objetivosOrdenados.find(o => o.label !== 'Todos' && (spendPorCategoria[o.label] || 0) > 0)
    if (top) setObjective(top.value)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  if (!isOpen) return null

  function toggleMetric(key: string) {
    setSelMetrics(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function handleConfirm() {
    onConfirm({
      period,
      metrics: Array.from(selMetrics),
      importCriativos,
      objective,
      audience,
      topN,
      platform,
    })
  }

  // Pills de plataforma. "Ambos" só aparece quando há Google vinculado;
  // sem Google, mantém só Meta para evitar UI quebrada.
  const platformItems: { label: string; value: RelatorioPlatform }[] = hasGoogleAds
    ? [
        { label: 'Meta + Google', value: 'both' },
        { label: 'Só Meta',       value: 'meta' },
        { label: 'Só Google',     value: 'google' },
      ]
    : [
        { label: 'Só Meta',       value: 'meta' },
      ]

  const visibleMetrics = METRICS.filter(m => !(platform === 'google' && m.plat === 'meta'))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Sora,sans-serif' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>📊 Novo relatório · {clienteName}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#AEAEB2' }}>×</button>
        </div>

        <Section label="Plataforma">
          <Pills
            items={platformItems.map(p => ({ label: p.label, value: p.value }))}
            value={platform}
            onChange={(v) => setPlatform(v as RelatorioPlatform)}
          />
          {!hasGoogleAds && (
            <div style={{ fontSize: 11, color: '#AEAEB2', marginTop: 6 }}>
              Cliente sem Google Ads vinculado · vincule em Plataformas para liberar.
            </div>
          )}
        </Section>

        <Section label="Período">
          <Pills items={PERIODS.map(p => ({ label: p.label, value: p.value }))} value={period} onChange={setPeriod} />
        </Section>

        <Section label="Métricas a importar">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {visibleMetrics.map(m => (
              <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3A3A3C', cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: selMetrics.has(m.key) ? '#EFF6FF' : '#FAFAFA' }}>
                <input type="checkbox" checked={selMetrics.has(m.key)} onChange={() => toggleMetric(m.key)} />
                <span>{m.label}</span>
                {m.plat === 'meta' && platform === 'both' && (
                  <span style={{ fontSize: 9, padding: '1px 4px', background: '#DBEAFE', color: '#1E40AF', borderRadius: 3, fontWeight: 700 }}>Meta</span>
                )}
              </label>
            ))}
          </div>
        </Section>

        <Section label="🏆 Criativos campeões">
          {platform === 'google' ? (
            <div style={{ fontSize: 11, color: '#6E6E73', padding: '8px 10px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, lineHeight: 1.5 }}>
              Em relatório Google-only não importamos criativos individuais — o relatório mostra top campanhas, top palavras-chave e dispositivos na seção Google Ads.
              Se quiser destacar criativos manualmente, edite no relatório depois.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#6E6E73', marginBottom: 6 }}>
                Objetivo da campanha
                {Object.keys(spendPorCategoria).length > 0 && (
                  <span style={{ color: '#AEAEB2', marginLeft: 6 }}>
                    · auto-detectado pelo gasto da conta
                  </span>
                )}
              </div>
              <Pills
                items={objetivosOrdenados.map(o => {
                  const spend = spendPorCategoria[o.label] || 0
                  return {
                    label: spend > 0 ? `${o.label} · ${fmtBRL(spend)}` : o.label,
                    value: o.value,
                  }
                })}
                value={objective}
                onChange={setObjective}
              />
              <div style={{ fontSize: 11, color: '#6E6E73', margin: '10px 0 6px' }}>Público <span style={{ color: '#AEAEB2' }}>(filtra pelo nome)</span></div>
              <Pills items={AUDIENCES.map(a => ({ label: a.label, value: a.value }))} value={audience} onChange={setAudience} />
              <div style={{ fontSize: 11, color: '#6E6E73', margin: '10px 0 6px' }}>Quantidade</div>
              <Pills items={[2, 3, 4].map(n => ({ label: `Top ${n}`, value: String(n) }))} value={String(topN)} onChange={v => setTopN(Number(v))} />
            </>
          )}
        </Section>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={handleConfirm} style={{ flex: 1, padding: 12, background: '#1877F2', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Criar e preencher</button>
          <button
            onClick={() => onConfirm({ period, metrics: [], importCriativos: false, objective: '', audience: '', topN: 0, platform })}
            title="Cria sem importar nada das plataformas — para preencher 100% manual."
            style={{ flex: '0 0 auto', padding: '12px 16px', background: '#fff', color: '#6E6E73', border: '1.5px solid #E5E5EA', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Criar em branco
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#AEAEB2', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
}

function Pills({ items, value, onChange }: { items: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map(i => {
        const sel = i.value === value
        return (
          <button key={i.value} onClick={() => onChange(i.value)} style={{ padding: '6px 12px', borderRadius: 999, border: sel ? '1.5px solid #1877F2' : '1.5px solid #E5E5EA', background: sel ? '#1877F2' : '#fff', color: sel ? '#fff' : '#3A3A3C', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {i.label}
          </button>
        )
      })}
    </div>
  )
}
