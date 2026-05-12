'use client'
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { fmt, fmtN, fmtI } from '@/lib/utils'
import { debounce } from '@/lib/fetch-utils'
import { Cliente, Relatorio } from '@/types'
import { OverviewRow, BudgetAlert, OVERVIEW_COLUMNS, BG_COLORS, Tab, Viewing } from '../types'
import { formatSignedPct, getOverviewDeltaMeta } from '../dashboard-utils'
import styles from '../dashboard.module.css'

// ─── Overview Tab ─────────────────────────────────────────────────────────────

interface OverviewTabProps {
  initLoad: boolean
  overviewLoading: boolean
  overviewError: string
  overviewRows: OverviewRow[]
  search: string
  period: any
  cmpPeriodParam: any
  cmpLabel: string
  periodLabel: string
  visibleOverviewCols: string[]
  colMenuOpen: boolean
  colMenuRef: React.RefObject<HTMLDivElement>
  overviewLastUpdated: string
  overviewAutoRefresh: boolean
  filteredOverviewRows: OverviewRow[]
  overviewTotals: {
    current: { spend: number; impressions: number; clicks: number; reach: number; results: number; leads: number; revenue: number }
    previous: { spend: number; impressions: number; clicks: number; reach: number; results: number; leads: number; revenue: number }
  }
  overviewTotalsCtr: number
  overviewTotalsPrevCtr: number
  overviewTotalsCpc: number
  overviewTotalsPrevCpc: number
  overviewTotalsCpl: number
  overviewTotalsPrevCpl: number
  overviewTotalsRoas: number
  overviewTotalsPrevRoas: number
  overviewHeroStats: { label: string; value: string }[]
  sess: any
  onSetSearch: (v: string) => void
  onSetColMenuOpen: (v: boolean) => void
  onToggleColumn: (id: string) => void
  onSetAutoRefresh: (v: boolean) => void
  onLoadOverviewData: () => void
  onSelectAccount: (c: Cliente) => void
  onOpenModal: (client: Partial<Cliente>) => void
  onApplyPeriod: (dp: any, label: string, cmp?: any, cmpLbl?: string) => void
}

