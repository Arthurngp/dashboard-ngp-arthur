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
import { financeiroNav } from '../financeiro-nav'
import {
  parsePrevisao,
  parsePadroes,
  parseSaude,
  fmtBRL,
  fmtBRLCompact,
  fmtPct,
  confidenceLabel,
  saudeStatusLabel,
  type PrevisaoResult,
  type PadroesResult,
  type SaudeResult,
  type LacunasResult,
  type Confidence,
  type SaudeStatus,
} from '@/lib/financeiro-analista'
import styles from './analista.module.css'

interface Loaders {
  previsao: boolean
  padroes: boolean
  lacunas: boolean
  saude: boolean
}

interface Updated {
  previsao: string | null
  padroes: string | null
  lacunas: string | null
  saude: string | null
}

type ViewMode = 'competencia' | 'caixa'

function AnalistaInner() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [view, setView] = useState<ViewMode>('competencia')

  const [previsao, setPrevisao] = useState<PrevisaoResult | null>(null)
  const [padroes, setPadroes] = useState<PadroesResult | null>(null)
  const [saude, setSaude] = useState<SaudeResult | null>(null)
  const [lacunas, setLacunas] = useState<LacunasResult | null>(null)

  const [loading, setLoading] = useState<Loaders>({ previsao: false, padroes: false, lacunas: false, saude: false })
  const [updated, setUpdated] = useState<Updated>({ previsao: null, padroes: null, lacunas: null, saude: null })
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const abortRefs = useRef<Record<string, AbortController>>({})

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 5000)
  }

  const callFn = useCallback(async (body: object) => {
    const s = getSession()
    if (!s) return { error: 'Sessão expirada. Faça login novamente.' }
    const action = String((body as { action?: unknown }).action || '')
    const requestKey = `financeiro-agent:${action}`
    abortRefs.current[requestKey]?.abort()
    const controller = new AbortController()
    abortRefs.current[requestKey] = controller
    try {
      const res = await fetchWithRetry(
        `${SURL}/functions/v1/financeiro-agent`,
        { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), signal: controller.signal, cache: 'no-store' },
        1, // sem retry — OpenAI calls são caras
      )
      const text = await res.text()
      let data: any = null
      try { data = text ? JSON.parse(text) : null }
      catch { return { error: `Resposta inválida do servidor (status ${res.status}).` } }
      if (!data) return { error: res.ok ? 'Servidor não respondeu.' : `Erro ${res.status}.` }
      if (!res.ok && !data?.error) return { error: `Erro do servidor (${res.status}).` }
      return data
    } catch (e: any) {
      if (e?.name === 'AbortError') return { error: 'Operação cancelada.' }
      return { error: 'Erro de conexão. Tente novamente.' }
    } finally {
      if (abortRefs.current[requestKey] === controller) delete abortRefs.current[requestKey]
    }
  }, [])

  // Auth guard
  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    const flag = sessionStorage.getItem('fin_auth_ok')
    if (flag === '1') {
      setAuthorized(true)
    } else {
      setShowAuthModal(true)
    }
    setAuthChecked(true)
  }, [router])

  // Carrega últimas runs ao abrir (sem disparar IA)
  const loadLatest = useCallback(async () => {
    const data = await callFn({ action: 'analista_carregar_ultima' })
    if (data?.error) {
      showMsg('err', data.error)
      return
    }
    const latest = data?.latest || {}
    if (latest.analista_previsao?.response) {
      const p = parsePrevisao(latest.analista_previsao.response)
      if (p) {
        setPrevisao(p)
        setUpdated((u) => ({ ...u, previsao: latest.analista_previsao.created_at }))
      }
    }
    if (latest.analista_padroes?.response) {
      const p = parsePadroes(latest.analista_padroes.response)
      if (p) {
        setPadroes(p)
        setUpdated((u) => ({ ...u, padroes: latest.analista_padroes.created_at }))
      }
    }
    if (latest.analista_saude?.response) {
      const p = parseSaude(latest.analista_saude.response)
      if (p) {
        setSaude(p)
        setUpdated((u) => ({ ...u, saude: latest.analista_saude.created_at }))
      }
    }
  }, [callFn])

  // Lacunas é sempre fresca (consulta SQL rápida)
  const refreshLacunas = useCallback(async () => {
    setLoading((l) => ({ ...l, lacunas: true }))
    const data = await callFn({ action: 'analista_lacunas' })
    setLoading((l) => ({ ...l, lacunas: false }))
    if (data?.error) {
      showMsg('err', `Lacunas: ${data.error}`)
      return
    }
    if (data?.lacunas) {
      setLacunas(data.lacunas)
      setUpdated((u) => ({ ...u, lacunas: data.lacunas.computed_at }))
    }
  }, [callFn])

  useEffect(() => {
    if (!authorized) return
    void loadLatest()
    void refreshLacunas()
  }, [authorized, loadLatest, refreshLacunas])

  const refreshPrevisao = useCallback(async () => {
    setLoading((l) => ({ ...l, previsao: true }))
    const data = await callFn({ action: 'analista_previsao', view })
    setLoading((l) => ({ ...l, previsao: false }))
    if (data?.error) {
      showMsg('err', `Previsão: ${data.error}`)
      return
    }
    if (data?.status === 'fallback') {
      showMsg('err', 'A IA não respondeu para Previsão. Verifique a chave OpenAI.')
      return
    }
    const parsed = parsePrevisao(data?.response)
    if (parsed) {
      setPrevisao(parsed)
      setUpdated((u) => ({ ...u, previsao: data.created_at || new Date().toISOString() }))
    } else {
      showMsg('err', 'Previsão: resposta da IA em formato inválido.')
    }
  }, [callFn, view])

  const refreshPadroes = useCallback(async () => {
    setLoading((l) => ({ ...l, padroes: true }))
    const data = await callFn({ action: 'analista_padroes', view })
    setLoading((l) => ({ ...l, padroes: false }))
    if (data?.error) {
      showMsg('err', `Padrões: ${data.error}`)
      return
    }
    if (data?.status === 'fallback') {
      showMsg('err', 'A IA não respondeu para Padrões. Verifique a chave OpenAI.')
      return
    }
    const parsed = parsePadroes(data?.response)
    if (parsed) {
      setPadroes(parsed)
      setUpdated((u) => ({ ...u, padroes: data.created_at || new Date().toISOString() }))
    } else {
      showMsg('err', 'Padrões: resposta da IA em formato inválido.')
    }
  }, [callFn, view])

  const refreshSaude = useCallback(async () => {
    setLoading((l) => ({ ...l, saude: true }))
    const data = await callFn({ action: 'analista_saude', view })
    setLoading((l) => ({ ...l, saude: false }))
    if (data?.error) {
      showMsg('err', `Saúde: ${data.error}`)
      return
    }
    if (data?.status === 'fallback') {
      showMsg('err', 'A IA não respondeu para Saúde. Verifique a chave OpenAI.')
      return
    }
    const parsed = parseSaude(data?.response)
    if (parsed) {
      setSaude(parsed)
      setUpdated((u) => ({ ...u, saude: data.created_at || new Date().toISOString() }))
    } else {
      showMsg('err', 'Saúde: resposta da IA em formato inválido.')
    }
  }, [callFn, view])

  const refreshAll = useCallback(async () => {
    showMsg('ok', 'Atualizando análise completa... (10-20s)')
    await Promise.all([
      refreshPrevisao(),
      refreshPadroes(),
      refreshSaude(),
      refreshLacunas(),
    ])
  }, [refreshPrevisao, refreshPadroes, refreshSaude, refreshLacunas])

  const anyLoading = loading.previsao || loading.padroes || loading.saude || loading.lacunas

  // Consolidated next actions across all 4 cards
  const consolidatedActions: { from: string; text: string }[] = []
  if (previsao) previsao.next_actions.forEach((a) => consolidatedActions.push({ from: 'Previsão', text: a }))
  if (padroes) padroes.next_actions.forEach((a) => consolidatedActions.push({ from: 'Padrões', text: a }))
  if (saude) saude.next_actions.forEach((a) => consolidatedActions.push({ from: 'Saúde', text: a }))

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

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Analista IA · Financeiro</h1>
            <p className={styles.subtitle}>
              Diagnóstico inteligente do caixa, padrões e projeções dos próximos meses.{' '}
              <strong>Regime atual: {view === 'competencia' ? 'Competência (DRE)' : 'Caixa (Pagos)'}</strong>
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.viewToggle} role="tablist" aria-label="Regime contábil">
              <button
                role="tab"
                aria-selected={view === 'competencia'}
                className={`${styles.viewToggleBtn} ${view === 'competencia' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setView('competencia')}
                disabled={anyLoading}
              >
                Competência (DRE)
              </button>
              <button
                role="tab"
                aria-selected={view === 'caixa'}
                className={`${styles.viewToggleBtn} ${view === 'caixa' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setView('caixa')}
                disabled={anyLoading}
              >
                Caixa (Pagos)
              </button>
            </div>
            <button
              className={styles.btnPrimary}
              onClick={() => void refreshAll()}
              disabled={anyLoading}
            >
              {anyLoading ? '⏳ Analisando...' : '⚡ Atualizar análise completa'}
            </button>
          </div>
        </header>

        {msg && (
          <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>
            {msg.text}
          </div>
        )}

        <div className={styles.grid}>
          <CardPrevisao result={previsao} loading={loading.previsao} updated={updated.previsao} onRefresh={refreshPrevisao} />
          <CardPadroes result={padroes} loading={loading.padroes} updated={updated.padroes} onRefresh={refreshPadroes} />
          <CardLacunas result={lacunas} loading={loading.lacunas} updated={updated.lacunas} onRefresh={refreshLacunas} />
          <CardSaude result={saude} loading={loading.saude} updated={updated.saude} onRefresh={refreshSaude} />
        </div>

        {consolidatedActions.length > 0 && (
          <section className={styles.actionsSection}>
            <h2 className={styles.actionsTitle}>📋 Próximas ações sugeridas</h2>
            <ul className={styles.actionsList}>
              {consolidatedActions.map((a, i) => (
                <li key={i} className={styles.actionItem}>
                  <span className={styles.actionFrom}>{a.from}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className={styles.footer}>
          <span>Análises geradas por OpenAI a partir de dados reais do banco. Cada clique consome ~$0.01 em créditos.</span>
        </footer>
      </main>
    </div>
  )
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function fmtUpdated(iso: string | null): string {
  if (!iso) return 'Nunca atualizado'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Agora mesmo'
  if (minutes < 60) return `há ${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days}d`
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const cls = confidence === 'high' ? styles.badgeHigh : confidence === 'medium' ? styles.badgeMedium : styles.badgeLow
  return <span className={`${styles.badge} ${cls}`}>Confiança {confidenceLabel(confidence)}</span>
}

function StatusBadge({ status }: { status: SaudeStatus }) {
  const cls = status === 'healthy' ? styles.badgeHealthy : status === 'warning' ? styles.badgeWarning : styles.badgeCritical
  return <span className={`${styles.badge} ${cls}`}>{saudeStatusLabel(status)}</span>
}

function CardEmpty({ icon, title, hint, loading, onRefresh }: { icon: string; title: string; hint: string; loading: boolean; onRefresh: () => void }) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{icon} {title}</h3>
      </div>
      <div className={styles.cardEmpty}>
        <p>{hint}</p>
        <button className={styles.btnSecondary} onClick={onRefresh} disabled={loading}>
          {loading ? '⏳ Analisando...' : 'Gerar análise'}
        </button>
      </div>
    </article>
  )
}

function CardHeader({ icon, title, updated, loading, onRefresh }: { icon: string; title: string; updated: string | null; loading: boolean; onRefresh: () => void }) {
  return (
    <div className={styles.cardHead}>
      <h3 className={styles.cardTitle}>{icon} {title}</h3>
      <div className={styles.cardMeta}>
        <span className={styles.cardUpdated}>{fmtUpdated(updated)}</span>
        <button className={styles.btnIcon} onClick={onRefresh} disabled={loading} title="Atualizar este card">
          {loading ? '⏳' : '↻'}
        </button>
      </div>
    </div>
  )
}

function CardPrevisao({ result, loading, updated, onRefresh }: { result: PrevisaoResult | null; loading: boolean; updated: string | null; onRefresh: () => void }) {
  if (!result) return <CardEmpty icon="🔮" title="Previsão de Faturamento" hint="3 meses à frente — receita projetada, drivers e riscos." loading={loading} onRefresh={onRefresh} />
  return (
    <article className={styles.card}>
      <CardHeader icon="🔮" title="Previsão de Faturamento (3m)" updated={updated} loading={loading} onRefresh={onRefresh} />
      <div className={styles.cardBody}>
        <div className={styles.bigNumber}>{fmtBRLCompact(result.projected_3m_total)}</div>
        <p className={styles.bigNumberCaption}>projetado nos próximos 3 meses</p>

        <p className={styles.diagnosis}>{result.diagnosis}</p>

        {result.monthly_breakdown.length > 0 && (
          <table className={styles.miniTable}>
            <thead>
              <tr><th>Mês</th><th>Receita</th><th>Despesa</th><th>Líquido</th></tr>
            </thead>
            <tbody>
              {result.monthly_breakdown.map((m, i) => (
                <tr key={i}>
                  <td>{m.month_label}</td>
                  <td className={styles.tdEntrada}>{fmtBRLCompact(m.projected_revenue)}</td>
                  <td className={styles.tdSaida}>{fmtBRLCompact(m.projected_expense)}</td>
                  <td className={m.projected_net >= 0 ? styles.tdEntrada : styles.tdSaida}>{fmtBRLCompact(m.projected_net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {result.drivers.length > 0 && <Section title="O que sustenta a previsão" items={result.drivers} />}
        {result.risks.length > 0 && <Section title="Riscos para a previsão" items={result.risks} tone="warn" />}
        {result.data_gaps.length > 0 && <Section title="O que melhoraria a precisão" items={result.data_gaps} tone="info" />}
      </div>
      <div className={styles.cardFoot}>
        <ConfidenceBadge confidence={result.confidence} />
      </div>
    </article>
  )
}

function CardPadroes({ result, loading, updated, onRefresh }: { result: PadroesResult | null; loading: boolean; updated: string | null; onRefresh: () => void }) {
  if (!result) return <CardEmpty icon="📊" title="Padrões e Gargalos" hint="Tendências dos últimos 6 meses, hotspots de gastos e anomalias." loading={loading} onRefresh={onRefresh} />
  return (
    <article className={styles.card}>
      <CardHeader icon="📊" title="Padrões e Gargalos" updated={updated} loading={loading} onRefresh={onRefresh} />
      <div className={styles.cardBody}>
        <p className={styles.headline}>{result.headline}</p>
        <p className={styles.diagnosis}>{result.diagnosis}</p>

        {result.trends.length > 0 && <Section title="Tendências" items={result.trends} />}
        {result.hotspots.length > 0 && <Section title="Onde está saindo o dinheiro" items={result.hotspots} tone="warn" />}
        {result.anomalies.length > 0 && <Section title="Anomalias detectadas" items={result.anomalies} tone="bad" />}
      </div>
      <div className={styles.cardFoot}>
        <ConfidenceBadge confidence={result.confidence} />
      </div>
    </article>
  )
}

function CardLacunas({ result, loading, updated, onRefresh }: { result: LacunasResult | null; loading: boolean; updated: string | null; onRefresh: () => void }) {
  if (!result) return <CardEmpty icon="🩹" title="Lacunas de Dados" hint="Quanto falta preencher para os relatórios ficarem confiáveis." loading={loading} onRefresh={onRefresh} />
  const items = [
    { label: 'Sem categoria', value: result.sem_categoria, tone: result.sem_categoria > 100 ? 'bad' : 'warn' },
    { label: 'Entradas sem cliente', value: result.entrada_sem_cliente, tone: result.entrada_sem_cliente > 100 ? 'bad' : 'warn' },
    { label: 'Saídas sem fornecedor', value: result.saida_sem_fornecedor, tone: result.saida_sem_fornecedor > 100 ? 'bad' : 'warn' },
    { label: 'Sem centro de custo', value: result.sem_centro_custo, tone: 'info' },
    { label: 'Valor zero', value: result.valor_zero, tone: result.valor_zero > 50 ? 'warn' : 'info' },
    { label: 'Data > 3 anos no futuro', value: result.data_muito_futura, tone: 'info' },
  ]
  return (
    <article className={styles.card}>
      <CardHeader icon="🩹" title="Lacunas de Dados" updated={updated} loading={loading} onRefresh={onRefresh} />
      <div className={styles.cardBody}>
        <p className={styles.diagnosis}>{result.impact_summary}</p>
        <div className={styles.lacunasGrid}>
          {items.map((it, i) => (
            <div key={i} className={`${styles.lacunaItem} ${it.tone === 'bad' ? styles.lacunaBad : it.tone === 'warn' ? styles.lacunaWarn : styles.lacunaInfo}`}>
              <span className={styles.lacunaValue}>{it.value.toLocaleString('pt-BR')}</span>
              <span className={styles.lacunaLabel}>{it.label}</span>
            </div>
          ))}
        </div>
        {result.contas_orfas.length > 0 && (
          <div className={styles.contasOrfas}>
            <strong>Contas ativas sem lançamentos:</strong> {result.contas_orfas.map((c) => c.nome).join(' · ')}
          </div>
        )}
        <div className={styles.lacunaFooter}>
          Total analisado: {result.total_transacoes.toLocaleString('pt-BR')} lançamentos
        </div>
      </div>
    </article>
  )
}

function CardSaude({ result, loading, updated, onRefresh }: { result: SaudeResult | null; loading: boolean; updated: string | null; onRefresh: () => void }) {
  if (!result) return <CardEmpty icon="❤️" title="Saúde Financeira" hint="Caixa atual, runway, taxa de queima e margem dos últimos 3 meses." loading={loading} onRefresh={onRefresh} />
  return (
    <article className={styles.card}>
      <CardHeader icon="❤️" title="Saúde Financeira" updated={updated} loading={loading} onRefresh={onRefresh} />
      <div className={styles.cardBody}>
        <div className={styles.saudeKpis}>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Receita média/mês</span>
            <span className={styles.kpiValue}>{fmtBRLCompact(result.monthly_revenue)}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Queima média/mês</span>
            <span className={styles.kpiValue}>{fmtBRLCompact(result.monthly_burn)}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Margem</span>
            <span className={`${styles.kpiValue} ${result.margin_pct >= 0 ? styles.kpiPos : styles.kpiNeg}`}>{fmtPct(result.margin_pct)}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Runway</span>
            <span className={styles.kpiValue}>
              {result.runway_months === null ? '∞' : `${result.runway_months.toFixed(1)} meses`}
            </span>
          </div>
        </div>
        <p className={styles.headline}>{result.headline}</p>
        <p className={styles.diagnosis}>{result.diagnosis}</p>

        {result.strengths.length > 0 && <Section title="Pontos fortes" items={result.strengths} tone="ok" />}
        {result.weaknesses.length > 0 && <Section title="Pontos de atenção" items={result.weaknesses} tone="warn" />}
      </div>
      <div className={styles.cardFoot}>
        <StatusBadge status={result.status} />
        <ConfidenceBadge confidence={result.confidence} />
      </div>
    </article>
  )
}

function Section({ title, items, tone }: { title: string; items: string[]; tone?: 'ok' | 'warn' | 'bad' | 'info' }) {
  if (items.length === 0) return null
  const cls = tone === 'ok' ? styles.sectionOk : tone === 'warn' ? styles.sectionWarn : tone === 'bad' ? styles.sectionBad : tone === 'info' ? styles.sectionInfo : ''
  return (
    <div className={`${styles.section} ${cls}`}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      <ul className={styles.sectionList}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

export default function AnalistaPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando analista..." />}>
      <AnalistaInner />
    </Suspense>
  )
}
