'use client'

import { useState } from 'react'

interface NovoRelatorioModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (config: NovoRelatorioConfig) => void
  clienteName: string
}

export interface NovoRelatorioConfig {
  period: string
  metrics: string[]
  importCriativos: boolean
  objective: string
  topN: number
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

const METRICS = [
  { key: 'spend',       label: 'Investimento' },
  { key: 'results',     label: 'Leads / Resultados' },
  { key: 'cpl',         label: 'CPL / CPA' },
  { key: 'reach',       label: 'Alcance' },
  { key: 'impressions', label: 'Impressões' },
  { key: 'clicks',      label: 'Cliques' },
  { key: 'ctr',         label: 'CTR' },
  { key: 'frequency',   label: 'Frequência' },
  { key: 'cpm',         label: 'CPM' },
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

export default function NovoRelatorioModal({ isOpen, onClose, onConfirm, clienteName }: NovoRelatorioModalProps) {
  const [period, setPeriod] = useState('last_7d')
  const [selMetrics, setSelMetrics] = useState<Set<string>>(new Set(METRICS.map(m => m.key)))
  const [importCriativos, setImportCriativos] = useState(true)
  const [objective, setObjective] = useState('OUTCOME_SALES')
  const [topN, setTopN] = useState(2)

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
      topN,
    })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Sora,sans-serif' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>📊 Novo relatório · {clienteName}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#AEAEB2' }}>×</button>
        </div>

        <Section label="Período">
          <Pills items={PERIODS.map(p => ({ label: p.label, value: p.value }))} value={period} onChange={setPeriod} />
        </Section>

        <Section label="Métricas a importar">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {METRICS.map(m => (
              <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3A3A3C', cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: selMetrics.has(m.key) ? '#EFF6FF' : '#FAFAFA' }}>
                <input type="checkbox" checked={selMetrics.has(m.key)} onChange={() => toggleMetric(m.key)} />
                {m.label}
              </label>
            ))}
          </div>
        </Section>

        <Section label={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🏆 Criativos campeões
            <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, fontSize: 11, color: '#6E6E73', fontWeight: 500 }}>
              <input type="checkbox" checked={importCriativos} onChange={e => setImportCriativos(e.target.checked)} /> importar
            </label>
          </span>
        }>
          {importCriativos && (
            <>
              <div style={{ fontSize: 11, color: '#6E6E73', marginBottom: 6 }}>Objetivo da campanha</div>
              <Pills items={OBJECTIVES.map(o => ({ label: o.label, value: o.value }))} value={objective} onChange={setObjective} />
              <div style={{ fontSize: 11, color: '#6E6E73', margin: '10px 0 6px' }}>Quantidade</div>
              <Pills items={[2, 3, 4].map(n => ({ label: `Top ${n}`, value: String(n) }))} value={String(topN)} onChange={v => setTopN(Number(v))} />
            </>
          )}
        </Section>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={handleConfirm} style={{ flex: 1, padding: 12, background: '#1877F2', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Criar e preencher</button>
          <button onClick={() => onConfirm({ period, metrics: [], importCriativos: false, objective: '', topN: 0 })} style={{ flex: '0 0 auto', padding: '12px 16px', background: '#fff', color: '#6E6E73', border: '1.5px solid #E5E5EA', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Pular</button>
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
