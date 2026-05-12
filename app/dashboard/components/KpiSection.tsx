'use client'
import React from 'react'

interface KpiItem {
  label: string
  value: string
  accent?: boolean
  lowerIsBetter?: boolean
  currRaw?: number
  prevRaw?: number
  prev?: string
}

interface KpiSectionProps {
  title: string
  cmpLabel?: string
  items: KpiItem[]
}

const KpiSection = React.memo(function KpiSection({ title, cmpLabel, items }: KpiSectionProps) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E5EA', borderRadius: 10, padding: '16px 20px', flex: '1 1 280px', minWidth: 280, maxWidth: 450, boxSizing: 'border-box' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
        {items.map(it => {
          const hasCmp = it.prev !== undefined && it.prevRaw !== undefined && it.currRaw !== undefined
          const delta = hasCmp && it.prevRaw! > 0
            ? ((it.currRaw! - it.prevRaw!) / it.prevRaw! * 100)
            : null
          const isGood = delta !== null
            ? (it.lowerIsBetter ? delta <= 0 : delta >= 0)
            : null
          return (
            <div key={it.label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#AEAEB2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: it.accent ? 'var(--report-primary)' : '#111', letterSpacing: '-.02em', lineHeight: 1 }}>{it.value}</div>
                {delta !== null && Math.abs(delta) >= 0.1 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                    background: isGood ? '#dcfce7' : '#fee2e2',
                    color: isGood ? '#16a34a' : '#dc2626',
                    lineHeight: 1.4, whiteSpace: 'nowrap',
                  }}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                  </span>
                )}
              </div>
              {it.prev && (
                <div style={{
                  fontSize: 10, color: '#AEAEB2', marginTop: 4,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%'
                }} title={`${it.prev} ant.${cmpLabel ? ` · ${cmpLabel}` : ''}`}>
                  {it.prev} ant.{cmpLabel ? ` · ${cmpLabel}` : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

export default KpiSection
