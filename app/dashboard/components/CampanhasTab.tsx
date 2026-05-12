'use client'
import React from 'react'
import { fmt, fmtN, fmtI } from '@/lib/utils'
import { Campaign, Ad } from '@/types'
import CustomSelect from '@/components/CustomSelect'
import dynamic from 'next/dynamic'
import '@/app/dashboard/chart-setup'
const Bar = dynamic(() => import('react-chartjs-2').then(m => ({ default: m.Bar })), { ssr: false })
import { META_METRICS } from '@/lib/meta-metrics'
import styles from '../dashboard.module.css'

interface CampanhasTabProps {
  loading: boolean
  campSearch: string
  campStatus: string
  campFiltered: Campaign[]
  openCamps: Set<string>
  openAdsets: Set<string>
  loadingAdsets: Set<string>
  loadingAds: Set<string>
  adsetMap: Record<string, any[]>
  adsMap: Record<string, Ad[]>
  breakdownType: 'by_day' | 'by_device' | 'by_placement'
  breakdownMetric: 'spend' | 'impressions' | 'clicks'
  breakdownData: Array<{ name: string; value: number }>
  breakdownLoading: boolean
  breakdownError: string
  topAdsSort: 'spend' | 'ctr' | 'cpc' | 'results'
  campaigns: Campaign[]
  visibleMetrics: string[]
  onSetCampSearch: (v: string) => void
  onSetCampStatus: (v: string) => void
  onToggleCamp: (id: string) => void
  onToggleAdset: (id: string) => void
  onLoadAllCampaignData: (campId: string) => void
  onLoadBreakdown: (type: 'by_day' | 'by_device' | 'by_placement', metric: 'spend' | 'impressions' | 'clicks') => void
  onSetBreakdownType: (t: 'by_day' | 'by_device' | 'by_placement') => void
  onSetBreakdownMetric: (m: 'spend' | 'impressions' | 'clicks') => void
  onSetTopAdsSort: (s: 'spend' | 'ctr' | 'cpc' | 'results') => void
  onLoadPreview: (adId: string, adName: string) => void
}

