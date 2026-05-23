'use client'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import PeriodFilter from '@/components/PeriodFilter'
import type { DateParam } from '@/types'
import { financeiroNav } from '../financeiro-nav'
import { fmtBRL, fmtBRLCompact } from '@/lib/financeiro-analista'
import styles from './dashboard.module.css'

type ViewMode = 'competencia' | 'caixa'

/**
 * Converte um DateParam (preset ou time_range) num par {start, end} em ISO YYYY-MM-DD.
 * Replica a semântica dos presets aceitos pelo PeriodFilter.
 */
function resolveDateRange(dp: DateParam): { start: string; end: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  // Período custom já vem pronto
  if (dp.time_range) {
    try {
      const parsed = JSON.parse(dp.time_range) as { since?: string; until?: string }
      if (parsed?.since && parsed?.until) return { start: parsed.since, end: parsed.until }
    } catch { /* cai pra preset */ }
  }

  const preset = dp.date_preset || 'this_month'
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
  const endOfMonth   = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

  switch (preset) {
    case 'today':       return { start: iso(today), end: iso(today) }
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      return { start: iso(y), end: iso(y) }
    }
    case 'last_7d': {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      return { start: iso(s), end: iso(today) }
    }
    case 'last_14d': {
      const s = new Date(today); s.setDate(s.getDate() - 13)
      return { start: iso(s), end: iso(today) }
    }
    case 'last_30d': {
      const s = new Date(today); s.setDate(s.getDate() - 29)
      return { start: iso(s), end: iso(today) }
    }
    case 'last_month': {
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      return { start: iso(startOfMonth(lm)), end: iso(endOfMonth(lm)) }
    }
    case 'this_quarter': {
      const q = Math.floor(today.getMonth() / 3)
      return {
        start: iso(new Date(today.getFullYear(), q * 3, 1)),
        end:   iso(new Date(today.getFullYear(), q * 3 + 3, 0)),
      }
    }
    case 'last_quarter': {
      const q = Math.floor(today.getMonth() / 3) - 1
      const baseYear = q < 0 ? today.getFullYear() - 1 : today.getFullYear()
      const qNorm = ((q % 4) + 4) % 4
      return {
        start: iso(new Date(baseYear, qNorm * 3, 1)),
        end:   iso(new Date(baseYear, qNorm * 3 + 3, 0)),
      }
    }
    case 'this_year':
      return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` }
    case 'last_year':
      return { start: `${today.getFullYear() - 1}-01-01`, end: `${today.getFullYear() - 1}-12-31` }
    case 'this_month':
    default:
      return { start: iso(startOfMonth(today)), end: iso(endOfMonth(today)) }
  }
}

interface Conta { id: string; nome: string; tipo: string; saldo: number; incluir_no_saldo: boolean }
interface BalancoMes { entradas: number; saidas: number; resultado: number; entradas_count: number; saidas_count: number }
interface TopDespesa { categoria: string; total: number; count: number; pct: number }

interface DashboardData {
  view: ViewMode
  period: { start: string; end: string; label: string }
  contas: Conta[]
  saldo_total: number
  saldo_investimentos?: number
  saldo_poupanca?: number
  contas_inclusas?: number
  contas_excluidas?: number
  balanco_mes: BalancoMes
  top_despesas: TopDespesa[]
  generated_at: string
}

const TIPO_LABEL: Record<string, string> = {
  conta_corrente: 'Conta corrente',
  banco: 'Conta corrente',  // legado
  investimento: 'Conta de investimento',
  poupanca: 'Conta poupança',
  cartao_credito: 'Cartão de crédito',
  cartao: 'Cartão',  // legado
  carteira: 'Carteira',
  outros: 'Outros',
}

function tipoLabel(tipo: string): string {
  return TIPO_LABEL[tipo] || tipo
}

function DashboardInner() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const [view, setView] = useState<ViewMode>('caixa')
  const [period, setPeriod] = useState<DateParam>({ date_preset: 'this_month' })
  const [periodLabel, setPeriodLabel] = useState<string>('Mês atual')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [showOcultas, setShowOcultas] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const callFn = useCallback(async (body: object) => {
    const s = getSession()
    if (!s) return { error: 'Sessão expirada. Faça login novamente.' }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetchWithRetry(
        `${SURL}/functions/v1/financeiro-agent`,
        { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), signal: controller.signal, cache: 'no-store' },
        2,
      )
      const text = await res.text()
      let resp: any = null
      try { resp = text ? JSON.parse(text) : null }
      catch { return { error: `Resposta inválida (${res.status}).` } }
      if (!resp) return { error: res.ok ? 'Servidor não respondeu.' : `Erro ${res.status}.` }
      if (!res.ok && !resp?.error) return { error: `Erro do servidor (${res.status}).` }
      return resp
    } catch (e: any) {
      if (e?.name === 'AbortError') return { error: 'Cancelado.' }
      return { error: 'Erro de conexão. Tente novamente.' }
    }
  }, [])

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    const flag = sessionStorage.getItem('fin_auth_ok')
    if (flag === '1') setAuthorized(true)
    else setShowAuthModal(true)
    setAuthChecked(true)
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    const { start, end } = resolveDateRange(period)
    const resp = await callFn({
      action: 'dashboard_resumo',
      view,
      period_start: start,
      period_end: end,
      period_label: periodLabel,
    })
    setLoading(false)
    if (resp?.error) {
      showMsg('err', resp.error)
      return
    }
    setData(resp as DashboardData)
  }, [callFn, view, period, periodLabel])

  const onPeriodApply = useCallback((dp: DateParam, label: string) => {
    setPeriod(dp)
    setPeriodLabel(label)
  }, [])

  const toggleSaldo = useCallback(async (accountId: string, currentlyIncluded: boolean) => {
    // Otimista: atualiza UI antes da resposta
    setData((prev) => {
      if (!prev) return prev
      const newContas = prev.contas.map((c) =>
        c.id === accountId ? { ...c, incluir_no_saldo: !currentlyIncluded } : c,
      )
      const newSaldo = newContas.filter((c) => c.incluir_no_saldo).reduce((s, c) => s + c.saldo, 0)
      return { ...prev, contas: newContas, saldo_total: newSaldo }
    })
    const resp = await callFn({ action: 'dashboard_toggle_saldo', account_id: accountId, incluir: !currentlyIncluded })
    if (resp?.error) {
      showMsg('err', `Falha ao atualizar conta: ${resp.error}`)
      // Reverte
      void load()
    }
  }, [callFn, load])

  useEffect(() => {
    if (!authorized) return
    void load()
  }, [authorized, load])

  if (!authChecked) return <NGPLoading loading loadingText="Verificando acesso..." />

  if (!authorized) {
    return (
      <FinanceiroAuthModal
        onClose={() => router.replace('/setores')}
        onSuccess={() => {
          sessionStorage.setItem('fin_auth_ok', '1')
          setAuthorized(true)
          setShowAuthModal(false)
        }}
      />
    )
  }

  const balanco = data?.balanco_mes
  const totalBar = balanco ? Math.max(balanco.entradas, balanco.saidas) || 1 : 1

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Dashboard</h1>
            <p className={styles.subtitle}>
              {data?.period ? `Mês: ${data.period.label}` : 'Resumo do mês corrente'} ·{' '}
              <strong>{view === 'competencia' ? 'Competência (DRE)' : 'Caixa (Pagos)'}</strong>
            </p>
          </div>
          <div className={styles.headerActions}>
            <PeriodFilter onApply={onPeriodApply} />
            <div className={styles.viewToggle} role="tablist">
              <button
                role="tab"
                aria-selected={view === 'competencia'}
                className={`${styles.viewToggleBtn} ${view === 'competencia' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setView('competencia')}
                disabled={loading}
              >
                Competência
              </button>
              <button
                role="tab"
                aria-selected={view === 'caixa'}
                className={`${styles.viewToggleBtn} ${view === 'caixa' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setView('caixa')}
                disabled={loading}
              >
                Caixa
              </button>
            </div>
            <button className={styles.btnRefresh} onClick={() => void load()} disabled={loading} title="Atualizar">
              {loading ? '⏳' : '↻'}
            </button>
          </div>
        </header>

        {msg && (
          <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>
            {msg.text}
          </div>
        )}

        {!data && !loading && (
          <div className={styles.empty}>Sem dados para mostrar.</div>
        )}

        {data && (
          <div className={styles.grid}>
            {/* Saldo Total + breakdown */}
            <section className={`${styles.card} ${styles.cardSaldoTotal}`}>
              <div className={styles.saldoMain}>
                <span className={styles.cardLabel}>Saldo em conta corrente</span>
                <span className={`${styles.cardSaldoValue} ${data.saldo_total >= 0 ? styles.posValue : styles.negValue}`}>
                  {fmtBRL(data.saldo_total)}
                </span>
                <span className={styles.cardCaption}>
                  {data.contas_inclusas} {data.contas_inclusas === 1 ? 'conta corrente ativa' : 'contas correntes ativas'}
                </span>
              </div>
              {((data.saldo_investimentos ?? 0) !== 0 || (data.saldo_poupanca ?? 0) !== 0) && (
                <div className={styles.saldoBreakdown}>
                  {(data.saldo_investimentos ?? 0) !== 0 && (
                    <div className={styles.saldoBreakItem}>
                      <span className={styles.saldoBreakLabel}>Investimentos</span>
                      <span className={styles.saldoBreakValue}>{fmtBRL(data.saldo_investimentos ?? 0)}</span>
                    </div>
                  )}
                  {(data.saldo_poupanca ?? 0) !== 0 && (
                    <div className={styles.saldoBreakItem}>
                      <span className={styles.saldoBreakLabel}>Poupança</span>
                      <span className={styles.saldoBreakValue}>{fmtBRL(data.saldo_poupanca ?? 0)}</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Balanço do mês */}
            <section className={`${styles.card} ${styles.cardBalanco}`}>
              <h2 className={styles.cardTitle}>Balanço do mês</h2>
              {balanco && (
                <>
                  <div className={styles.balancoRow}>
                    <div className={styles.balancoLabelRow}>
                      <span className={styles.balancoLabel}>Entradas</span>
                      <span className={styles.balancoValue}>{fmtBRL(balanco.entradas)}</span>
                    </div>
                    <div className={styles.balancoBarWrap}>
                      <div className={`${styles.balancoBar} ${styles.barEntrada}`} style={{ width: `${(balanco.entradas / totalBar) * 100}%` }} />
                    </div>
                  </div>
                  <div className={styles.balancoRow}>
                    <div className={styles.balancoLabelRow}>
                      <span className={styles.balancoLabel}>Saídas</span>
                      <span className={styles.balancoValue}>{fmtBRL(balanco.saidas)}</span>
                    </div>
                    <div className={styles.balancoBarWrap}>
                      <div className={`${styles.balancoBar} ${styles.barSaida}`} style={{ width: `${(balanco.saidas / totalBar) * 100}%` }} />
                    </div>
                  </div>
                  <div className={styles.balancoResultado}>
                    <span className={styles.balancoLabel}>Resultado</span>
                    <span className={`${styles.balancoResultadoValue} ${balanco.resultado >= 0 ? styles.posValue : styles.negValue}`}>
                      {fmtBRL(balanco.resultado)}
                    </span>
                  </div>
                  <div className={styles.balancoMeta}>
                    {balanco.entradas_count} entradas · {balanco.saidas_count} saídas (sem transferências internas)
                  </div>
                </>
              )}
            </section>

            {/* Top despesas */}
            <section className={`${styles.card} ${styles.cardTopDespesas}`}>
              <h2 className={styles.cardTitle}>Top despesas do mês</h2>
              {data.top_despesas.length === 0 ? (
                <p className={styles.cardEmpty}>Sem despesas neste mês.</p>
              ) : (
                <ol className={styles.topList}>
                  {data.top_despesas.map((t, i) => (
                    <li key={i} className={styles.topItem}>
                      <span className={styles.topRank}>{i + 1}</span>
                      <div className={styles.topMain}>
                        <div className={styles.topRow}>
                          <span className={styles.topCat}>{t.categoria}</span>
                          <span className={styles.topVal}>{fmtBRLCompact(t.total)}</span>
                        </div>
                        <div className={styles.topBarWrap}>
                          <div className={styles.topBar} style={{ width: `${t.pct * 100}%` }} />
                          <span className={styles.topPct}>{(t.pct * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Saldos por conta — visíveis em primeiro plano, ocultas em accordion */}
            {(() => {
              const visiveis = data.contas.filter(c => c.incluir_no_saldo)
              const ocultas = data.contas.filter(c => !c.incluir_no_saldo)
              const renderItem = (c: Conta) => (
                <div
                  key={c.id}
                  className={`${styles.contaItem} ${!c.incluir_no_saldo ? styles.contaOculta : ''}`}
                >
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    onClick={() => void toggleSaldo(c.id, c.incluir_no_saldo)}
                    title={c.incluir_no_saldo ? 'Excluir do saldo geral' : 'Incluir no saldo geral'}
                    aria-label={c.incluir_no_saldo ? 'Excluir do saldo geral' : 'Incluir no saldo geral'}
                  >
                    {c.incluir_no_saldo ? '👁' : '🚫'}
                  </button>
                  <div className={styles.contaLeft}>
                    <span className={styles.contaNome}>{c.nome}</span>
                    <span className={styles.contaTipo}>
                      {tipoLabel(c.tipo)}
                      {!c.incluir_no_saldo && ' · fora do saldo'}
                    </span>
                  </div>
                  <span className={`${styles.contaSaldo} ${c.saldo >= 0 ? styles.posValue : styles.negValue}`}>
                    {fmtBRL(c.saldo)}
                  </span>
                </div>
              )
              return (
                <section className={`${styles.card} ${styles.cardContas}`}>
                  <h2 className={styles.cardTitle}>
                    Saldos das contas
                    {ocultas.length > 0 && (
                      <span className={styles.cardTitleHint}>
                        {visiveis.length} no saldo · {ocultas.length} oculta{ocultas.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </h2>
                  <div className={styles.contasList}>
                    {visiveis.map(renderItem)}
                  </div>
                  {ocultas.length > 0 && (
                    <div className={styles.ocultasBlock}>
                      <button
                        type="button"
                        className={styles.ocultasToggle}
                        onClick={() => setShowOcultas(s => !s)}
                        aria-expanded={showOcultas}
                      >
                        <span>{showOcultas ? '▾' : '▸'}</span>
                        <span>Contas ocultas ({ocultas.length})</span>
                      </button>
                      {showOcultas && (
                        <div className={styles.contasList}>
                          {ocultas.map(renderItem)}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )
            })()}
          </div>
        )}

        {data && (
          <footer className={styles.footer}>
            Atualizado em {new Date(data.generated_at).toLocaleString('pt-BR')}
          </footer>
        )}
      </main>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando dashboard..." />}>
      <DashboardInner />
    </Suspense>
  )
}
