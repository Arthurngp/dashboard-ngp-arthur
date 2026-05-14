'use client'
import React from 'react'
import dynamic from 'next/dynamic'
import '@/app/dashboard/chart-setup'
import { fmt, fmtI } from '@/lib/utils'
import { Campaign } from '@/types'
import styles from '../dashboard.module.css'

const Bar = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Bar })), { ssr: false })
const Doughnut = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Doughnut })), { ssr: false })
const Line = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Line })), { ssr: false })

interface GraficosTabProps {
  campaigns: Campaign[]
  chartMetric: 'spend' | 'impressions' | 'clicks'
  chartData: any
  donutData: any
  timeSeriesData: Array<{ date: string; spend: number; impressions: number; clicks: number }>
  timeSeriesLoading: boolean
  timeSeriesError: string
  onSetChartMetric: (m: 'spend' | 'impressions' | 'clicks') => void
  onPresent?: () => void
}

export default function GraficosTab({
  campaigns, chartMetric, chartData, donutData,
  timeSeriesData, timeSeriesLoading, timeSeriesError,
  onSetChartMetric, onPresent,
}: GraficosTabProps) {
  return (
    <>
      <div className={styles.chartControls}>
        <span className={styles.chartControlLabel}>Métrica:</span>
        {(['spend', 'impressions', 'clicks'] as const).map(m => (
          <button key={m} className={`${styles.chartBtn} ${chartMetric === m ? styles.chartBtnActive : ''}`} onClick={() => onSetChartMetric(m)}>
            {m === 'spend' ? 'Investido' : m === 'impressions' ? 'Impressões' : 'Cliques'}
          </button>
        ))}
        {onPresent && (
          <button
            type="button"
            onClick={onPresent}
            style={{ marginLeft: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, #1e3a8a, #1d4ed8)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sora,sans-serif', boxShadow: '0 6px 18px rgba(29,78,216,.25)' }}
            title="Modo apresentação tela cheia"
          >🎤 Apresentar</button>
        )}
      </div>

      <div className={styles.chartsRow}>
        <div className={styles.chartCard} style={{ flex: 2 }}>
          <div className={styles.chartHead}><span>📊 Campanhas — top 8</span></div>
          {campaigns.length > 0
            ? <Bar data={chartData} options={{ responsive: true, indexAxis: 'y' as const, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#E5E5EA' } }, y: { grid: { display: false } } } }} />
            : <div className={styles.empty}>Sem dados.</div>}
        </div>
        <div className={styles.chartCard} style={{ flex: 1, maxWidth: 320 }}>
          <div className={styles.chartHead}><span>🥧 Distribuição de gasto</span></div>
          {campaigns.length > 0
            ? <Doughnut data={donutData} options={{ responsive: true, plugins: { legend: { position: 'bottom' as const } } }} />
            : <div className={styles.empty}>Sem dados.</div>}
        </div>
      </div>

      <div className={styles.chartCard} style={{ marginBottom: 20 }}>
        <div className={styles.chartHead}><span>📈 Performance ao longo do tempo</span></div>
        {timeSeriesLoading
          ? <div className={styles.miniLoad}><div className={styles.spinnerSm} /> Carregando...</div>
          : timeSeriesError
            ? <div className={styles.empty}>Falha ao carregar série temporal real da Meta: {timeSeriesError}</div>
            : timeSeriesData.length === 0
              ? <div className={styles.empty}>Sem dados de série temporal.</div>
              : <Line
                  data={{
                    labels: timeSeriesData.map(d => d.date),
                    datasets: [
                      { label: 'Gasto (R$)', data: timeSeriesData.map(d => d.spend), borderColor: '#2563eb', backgroundColor: 'rgba(204, 20, 20, 0.05)', tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#2563eb', pointBorderColor: '#fff', pointBorderWidth: 2, yAxisID: 'y' },
                      { label: 'Impressões (k)', data: timeSeriesData.map(d => d.impressions / 1000), borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.05)', tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#3B82F6', pointBorderColor: '#fff', pointBorderWidth: 2, yAxisID: 'y1' },
                    ],
                  }}
                  options={{
                    responsive: true,
                    interaction: { mode: 'index' as const, intersect: false },
                    plugins: { legend: { position: 'top' as const } },
                    scales: {
                      y: { type: 'linear' as const, display: true, position: 'left' as const, grid: { color: '#E5E5EA' } },
                      y1: { type: 'linear' as const, display: true, position: 'right' as const, grid: { display: false } },
                    },
                  }}
                />
        }
      </div>

      {timeSeriesData.length > 0 && (
        <div className={styles.chartsRow}>
          <div className={styles.chartCard}>
            <div className={styles.chartHead}><span>💰 Gasto por dia</span></div>
            <Line
              data={{
                labels: timeSeriesData.map(d => d.date),
                datasets: [{ label: 'Gasto (R$)', data: timeSeriesData.map(d => d.spend), borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 2, pointBackgroundColor: '#10B981' }],
              }}
              options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#E5E5EA' } } } }}
            />
          </div>
          <div className={styles.chartCard}>
            <div className={styles.chartHead}><span>👁️ Impressões por dia</span></div>
            <Line
              data={{
                labels: timeSeriesData.map(d => d.date),
                datasets: [{ label: 'Impressões', data: timeSeriesData.map(d => d.impressions), borderColor: '#8B5CF6', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 2, pointBackgroundColor: '#8B5CF6' }],
              }}
              options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#E5E5EA' } } } }}
            />
          </div>
        </div>
      )}
    </>
  )
}
