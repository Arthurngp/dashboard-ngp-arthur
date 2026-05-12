'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import { financeiroNav } from '../../../financeiro-nav'
import { fmtBRL } from '@/lib/financeiro-analista'
import styles from '../../cartoes.module.css'
import listStyles from './faturas.module.css'

interface FaturaResumo {
  mes_ref: string
  label: string
  valor: number
  status: 'aberta' | 'paga'
  valor_pago: number
  paid_at: string | null
}

interface CartaoInfo {
  id: string
  nome: string
  dia_fechamento: number | null
  dia_vencimento: number | null
  limite_credito: number | null
}

async function callFn(fn: string, body: object): Promise<any> {
  const s = getSession()
  if (!s) return { error: 'Sessão expirada.' }
  const res = await fetchWithRetry(
    `${SURL}/functions/v1/${fn}`,
    { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), cache: 'no-store' },
    2,
  )
  const text = await res.text()
  try { return text ? JSON.parse(text) : { error: 'Resposta vazia.' } } catch { return { error: `Erro ${res.status}.` } }
}

function FaturasInner() {
  const router = useRouter()
  const params = useParams<{ cartaoId: string }>()
  const cartaoId = params?.cartaoId

  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  const [ano, setAno] = useState(new Date().getFullYear())
  const [cartao, setCartao] = useState<CartaoInfo | null>(null)
  const [faturas, setFaturas] = useState<FaturaResumo[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    setAuthorized(sessionStorage.getItem('fin_auth_ok') === '1')
    setAuthChecked(true)
  }, [router])

  const load = useCallback(async () => {
    if (!cartaoId) return
    setLoading(true)
    const resp = await callFn('financeiro-agent', { action: 'cartoes_faturas_listar', cartao_id: cartaoId, ano })
    setLoading(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    setCartao(resp?.cartao || null)
    setFaturas(resp?.faturas || [])
  }, [cartaoId, ano])

  useEffect(() => {
    if (!authorized) return
    void load()
  }, [authorized, load])

  if (!authChecked) return <NGPLoading loading loadingText="Verificando acesso..." />
  if (!authorized) {
    return (
      <FinanceiroAuthModal
        onClose={() => router.replace('/setores')}
        onSuccess={() => { sessionStorage.setItem('fin_auth_ok', '1'); setAuthorized(true) }}
      />
    )
  }

  const totalAno = faturas.reduce((s, f) => s + f.valor, 0)
  const totalPago = faturas.filter(f => f.status === 'paga').reduce((s, f) => s + f.valor_pago, 0)

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <header className={listStyles.head}>
          <Link href="/financeiro/cartoes" className={listStyles.back}>← Voltar</Link>
          <div>
            <h1 className={styles.title}>{cartao?.nome || '...'}</h1>
            <p className={styles.subtitle}>Faturas do cartão</p>
          </div>
          <div className={listStyles.anoNav}>
            <button onClick={() => setAno(a => a - 1)} className={listStyles.anoBtn}>‹</button>
            <span className={listStyles.anoLabel}>{ano}</span>
            <button onClick={() => setAno(a => a + 1)} className={listStyles.anoBtn}>›</button>
          </div>
        </header>

        {msg && (
          <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>{msg.text}</div>
        )}

        {cartao && (
          <section className={listStyles.summary}>
            <div className={listStyles.summaryItem}>
              <span className={listStyles.summaryLabel}>Limite</span>
              <span className={listStyles.summaryValue}>{cartao.limite_credito != null ? fmtBRL(cartao.limite_credito) : '—'}</span>
            </div>
            <div className={listStyles.summaryItem}>
              <span className={listStyles.summaryLabel}>Fechamento</span>
              <span className={listStyles.summaryValue}>{cartao.dia_fechamento ? `Dia ${cartao.dia_fechamento}` : '—'}</span>
            </div>
            <div className={listStyles.summaryItem}>
              <span className={listStyles.summaryLabel}>Vencimento</span>
              <span className={listStyles.summaryValue}>{cartao.dia_vencimento ? `Dia ${cartao.dia_vencimento}` : '—'}</span>
            </div>
            <div className={listStyles.summaryItem}>
              <span className={listStyles.summaryLabel}>Total do ano</span>
              <span className={listStyles.summaryValue}>{fmtBRL(totalAno)}</span>
              {totalPago > 0 && <span className={listStyles.summarySub}>{fmtBRL(totalPago)} pago</span>}
            </div>
          </section>
        )}

        <section className={listStyles.tableWrap}>
          <table className={listStyles.table}>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Situação</th>
                <th className={listStyles.right}>Valor da fatura</th>
                <th className={listStyles.right}>Valor pago</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className={listStyles.loading}>Carregando...</td></tr>
              )}
              {!loading && faturas.map(f => (
                <tr key={f.mes_ref}>
                  <td className={listStyles.mesLabel}>{f.label}</td>
                  <td>
                    {f.status === 'paga' ? (
                      <span className={`${listStyles.statusBadge} ${listStyles.statusPaga}`}>Paga</span>
                    ) : f.valor > 0 ? (
                      <span className={`${listStyles.statusBadge} ${listStyles.statusAberta}`}>Em aberto</span>
                    ) : (
                      <span className={`${listStyles.statusBadge} ${listStyles.statusVazia}`}>Sem lançamentos</span>
                    )}
                  </td>
                  <td className={listStyles.right}>
                    <span className={f.valor > 0 ? listStyles.negValor : ''}>
                      {f.valor > 0 ? '-' : ''}{fmtBRL(Math.abs(f.valor))}
                    </span>
                  </td>
                  <td className={listStyles.right}>
                    {f.valor_pago > 0 ? fmtBRL(f.valor_pago) : '—'}
                  </td>
                  <td className={listStyles.right}>
                    <Link
                      href={`/financeiro/cartoes/${cartaoId}/faturas/${f.mes_ref}`}
                      className={listStyles.verFaturaBtn}
                    >Ver fatura</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}

export default function FaturasPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando faturas..." />}>
      <FaturasInner />
    </Suspense>
  )
}