const OverviewTab = React.memo(function OverviewTab({
  initLoad, overviewLoading, overviewError, search, cmpLabel, periodLabel,
  visibleOverviewCols, colMenuOpen, colMenuRef, overviewLastUpdated, overviewAutoRefresh,
  filteredOverviewRows, overviewTotals, overviewTotalsCtr, overviewTotalsPrevCtr,
  overviewTotalsCpc, overviewTotalsPrevCpc, overviewTotalsCpl, overviewTotalsPrevCpl,
  overviewTotalsRoas, overviewTotalsPrevRoas, overviewHeroStats, sess,
  onSetSearch, onSetColMenuOpen, onToggleColumn, onSetAutoRefresh,
  onLoadOverviewData, onSelectAccount, onOpenModal,
}: OverviewTabProps) {
  // Estado local para o input — debounce de 250ms antes de propagar ao pai
  const [inputValue, setInputValue] = useState(search)
  useEffect(() => { setInputValue(search) }, [search])
  useEffect(() => {
    const debouncedSet = debounce(onSetSearch, 250)
    debouncedSet(inputValue)
    return debouncedSet.cancel
  }, [inputValue]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={styles.overviewToolbar}>
        <div className={styles.searchWrap} style={{ marginBottom: 0, flex: 1, minWidth: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={16} height={16}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder="Buscar cliente ou conta..." />
        </div>

        <label className={styles.overviewSwitchWrap}>
          <span className={styles.overviewSwitchLabel}>Atualização automática</span>
          <span className={styles.overviewSwitchMeta}>
            {overviewLastUpdated ? `Última leitura às ${new Date(overviewLastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Sem leitura ainda'}
          </span>
          <span className={styles.overviewSwitch}>
            <input type="checkbox" checked={overviewAutoRefresh} onChange={e => onSetAutoRefresh(e.target.checked)} />
            <span className={styles.overviewSwitchTrack} />
          </span>
        </label>
      </div>

      <div className={styles.overviewTabs}>
        <button className={`${styles.overviewTab} ${styles.overviewTabActive}`}>Anúncios</button>
        <button className={styles.overviewTabMuted} disabled>Mídias Sociais</button>
        <button className={styles.overviewTabMuted} disabled>SEO</button>
        <button className={styles.overviewTabMuted} disabled>E-commerce</button>
      </div>

      <div id="overview-summary" className={styles.overviewStatGrid}>
        {overviewHeroStats.map((stat) => (
          <div key={stat.label} className={styles.overviewStatCard}>
            <div className={styles.overviewStatLabel}>{stat.label}</div>
            <div className={styles.overviewStatValue}>{stat.value}</div>
          </div>
        ))}
      </div>

      {overviewError && <div className={styles.errorBox}>{overviewError}</div>}

      {initLoad || (overviewLoading && filteredOverviewRows.length === 0)
        ? <div className={styles.centerLoad}><div className={styles.spinner} /></div>
        : filteredOverviewRows.length === 0
          ? <div className={styles.empty}>Nenhuma conta encontrada com esse filtro.</div>
          : (
            <div id="overview-table" className={styles.overviewTableCard}>
              <div className={styles.overviewTableHead}>
                <div>
                  <div className={styles.overviewTableTitle}>Visão geral multi-clientes</div>
                  <div className={styles.overviewTableSub}>Clique em qualquer linha para abrir o dashboard detalhado da conta.</div>
                </div>
                {overviewLoading && <div className={styles.overviewLoadingPill}><div className={styles.spinnerSm} /> Atualizando visão geral...</div>}
                <div className={styles.colSelectorWrap} ref={colMenuRef}>
                  <button className={styles.colSelectorBtn} onClick={() => onSetColMenuOpen(!colMenuOpen)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={14} height={14}>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Personalizar colunas
                  </button>
                  {colMenuOpen && (
                    <div className={styles.colSelectorMenu}>
                      <div className={styles.colSelectorTitle}>Colunas visíveis</div>
                      {OVERVIEW_COLUMNS.map(col => (
                        <label key={col.id} className={styles.colSelectorItem}>
                          <input type="checkbox" checked={visibleOverviewCols.includes(col.id)} onChange={() => onToggleColumn(col.id)} />
                          <span className={styles.colSelectorCheck} />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.overviewTableWrap}>
                <table className={styles.overviewTable}>
                  <thead>
                    <tr>
                      <th>Projeto</th>
                      {visibleOverviewCols.includes('spend') && <th>Investido</th>}
                      {visibleOverviewCols.includes('results') && <th>Resultados</th>}
                      {visibleOverviewCols.includes('ctr') && <th>CTR</th>}
                      {visibleOverviewCols.includes('cpc') && <th>CPC</th>}
                      {visibleOverviewCols.includes('cpl') && <th>CPL</th>}
                      {visibleOverviewCols.includes('roas') && <th>ROAS</th>}
                      {visibleOverviewCols.includes('reach') && <th>Alcance</th>}
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOverviewRows.map((row, index) => {
                      const clickable = !!row.client.meta_account_id
                      const spendDelta = row.current && row.previous ? getOverviewDeltaMeta(row.current.spend, row.previous.spend) : null
                      const resultsDelta = row.current && row.previous ? getOverviewDeltaMeta(row.current.results, row.previous.results) : null
                      const ctrDelta = row.current && row.previous ? getOverviewDeltaMeta(row.current.ctr, row.previous.ctr) : null
                      const cpcDelta = row.current && row.previous ? getOverviewDeltaMeta(row.current.cpc, row.previous.cpc, true) : null
                      const cplDelta = row.current && row.previous ? getOverviewDeltaMeta(row.current.costPerLead, row.previous.costPerLead, true) : null
                      const roasDelta = row.current && row.previous ? getOverviewDeltaMeta(row.current.roas, row.previous.roas) : null

                      const DeltaSpan = ({ delta }: { delta: { label: string; tone: string } | null }) =>
                        delta ? (
                          <span className={`${styles.overviewDelta} ${styles[`overviewDelta${delta.tone === 'good' ? 'Good' : delta.tone === 'bad' ? 'Bad' : 'Warn'}`]}`}>
                            {delta.label}
                          </span>
                        ) : null

                      return (
                        <tr
                          key={row.client.id}
                          className={`${clickable ? styles.overviewRowClickable : styles.overviewRowMuted}`}
                          onClick={() => { if (clickable) onSelectAccount(row.client) }}
                        >
                          <td>
                            <div className={styles.overviewProjectCell}>
                              <div className={styles.overviewProjectAvatar} style={{ background: BG_COLORS[index % BG_COLORS.length] }}>
                                {row.client.foto_url
                                  ? <Image src={row.client.foto_url} alt={row.client.nome} width={32} height={32} style={{ objectFit: 'cover', borderRadius: '50%' }} />
                                  : row.client.nome.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className={styles.overviewProjectName}>{row.client.nome}</div>
                                <div className={styles.overviewProjectMeta}>{row.client.meta_account_id || 'Sem conta Meta configurada'}</div>
                              </div>
                            </div>
                          </td>
                          {visibleOverviewCols.includes('spend') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>R$ {fmt(row.current.spend)}</div>
                                  <div className={styles.overviewMetricSub}>
                                    <DeltaSpan delta={spendDelta} /> {!spendDelta && 'Sem comparativo'}
                                  </div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>{row.status === 'no_account' ? '—' : 'Falha ao carregar'}</span>}
                            </td>
                          )}
                          {visibleOverviewCols.includes('results') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>{fmtN(row.current.results)}</div>
                                  <div className={styles.overviewMetricSub}>
                                    {resultsDelta ? <DeltaSpan delta={resultsDelta} /> : row.current.resultLabel}
                                  </div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>—</span>}
                            </td>
                          )}
                          {visibleOverviewCols.includes('ctr') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>{row.current.ctr.toFixed(2)}%</div>
                                  <div className={styles.overviewMetricSub}>
                                    <DeltaSpan delta={ctrDelta} /> {!ctrDelta && 'Sem comparativo'}
                                  </div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>—</span>}
                            </td>
                          )}
                          {visibleOverviewCols.includes('cpc') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>R$ {fmt(row.current.cpc)}</div>
                                  <div className={styles.overviewMetricSub}>
                                    <DeltaSpan delta={cpcDelta} /> {!cpcDelta && 'Sem comparativo'}
                                  </div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>—</span>}
                            </td>
                          )}
                          {visibleOverviewCols.includes('cpl') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>{row.current.leads > 0 ? `R$ ${fmt(row.current.costPerLead)}` : '—'}</div>
                                  <div className={styles.overviewMetricSub}>
                                    {row.current.leads > 0
                                      ? (cplDelta ? <DeltaSpan delta={cplDelta} /> : 'Custo por lead')
                                      : row.current.resultLabel}
                                  </div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>—</span>}
                            </td>
                          )}
                          {visibleOverviewCols.includes('roas') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>{row.current.roas.toFixed(2)}x</div>
                                  <div className={styles.overviewMetricSub}>
                                    <DeltaSpan delta={roasDelta} /> {!roasDelta && 'Sem comparativo'}
                                  </div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>—</span>}
                            </td>
                          )}
                          {visibleOverviewCols.includes('reach') && (
                            <td>
                              {row.current ? (
                                <div className={styles.overviewMetricCell}>
                                  <div className={styles.overviewMetricMain}>{fmtI(row.current.reach)}</div>
                                  <div className={styles.overviewMetricSub}>{row.current.frequency.toFixed(2)}x frequência</div>
                                </div>
                              ) : <span className={styles.overviewMutedText}>—</span>}
                            </td>
                          )}
                          <td>
                            <div className={styles.overviewActionsCell}>
                              {clickable ? (
                                <button className={styles.overviewOpenBtn} onClick={e => { e.stopPropagation(); onSelectAccount(row.client) }}>
                                  Abrir →
                                </button>
                              ) : sess?.role === 'admin' ? (
                                <button className={styles.overviewGhostBtn} onClick={e => { e.stopPropagation(); onOpenModal(row.client) }}>
                                  Configurar
                                </button>
                              ) : (
                                <span className={styles.overviewMutedText}>—</span>
                              )}
                              {sess?.role === 'admin' && (
                                <button className={styles.overviewIconBtn} onClick={e => { e.stopPropagation(); onOpenModal(row.client) }}>
                                  ✏
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}

                    <tr className={styles.overviewTotalRow}>
                      <td><span className={styles.overviewTotalLabel}>Total</span></td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>R$ {fmt(overviewTotals.current.spend)}</div>
                          <div className={styles.overviewMetricSub}>
                            {cmpLabel ? formatSignedPct(overviewTotals.current.spend, overviewTotals.previous.spend) || 'Sem comparativo' : 'Consolidado'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>{fmtN(overviewTotals.current.results)}</div>
                          <div className={styles.overviewMetricSub}>
                            {cmpLabel ? formatSignedPct(overviewTotals.current.results, overviewTotals.previous.results) || 'Sem comparativo' : 'Resultados totais'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>{overviewTotalsCtr.toFixed(2)}%</div>
                          <div className={styles.overviewMetricSub}>
                            {cmpLabel ? formatSignedPct(overviewTotalsCtr, overviewTotalsPrevCtr) || 'Sem comparativo' : 'CTR consolidado'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>R$ {fmt(overviewTotalsCpc)}</div>
                          <div className={styles.overviewMetricSub}>
                            {cmpLabel ? formatSignedPct(overviewTotalsCpc, overviewTotalsPrevCpc) || 'Sem comparativo' : 'CPC consolidado'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>{overviewTotals.current.leads > 0 ? `R$ ${fmt(overviewTotalsCpl)}` : '—'}</div>
                          <div className={styles.overviewMetricSub}>
                            {overviewTotals.current.leads > 0
                              ? (cmpLabel ? formatSignedPct(overviewTotalsCpl, overviewTotalsPrevCpl) || 'Sem comparativo' : 'CPL consolidado')
                              : 'Sem leads'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>{overviewTotalsRoas.toFixed(2)}x</div>
                          <div className={styles.overviewMetricSub}>
                            {cmpLabel ? formatSignedPct(overviewTotalsRoas, overviewTotalsPrevRoas) || 'Sem comparativo' : 'ROAS consolidado'}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.overviewMetricCell}>
                          <div className={styles.overviewMetricMain}>{fmtI(overviewTotals.current.reach)}</div>
                          <div className={styles.overviewMetricSub}>Alcance somado</div>
                        </div>
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
      }
    </>
  )
})

export default OverviewTab