export default function CampanhasTab({
  loading, campSearch, campStatus, campFiltered, openCamps, openAdsets,
  loadingAdsets, loadingAds, adsetMap, adsMap,
  breakdownType, breakdownMetric, breakdownData, breakdownLoading, breakdownError,
  topAdsSort, campaigns, visibleMetrics,
  onSetCampSearch, onSetCampStatus, onToggleCamp, onToggleAdset,
  onLoadAllCampaignData, onLoadBreakdown, onSetBreakdownType, onSetBreakdownMetric,
  onSetTopAdsSort, onLoadPreview,
}: CampanhasTabProps) {
  return (
    <>
      <div className={styles.accordionFilters}>
        <input className={styles.tableSearch} value={campSearch} onChange={e => onSetCampSearch(e.target.value)} placeholder="Buscar campanha..." />
        <CustomSelect
          caption="Filtrar por"
          value={campStatus}
          options={[{ id: 'all', label: 'Todos' }, { id: 'ACTIVE', label: 'Ativas' }, { id: 'PAUSED', label: 'Pausadas' }]}
          onChange={onSetCampStatus}
        />
      </div>
      {loading && <div className={styles.loadingBar}><div className={styles.spinner} /> Carregando...</div>}

      {/* BREAKDOWN */}
      <div className={styles.tableCard} style={{ marginBottom: 20 }}>
        <div className={styles.tableHead}>
          <span className={styles.tableTitle}>Análise de Performance</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['by_day', 'by_device', 'by_placement'] as const).map(type => (
              <button key={type} className={styles.chartBtn}
                style={{ background: breakdownType === type ? 'var(--report-primary)' : 'transparent', color: breakdownType === type ? '#fff' : '#6E6E73', borderColor: breakdownType === type ? 'var(--report-primary)' : '#E5E5EA' }}
                onClick={() => { onSetBreakdownType(type); onLoadBreakdown(type, breakdownMetric) }}
              >
                {type === 'by_day' ? 'Por dia' : type === 'by_device' ? 'Por dispositivo' : 'Por posição'}
              </button>
            ))}
            {(['spend', 'impressions', 'clicks'] as const).map(m => (
              <button key={m} className={styles.chartBtn}
                style={{ background: breakdownMetric === m ? 'var(--report-primary)' : 'transparent', color: breakdownMetric === m ? '#fff' : '#6E6E73', borderColor: breakdownMetric === m ? 'var(--report-primary)' : '#E5E5EA' }}
                onClick={() => { onSetBreakdownMetric(m); onLoadBreakdown(breakdownType, m) }}
              >
                {m === 'spend' ? 'Gasto' : m === 'impressions' ? 'Impressões' : 'Cliques'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '16px 18px' }}>
          {breakdownLoading
            ? <div className={styles.miniLoad}><div className={styles.spinnerSm} /> Carregando análise...</div>
            : breakdownError
              ? <div className={styles.empty}>Falha ao carregar breakdown real da Meta: {breakdownError}</div>
              : breakdownData.length === 0
                ? <div className={styles.empty}>Sem dados de breakdown.</div>
                : (
                  <div className={styles.customScroll} style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 8 }}>
                    {(() => {
                      const sortedData = breakdownType === 'by_day' ? [...breakdownData] : [...breakdownData].sort((a, b) => b.value - a.value)
                      const maxVal = Math.max(...sortedData.map(d => d.value))
                      return sortedData.map((item, idx) => {
                        const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0
                        return (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: idx < sortedData.length - 1 ? '1px solid #E5E5EA' : 'none' }}>
                            <div style={{ minWidth: 140, fontSize: 12, fontWeight: 600, color: '#111' }}>{item.name}</div>
                            <div style={{ flex: 1, height: 8, background: '#F5F5F7', borderRadius: 20, overflow: 'hidden' }}>
                              <div style={{ height: '100%', background: 'linear-gradient(90deg, var(--report-primary), #38bdf8)', width: `${pct}%`, borderRadius: 20, transition: 'width 0.4s ease' }} />
                            </div>
                            <div style={{ minWidth: 90, textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#111' }}>
                              {breakdownMetric === 'spend' ? `R$ ${fmt(item.value)}` : fmtN(item.value)}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                )
          }
        </div>
      </div>

      {/* TOP CREATIVES */}
      {campaigns.length > 0 && (
        <div className={styles.tableCard} style={{ marginBottom: 20 }}>
          <div className={styles.tableHead} style={{ justifyContent: 'space-between' }}>
            <span className={styles.tableTitle}>🎬 Top Criativos (Performance)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['spend', 'ctr', 'cpc', 'results'] as const).map(m => (
                <button key={m} className={styles.chartBtn}
                  style={{ background: topAdsSort === m ? 'var(--report-primary)' : 'transparent', color: topAdsSort === m ? '#fff' : '#6E6E73', borderColor: topAdsSort === m ? 'var(--report-primary)' : '#E5E5EA', padding: '4px 10px', fontSize: 10 }}
                  onClick={() => onSetTopAdsSort(m)}
                >
                  {m === 'spend' ? 'Gasto' : m === 'ctr' ? 'CTR' : m === 'cpc' ? 'CPC' : 'Resultados'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <div className={styles.customScroll} style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 10 }}>
              {(() => {
                const allAds = Object.values(adsMap).flat()
                return allAds.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 24, color: '#AEAEB2', fontSize: 13 }}>
                    Expanda as campanhas para visualizar criativos.
                  </div>
                ) : (
                  allAds
                    .sort((a, b) => {
                      if (topAdsSort === 'spend') return b.spend - a.spend
                      if (topAdsSort === 'ctr') return b.ctr - a.ctr
                      if (topAdsSort === 'cpc') { if (a.cpc === 0) return 1; if (b.cpc === 0) return -1; return a.cpc - b.cpc }
                      const aRes = (a.leads || 0) + (a.conversations || 0) + (a.purchases || 0)
                      const bRes = (b.leads || 0) + (b.conversations || 0) + (b.purchases || 0)
                      return bRes - aRes
                    })
                    .map((ad, idx) => {
                      const res = (ad.leads || 0) + (ad.conversations || 0) + (ad.purchases || 0)
                      const thumb = (ad as any).creative?.thumbnail_url
                      return (
                        <div key={ad.id} className={styles.adCard} style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', minWidth: 160, flexShrink: 0 }} onClick={() => onLoadPreview(ad.id, ad.name)}>
                          <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 6px', zIndex: 10 }}>
                            #{idx + 1}
                          </div>
                          <div className="preview-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', opacity: 0, transition: 'opacity .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, color: '#fff' }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                          >
                            <div style={{ background: 'var(--report-primary)', borderRadius: 20, padding: '8px 16px', fontSize: 11, fontWeight: 700, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>👁️ Ver Preview</div>
                          </div>
                          {thumb ? (
                            <img src={thumb} alt="" className={styles.adThumb} style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 7, marginBottom: 8 }} onError={e => (e.currentTarget.style.display = 'none')} />
                          ) : (
                            <div style={{ width: '100%', height: 100, background: '#F5F5F7', borderRadius: 7, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AEAEB2', fontSize: 32 }}>📷</div>
                          )}
                          <div className={styles.adName} style={{ marginBottom: 4 }}>{ad.name}</div>
                          <div className={styles.adStats} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: '#6E6E73' }}>
                            {topAdsSort === 'spend' && <span>💰 Gasto: <b>R$ {fmt(ad.spend)}</b></span>}
                            {topAdsSort === 'ctr' && <span>🔗 CTR: <b>{ad.ctr.toFixed(2)}%</b></span>}
                            {topAdsSort === 'cpc' && <span>💸 CPC: <b>R$ {fmt(ad.cpc)}</b></span>}
                            {topAdsSort === 'results' && <span>🎯 Result: <b>{fmtN(res)}</b></span>}
                            <span style={{ opacity: 0.6 }}>👁️ {fmtI(ad.impressions)} imps</span>
                          </div>
                        </div>
                      )
                    })
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ACCORDION */}
      <div className={styles.accordion}>
        {campFiltered.map(c => (
          <div key={c.id} className={styles.accItem}>
            <div className={styles.accHeader} onClick={() => onToggleCamp(c.id)}>
              <svg className={`${styles.chevron} ${openCamps.has(c.id) ? styles.chevronOpen : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={16} height={16}><path d="M9 18l6-6-6-6" /></svg>
              <div className={styles.accInfo}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className={styles.accName}>{c.name}</div>
                  <button
                    onClick={e => { e.stopPropagation(); onLoadAllCampaignData(c.id) }}
                    style={{ background: '#F5F5F7', border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 700, color: '#2563EB', cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#2563EB'; e.currentTarget.style.color = '#fff' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#F5F5F7'; e.currentTarget.style.color = '#2563EB' }}
                  >⚡ Ver Tudo</button>
                </div>
                <div className={styles.accObj}>{c.objective}</div>
              </div>
              <span className={`${styles.pill} ${c.status === 'ACTIVE' ? styles.pillGreen : styles.pillGray}`}>{c.status === 'ACTIVE' ? 'Ativa' : 'Pausada'}</span>
              <div className={styles.accStats}><span>R$ {fmt(c.spend)}</span><span>{fmtI(c.impressions)}</span><span>{c.ctr.toFixed(2)}% CTR</span></div>
            </div>
            {openCamps.has(c.id) && (
              <div className={styles.accBody}>
                {loadingAdsets.has(c.id)
                  ? <div className={styles.miniLoad}><div className={styles.spinnerSm} /> Carregando conjuntos...</div>
                  : (adsetMap[c.id] || []).map(as => (
                    <div key={as.id} className={styles.adsetItem}>
                      <div className={styles.adsetHeader} onClick={() => onToggleAdset(as.id)}>
                        <svg className={`${styles.chevron} ${openAdsets.has(as.id) ? styles.chevronOpen : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={14} height={14}><path d="M9 18l6-6-6-6" /></svg>
                        <span className={styles.adsetName}>{as.name}</span>
                        <span className={`${styles.pill} ${as.status === 'ACTIVE' ? styles.pillGreen : styles.pillGray}`} style={{ fontSize: 10 }}>{as.status === 'ACTIVE' ? 'Ativo' : 'Pausado'}</span>
                        <span className={styles.adsetStat}>R$ {fmt(as.spend)}</span>
                      </div>
                      {openAdsets.has(as.id) && (
                        <div className={styles.adsGrid}>
                          {loadingAds.has(as.id)
                            ? <div className={styles.miniLoad}><div className={styles.spinnerSm} /></div>
                            : (adsMap[as.id] || []).map(ad => (
                              <div key={ad.id} className={styles.adCard} style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onLoadPreview(ad.id, ad.name)}>
                                <div className="preview-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.1)', opacity: 0, transition: 'opacity .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}
                                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                  onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                                >
                                  <div style={{ background: 'var(--report-primary)', borderRadius: 20, padding: '4px 10px', fontSize: 9, fontWeight: 700, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>👁️ Preview</div>
                                </div>
                                {(ad as any).creative?.thumbnail_url && (
                                  <img src={(ad as any).creative.thumbnail_url} alt="" className={styles.adThumb} onError={e => (e.currentTarget.style.display = 'none')} />
                                )}
                                <div className={styles.adName}>{ad.name}</div>
                                <div className={styles.adStats}><span>R$ {fmt(ad.spend)}</span><span>{fmtI(ad.impressions)}</span><span>{ad.ctr.toFixed(2)}%</span></div>
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        ))}
        {campFiltered.length === 0 && !loading && <div className={styles.empty}>Nenhuma campanha encontrada.</div>}
      </div>
    </>
  )
}
