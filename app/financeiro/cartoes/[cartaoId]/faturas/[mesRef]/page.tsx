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
import { financeiroNav } from '../../../../financeiro-nav'
import { fmtBRL } from '@/lib/financeiro-analista'
import styles from '../../../cartoes.module.css'
import detStyles from './fatura.module.css'

interface Lancamento {
  id: string
  tipo: 'entrada' | 'saida' | 'transferencia'
  descricao: string
  valor: number
  status: 'confirmado' | 'pendente' | 'cancelado'
  competence_date: string
  payment_date: string | null
  installment_index: number | null
  installment_total: number | null
  categoria: { id: string; nome: string; cor: string } | null
  fornecedor: { id: string; nome: string } | null
}

interface PagamentoFatura {
  id: string
  valor: number
  paid_at: string
  observacoes: string | null
  transacao_id: string | null
  account_nome: string | null
}

interface ContaBancaria { id: string; nome: string; tipo: string }

function todayISO() { return new Date().toISOString().slice(0, 10) }

function parseCurrency(input: string): number | null {
  const cleaned = String(input || '').trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return n
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

function FaturaDetalheInner() {
  const router = useRouter()
  const params = useParams<{ cartaoId: string; mesRef: string }>()
  const cartaoId = params?.cartaoId
  const mesRef = params?.mesRef

  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  const [data, setData] = useState<any>(null)
  const [pagamentos, setPagamentos] = useState<PagamentoFatura[]>([])
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Modal registrar pagamento.
  const [pagarOpen, setPagarOpen] = useState(false)
  const [pagarContaId, setPagarContaId] = useState('')
  const [pagarValor, setPagarValor] = useState('')
  const [pagarData, setPagarData] = useState(todayISO())
  const [pagarSaving, setPagarSaving] = useState(false)

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
    if (!cartaoId || !mesRef) return
    setLoading(true)
    const [resp, contasResp, pagsResp] = await Promise.all([
      callFn('financeiro-agent', { action: 'cartoes_fatura_detalhe', cartao_id: cartaoId, mes_ref: mesRef }),
      callFn('financeiro-aux', { entity: 'accounts', action: 'listar' }),
      callFn('financeiro-agent', { action: 'cartoes_fatura_pagamentos_listar', cartao_id: cartaoId, mes_ref: mesRef }),
    ])
    setLoading(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    setData(resp)
    setPagamentos(pagsResp?.pagamentos || [])
    if (contasResp?.accounts) {
      setContas((contasResp.accounts as any[]).filter((a) =>
        a.ativo !== false && a.incluir_no_saldo !== false && ['banco', 'conta_corrente', 'carteira'].includes(a.tipo),
      ))
    }
  }, [cartaoId, mesRef])

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

  const totalPago = pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0)
  const saldoDevedor = Math.max(0, Number(data?.valor_fatura || 0) - totalPago)
  const status: 'aberta' | 'parcial' | 'paga' = totalPago <= 0
    ? 'aberta'
    : saldoDevedor < 0.005 ? 'paga' : 'parcial'

  function abrirPagar() {
    if (!data) return
    setPagarContaId('')
    setPagarValor(saldoDevedor > 0 ? saldoDevedor.toFixed(2).replace('.', ',') : '')
    // Default da data: vencimento da fatura (mais útil para faturas retroativas)
    setPagarData(data.vencimento || todayISO())
    setPagarOpen(true)
  }

  async function salvarPagamento(e: React.FormEvent) {
    e.preventDefault()
    if (!pagarContaId) { showMsg('err', 'Selecione a conta de pagamento.'); return }
    const valor = parseCurrency(pagarValor)
    if (valor == null || valor <= 0) { showMsg('err', 'Valor inválido.'); return }
    setPagarSaving(true)
    const resp = await callFn('financeiro-agent', {
      action: 'cartoes_fatura_registrar_pagamento',
      cartao_id: cartaoId,
      mes_ref: mesRef,
      paid_account_id: pagarContaId,
      paid_at: pagarData,
      valor,
    })
    setPagarSaving(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    showMsg('ok', 'Pagamento registrado!')
    setPagarOpen(false)
    void load()
  }

  async function removerPagamento(pagamentoId: string) {
    if (!confirm('Remover este pagamento? A transação correspondente também será excluída.')) return
    const resp = await callFn('financeiro-agent', {
      action: 'cartoes_fatura_remover_pagamento',
      pagamento_id: pagamentoId,
    })
    if (resp?.error) { showMsg('err', resp.error); return }
    showMsg('ok', 'Pagamento removido.')
    void load()
  }

  const lancamentos: Lancamento[] = data?.lancamentos || []

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <header className={detStyles.head}>
          <Link href={`/financeiro/cartoes/${cartaoId}/faturas`} className={detStyles.back}>← Voltar</Link>
          <div className={detStyles.headTitle}>
            <h1 className={styles.title}>Fatura de {data?.label || '...'}</h1>
            <p className={styles.subtitle}>{data?.cartao?.nome || ''}</p>
          </div>
          <div className={detStyles.headActions}>
            {!loading && data && (
              <button
                className={detStyles.btnPrimary}
                onClick={abrirPagar}
                disabled={status === 'paga' || (data.valor_fatura || 0) <= 0}
                title={status === 'paga' ? 'Fatura já quitada' : 'Registrar pagamento'}
              >
                {status === 'parcial' ? `Pagar saldo (${fmtBRL(saldoDevedor)})` : 'Registrar pagamento'}
              </button>
            )}
          </div>
        </header>

        {msg && (
          <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>{msg.text}</div>
        )}

        {data && (
          <section className={detStyles.summary}>
            <div className={detStyles.summaryItem}>
              <span className={detStyles.summaryLabel}>Saldo fatura anterior</span>
              <span className={detStyles.summaryValue}>{fmtBRL(data.saldo_anterior || 0)}</span>
            </div>
            <div className={detStyles.summaryItem}>
              <span className={detStyles.summaryLabel}>Fatura do mês</span>
              <span className={detStyles.summaryValue}>{fmtBRL(data.valor_fatura || 0)}</span>
            </div>
            <div className={detStyles.summaryItem}>
              <span className={detStyles.summaryLabel}>Pago</span>
              <span className={detStyles.summaryValue}>{fmtBRL(totalPago)}</span>
            </div>
            <div className={detStyles.summaryItem}>
              <span className={detStyles.summaryLabel}>Vencimento</span>
              <span className={detStyles.summaryValue}>
                {data.vencimento ? new Date(data.vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
              </span>
            </div>
            <div className={detStyles.summaryItem}>
              <span className={detStyles.summaryLabel}>Situação</span>
              <span className={detStyles.summaryValue}>
                {status === 'paga' && <span className={detStyles.tagPaga}>Paga</span>}
                {status === 'parcial' && <span className={detStyles.tagParcial}>Parcial</span>}
                {status === 'aberta' && <span className={detStyles.tagAberta}>Em aberto</span>}
              </span>
            </div>
          </section>
        )}

        {/* Lista de pagamentos registrados ─────────────────────────────────── */}
        {pagamentos.length > 0 && (
          <section className={detStyles.pagCard} style={{ marginTop: 16 }}>
            <div className={detStyles.pagHead}>
              <h2 className={detStyles.pagTitle}>{pagamentos.length} pagamento{pagamentos.length !== 1 ? 's' : ''} registrado{pagamentos.length !== 1 ? 's' : ''}</h2>
            </div>
            <ul className={detStyles.pagList}>
              {pagamentos.map(p => (
                <li key={p.id} className={detStyles.pagItem}>
                  <span className={detStyles.pagData}>
                    {new Date(p.paid_at + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </span>
                  <span className={detStyles.pagConta}>{p.account_nome || '—'}</span>
                  <span className={detStyles.pagValor}>{fmtBRL(p.valor)}</span>
                  <button
                    type="button"
                    className={detStyles.pagRemover}
                    onClick={() => void removerPagamento(p.id)}
                    title="Remover este pagamento"
                  >×</button>
                </li>
              ))}
            </ul>
            <div className={detStyles.pagSaldo}>
              Total pago: <strong>{fmtBRL(totalPago)}</strong>
              {' · '}
              Saldo devedor: <strong>{fmtBRL(saldoDevedor)}</strong>
            </div>
          </section>
        )}

        <section className={detStyles.lancCard} style={{ marginTop: 16 }}>
          <div className={detStyles.lancHead}>
            <h2 className={detStyles.lancTitle}>{lancamentos.length} lançamentos</h2>
            <Link
              href={`/financeiro/cartoes?nova=${cartaoId}`}
              className={detStyles.btnNovo}
            >+ Novo lançamento</Link>
          </div>

          {loading ? (
            <div className={detStyles.empty}>Carregando...</div>
          ) : lancamentos.length === 0 ? (
            <div className={detStyles.empty}>Nenhum lançamento nesta fatura.</div>
          ) : (
            <table className={detStyles.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th>Parcela</th>
                  <th className={detStyles.right}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map(l => (
                  <tr key={l.id}>
                    <td>{new Date(l.competence_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>{l.descricao}</td>
                    <td>
                      {l.categoria ? (
                        <span className={detStyles.catTag}>
                          <span className={detStyles.catDot} style={{ background: l.categoria.cor }} />
                          {l.categoria.nome}
                        </span>
                      ) : '—'}
                    </td>
                    <td>{l.installment_total ? `${l.installment_index}/${l.installment_total}` : '—'}</td>
                    <td className={`${detStyles.right} ${l.tipo === 'saida' ? detStyles.negValor : detStyles.posValor}`}>
                      {l.tipo === 'saida' ? '-' : '+'}{fmtBRL(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {pagarOpen && (
        <div className={styles.modalOverlay} onClick={() => setPagarOpen(false)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3 className={styles.modalTitle}>Registrar pagamento</h3>
              <span className={styles.modalSub}>
                {data?.label} · {data?.cartao?.nome}
                {saldoDevedor > 0 && ` · Saldo: ${fmtBRL(saldoDevedor)}`}
              </span>
            </div>
            <form onSubmit={salvarPagamento} className={styles.modalForm}>
              <div className={styles.formField}>
                <label>Conta de pagamento *</label>
                <select value={pagarContaId} onChange={e => setPagarContaId(e.target.value)} required>
                  <option value="">Selecione...</option>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Data do pagamento *</label>
                  <input type="date" value={pagarData} onChange={e => setPagarData(e.target.value)} required />
                </div>
                <div className={styles.formField}>
                  <label>Valor pago (R$) *</label>
                  <input value={pagarValor} onChange={e => setPagarValor(e.target.value)} placeholder="0,00" required />
                </div>
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setPagarOpen(false)}>Cancelar</button>
                <button type="submit" className={styles.btnSave} disabled={pagarSaving}>
                  {pagarSaving ? 'Salvando...' : 'Confirmar pagamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FaturaDetalhePage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando fatura..." />}>
      <FaturaDetalheInner />
    </Suspense>
  )
}
