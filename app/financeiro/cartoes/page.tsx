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
import { fmtBRL } from '@/lib/financeiro-analista'
import styles from './cartoes.module.css'

interface Cartao {
  id: string
  nome: string
  ativo: boolean
  limite_credito: number | null
  dia_fechamento: number | null
  dia_vencimento: number | null
  fatura_atual: number
  fatura_pendente: number
  fatura_total: number
  limite_disponivel: number | null
  fatura_periodo: { start: string; end: string; label: string }
}

function CartoesInner() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
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
      return { error: 'Erro de conexão.' }
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
    const resp = await callFn({ action: 'cartoes_listar' })
    setLoading(false)
    if (resp?.error) {
      showMsg('err', resp.error)
      return
    }
    setCartoes(resp?.cartoes || [])
  }, [callFn])

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

  const ativos = cartoes.filter((c) => c.ativo)
  const desativados = cartoes.filter((c) => !c.ativo)

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Cartões de crédito</h1>
            <p className={styles.subtitle}>Limite, fatura atual e disponível de cada cartão.</p>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.btnAdd}
              disabled
              title="Cadastro de novos cartões via SQL por enquanto"
            >
              + adicionar
            </button>
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

        {!loading && cartoes.length === 0 && (
          <div className={styles.empty}>
            Nenhum cartão de crédito cadastrado.
            <br />
            Use a aba <strong>Bancos e Carteiras</strong> ou crie via SQL com <code>tipo=&apos;cartao_credito&apos;</code>.
          </div>
        )}

        {ativos.length > 0 && (
          <section className={styles.gridCartoes}>
            {ativos.map((c) => <CartaoCard key={c.id} c={c} />)}
          </section>
        )}

        {desativados.length > 0 && (
          <>
            <h2 className={styles.sectionTitle}>Cartões de crédito desativados</h2>
            <section className={styles.gridCartoes}>
              {desativados.map((c) => <CartaoCard key={c.id} c={c} muted />)}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function CartaoCard({ c, muted }: { c: Cartao; muted?: boolean }) {
  const semFechamento = !c.dia_fechamento
  const limiteDisp = c.limite_disponivel
  const limiteNeg = limiteDisp !== null && limiteDisp < 0
  return (
    <article className={`${styles.cartao} ${muted ? styles.cartaoMuted : ''}`}>
      <div className={styles.cartaoHead}>
        <div className={styles.cartaoIcon}>💳</div>
        <h3 className={styles.cartaoNome}>{c.nome}</h3>
      </div>

      <div className={styles.cartaoMetrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Limite disponível</span>
          <span className={`${styles.metricValue} ${limiteNeg ? styles.negValue : ''} ${limiteDisp === null ? styles.metricEmpty : ''}`}>
            {limiteDisp === null ? '—' : fmtBRL(limiteDisp)}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Fatura atual</span>
          <span className={styles.metricValue}>
            {fmtBRL(c.fatura_total)}
          </span>
          {c.fatura_pendente > 0 && (
            <span className={styles.metricSub}>
              {fmtBRL(c.fatura_atual)} confirmada · {fmtBRL(c.fatura_pendente)} pendente
            </span>
          )}
        </div>
      </div>

      <div className={styles.cartaoFoot}>
        {c.limite_credito !== null && (
          <span className={styles.cartaoFootItem}>
            Limite total: <strong>{fmtBRL(c.limite_credito)}</strong>
          </span>
        )}
        {c.dia_fechamento && (
          <span className={styles.cartaoFootItem}>
            Fecha dia <strong>{c.dia_fechamento}</strong>
          </span>
        )}
        {c.dia_vencimento && (
          <span className={styles.cartaoFootItem}>
            Vence dia <strong>{c.dia_vencimento}</strong>
          </span>
        )}
        {semFechamento && !muted && (
          <span className={styles.cartaoWarning}>
            ⚠ Sem dia de fechamento — fatura considera o mês corrente
          </span>
        )}
      </div>
    </article>
  )
}

export default function CartoesPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando cartões..." />}>
      <CartoesInner />
    </Suspense>
  )
}
