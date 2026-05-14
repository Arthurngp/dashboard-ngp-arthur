'use client'
import dynamic from 'next/dynamic'
import '@/app/dashboard/chart-setup'
import { Campaign } from '@/types'
import PeriodFilter from '@/components/PeriodFilter'
import { DateParam } from '@/types'

const Bar = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Bar })), { ssr: false })
const Doughnut = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Doughnut })), { ssr: false })
const Line = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Line })), { ssr: false })

interface Props {
  clienteName: string
  metaAccount: string
  periodLabel: string
  campaigns: Campaign[]
  chartMetric: 'spend' | 'impressions' | 'clicks'
  chartData: any
  donutData: any
  timeSeriesData: Array<{ date: string; spend: number; impressions: number; clicks: number }>
  timeSeriesLoading: boolean
  timeSeriesError: string
  onSetChartMetric: (m: 'spend' | 'impressions' | 'clicks') => void
  onApplyPeriod: (dp: DateParam, label: string, cmpDp?: DateParam | null, cmpLabel?: string | null) => void
  onClose: () => void
}

// Tema escuro (Chart.js)
const darkScale = {
  ticks: { color: '#cbd5e1', font: { family: 'Sora', size: 11 } },
  grid: { color: 'rgba(255,255,255,.06)' },
}

export default function PresentMode(p: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a2540', zIndex: 1000, overflowY: 'auto', padding: 28, fontFamily: 'Sora,sans-serif', color: '#e2e8f0' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid rgba(255,255,255,.08)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: '#7dd3fc', textTransform: 'uppercase', marginBottom: 4 }}>Dados de campanhas</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.1 }}>{p.clienteName || 'Cliente'}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{p.metaAccount || '—'} · Meta Ads</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* PeriodFilter já é o próprio filtro do dashboard, com o mesmo handler */}
          <div style={{ filter: 'invert(1) hue-rotate(180deg)', borderRadius: 999, overflow: 'hidden' }}>
            <PeriodFilter onApply={p.onApplyPeriod} />
          </div>
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{p.periodLabel}</span>
          <button onClick={p.onClose} style={{ padding: '10px 16px', background: 'rgba(255,255,255,.08)', border: '1.5px solid rgba(255,255,255,.16)', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Voltar</button>
        </div>
      </div>

      {/* Métrica toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Métrica:</span>
        {(['spend', 'impressions', 'clicks'] as const).map(m => {
          const active = p.chartMetric === m
          return (
            <button key={m} onClick={() => p.onSetChartMetric(m)} style={{
              padding: '7px 14px',
              borderRadius: 999,
              border: active ? 'none' : '1.5px solid rgba(255,255,255,.18)',
              background: active ? 'linear-gradient(135deg, #22d3ee, #3b82f6)' : 'transparent',
              color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {m === 'spend' ? 'Investido' : m === 'impressions' ? 'Impressões' : 'Cliques'}
            </button>
          )
        })}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={cardTitle}>📊 Campanhas — top 8</div>
          <div style={{ height: 360 }}>
            {p.campaigns.length > 0
              ? <Bar data={p.chartData} options={barOptions} />
              : <div style={emptyStyle}>Sem dados.</div>}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={cardTitle}>🥧 Distribuição de gasto</div>
          <div style={{ height: 360 }}>
            {p.campaigns.length > 0
              ? <Doughnut data={p.donutData} options={doughnutOptions} />
              : <div style={emptyStyle}>Sem dados.</div>}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={cardTitle}>📈 Performance ao longo do tempo</div>
        <div style={{ height: 380 }}>
          {p.timeSeriesLoading
            ? <div style={emptyStyle}>Carregando…</div>
            : p.timeSeriesError
              ? <div style={emptyStyle}>Erro: {p.timeSeriesError}</div>
              : p.timeSeriesData.length === 0
                ? <div style={emptyStyle}>Sem dados de série temporal.</div>
                : <Line
                    data={{
                      labels: p.timeSeriesData.map(d => d.date),
                      datasets: [
                        { label: 'Gasto (R$)', data: p.timeSeriesData.map(d => d.spend), borderColor: '#22d3ee', backgroundColor: 'rgba(34, 211, 238, .12)', tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: '#22d3ee', pointBorderColor: '#0a2540', pointBorderWidth: 2, yAxisID: 'y' },
                        { label: 'Impressões (k)', data: p.timeSeriesData.map(d => d.impressions / 1000), borderColor: '#fbbf24', backgroundColor: 'rgba(251, 191, 36, .08)', tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: '#fbbf24', pointBorderColor: '#0a2540', pointBorderWidth: 2, yAxisID: 'y1' },
                      ],
                    }}
                    options={lineOptions}
                  />}
        </div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 14,
  padding: 18,
  minWidth: 0,
}
const cardTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 12,
}
const emptyStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: 12,
}
const barOptions = {
  responsive: true, maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: { legend: { display: false } },
  scales: { x: darkScale, y: darkScale },
}
const doughnutOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' as const, labels: { color: '#cbd5e1', font: { family: 'Sora', size: 11 } } } },
}
const lineOptions = {
  responsive: true, maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: { legend: { position: 'top' as const, labels: { color: '#cbd5e1', font: { family: 'Sora', size: 12 } } } },
  scales: {
    x: darkScale,
    y: { ...darkScale, position: 'left' as const },
    y1: { ...darkScale, position: 'right' as const, grid: { drawOnChartArea: false } },
  },
}
