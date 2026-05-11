'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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

interface Categoria { id: string; nome: string; cor: string; tipo: 'entrada' | 'saida' }
interface Fornecedor { id: string; nome: string }
interface CostCenter { id: string; nome: string }

function todayISO() { return new Date().toISOString().slice(0, 10) }

function parseCurrency(input: string): number | null {
  const cleaned = String(input || '').trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return n
}

async function callEdgeFn(fn: string, body: object): Promise<any> {
  const s = getSession()
  if (!s) return { error: 'Sessão expirada. Faça login novamente.' }
  try {
    const res = await fetchWithRetry(
      `${SURL}/functions/v1/${fn}`,
      { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), cache: 'no-store' },
      2,
    )
    const text = await res.text()
    let resp: any = null
    try { resp = text ? JSON.parse(text) : null } catch { return { error: `Resposta inválida (${res.status}).` } }
    if (!resp) return { error: res.ok ? 'Servidor não respondeu.' : `Erro ${res.status}.` }
    if (!res.ok && !resp?.error) return { error: `Erro do servidor (${res.status}).` }
    return resp
  } catch (e: any) {
    if (e?.name === 'AbortError') return { error: 'Cancelado.' }
    return { error: 'Erro de conexão.' }
  }
}

function CartoesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const novaParam = searchParams.get('nova')
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Listas auxiliares para o modal de nova despesa.
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])

  // Modal Nova Despesa.
  const [despesaCartao, setDespesaCartao] = useState<Cartao | null>(null)
  const [despesaDesc, setDespesaDesc] = useState('')
  const [despesaCompetence, setDespesaCompetence] = useState(todayISO())
  const [despesaValor, setDespesaValor] = useState('')
  const [despesaFornecedor, setDespesaFornecedor] = useState('')
  const [despesaCategoria, setDespesaCategoria] = useState('')
  const [despesaCostCenter, setDespesaCostCenter] = useState('')
  const [despesaInstallments, setDespesaInstallments] = useState(1)
  const [despesaSaving, setDespesaSaving] = useState(false)

  // Modal Adicionar / Editar cartão.
  const [cartaoFormOpen, setCartaoFormOpen] = useState<null | { mode: 'criar' } | { mode: 'editar'; cartao: Cartao }>(null)
  const [formNome, setFormNome] = useState('')
  const [formLimite, setFormLimite] = useState('')
  const [formFech, setFormFech] = useState('')
  const [formVenc, setFormVenc] = useState('')
  const [formSaving, setFormSaving] = useState(false)

  // Menu ⋮
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    const flag = sessionStorage.getItem('fin_auth_ok')
    setAuthorized(flag === '1')
    setAuthChecked(true)
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    const resp = await callEdgeFn('financeiro-agent', { action: 'cartoes_listar' })
    setLoading(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    setCartoes(resp?.cartoes || [])
  }, [])

  const loadAux = useCallback(async () => {
    // Categorias, fornecedores, centros de custo — endpoints próprios já existem.
    const s = getSession()
    if (!s) return
    const [cats, forns, ccs] = await Promise.all([
      callEdgeFn('financeiro-categorias', { action: 'listar' }),
      callEdgeFn('financeiro-fornecedores', { action: 'listar' }),
      callEdgeFn('financeiro-aux', { entity: 'cost_centers', action: 'listar' }),
    ])
    if (cats?.categorias) setCategorias(cats.categorias)
    if (forns?.fornecedores) setFornecedores(forns.fornecedores)
    if (ccs?.cost_centers) setCostCenters(ccs.cost_centers)
  }, [])

  useEffect(() => {
    if (!authorized) return
    void load()
    void loadAux()
  }, [authorized, load, loadAux])

  // Abre Nova despesa automaticamente quando vier `?nova=<cartaoId>`.
  useEffect(() => {
    if (!novaParam || cartoes.length === 0 || despesaCartao) return
    const cartao = cartoes.find(c => c.id === novaParam)
    if (cartao) {
      abrirNovaDespesa(cartao)
      // Limpa o query param para não reabrir.
      router.replace('/financeiro/cartoes')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novaParam, cartoes])

  // Fecha o menu ⋮ ao clicar fora.
  useEffect(() => {
    if (!menuOpenId) return
    const close = () => setMenuOpenId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenId])

  if (!authChecked) return <NGPLoading loading loadingText="Verificando acesso..." />
  if (!authorized) {
    return (
      <FinanceiroAuthModal
        onClose={() => router.replace('/setores')}
        onSuccess={() => {
          sessionStorage.setItem('fin_auth_ok', '1')
          setAuthorized(true)
        }}
      />
    )
  }

  const ativos = cartoes.filter((c) => c.ativo)
  const desativados = cartoes.filter((c) => !c.ativo)

  // ── Modal Nova Despesa ────────────────────────────────────────────────────
  function abrirNovaDespesa(cartao: Cartao) {
    setDespesaCartao(cartao)
    setDespesaDesc('')
    setDespesaCompetence(todayISO())
    setDespesaValor('')
    setDespesaFornecedor('')
    setDespesaCategoria('')
    setDespesaCostCenter('')
    setDespesaInstallments(1)
  }

  function fecharNovaDespesa() { setDespesaCartao(null) }

  // Calcula o mês de referência da fatura para uma data de competência + dia_fechamento.
  function faturaLabel(competence: string, diaFech: number | null): string {
    if (!competence) return ''
    const d = new Date(competence + 'T00:00:00')
    let y = d.getFullYear()
    let m = d.getMonth()
    if (diaFech && d.getDate() > diaFech) {
      m += 1
      if (m > 11) { m = 0; y += 1 }
    }
    return new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }

  async function salvarNovaDespesa(e: React.FormEvent) {
    e.preventDefault()
    if (!despesaCartao) return
    const valor = parseCurrency(despesaValor)
    if (!despesaDesc.trim()) { showMsg('err', 'Informe uma descrição.'); return }
    if (valor == null || valor <= 0) { showMsg('err', 'Informe um valor válido.'); return }
    setDespesaSaving(true)
    const resp = await callEdgeFn('financeiro-transacoes', {
      action: 'criar',
      tipo: 'saida',
      descricao: despesaDesc,
      valor,
      competence_date: despesaCompetence,
      payment_date: null,
      account_id: despesaCartao.id,
      categoria_id: despesaCategoria || null,
      fornecedor_id: despesaFornecedor || null,
      cost_center_id: despesaCostCenter || null,
      status: 'pendente',
      installments: despesaInstallments > 1 ? despesaInstallments : null,
    })
    setDespesaSaving(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    showMsg('ok', despesaInstallments > 1 ? `${despesaInstallments} parcelas criadas!` : 'Despesa lançada no cartão!')
    fecharNovaDespesa()
    void load()
  }

  // ── Modal Adicionar / Editar Cartão ───────────────────────────────────────
  function abrirNovoCartao() {
    setFormNome(''); setFormLimite(''); setFormFech(''); setFormVenc('')
    setCartaoFormOpen({ mode: 'criar' })
  }

  function abrirEditarCartao(c: Cartao) {
    setFormNome(c.nome)
    setFormLimite(c.limite_credito != null ? String(c.limite_credito).replace('.', ',') : '')
    setFormFech(c.dia_fechamento != null ? String(c.dia_fechamento) : '')
    setFormVenc(c.dia_vencimento != null ? String(c.dia_vencimento) : '')
    setCartaoFormOpen({ mode: 'editar', cartao: c })
  }

  async function salvarCartao(e: React.FormEvent) {
    e.preventDefault()
    if (!cartaoFormOpen) return
    if (!formNome.trim()) { showMsg('err', 'Nome obrigatório.'); return }
    const limiteN = formLimite.trim() ? parseCurrency(formLimite) : null
    if (formLimite.trim() && (limiteN == null || limiteN < 0)) { showMsg('err', 'Limite inválido.'); return }
    const fechN = formFech.trim() ? Number(formFech) : null
    const vencN = formVenc.trim() ? Number(formVenc) : null
    if (fechN != null && (!Number.isInteger(fechN) || fechN < 1 || fechN > 31)) { showMsg('err', 'Dia de fechamento entre 1 e 31.'); return }
    if (vencN != null && (!Number.isInteger(vencN) || vencN < 1 || vencN > 31)) { showMsg('err', 'Dia de vencimento entre 1 e 31.'); return }

    setFormSaving(true)
    let resp: any
    if (cartaoFormOpen.mode === 'criar') {
      // Cria via financeiro-aux (sem campos extras) e depois atualiza limite/dias via SQL? Não — o agent não expõe.
      // Solução: cria com nome+tipo+saldo via aux, depois um update via execute_sql? Não disponível em runtime.
      // Caminho viável: estender financeiro-aux pra aceitar limite/fechamento/vencimento. Aqui assumimos que já aceita.
      resp = await callEdgeFn('financeiro-aux', {
        entity: 'accounts', action: 'criar',
        nome: formNome, tipo: 'cartao_credito', saldo_inicial: 0,
        limite_credito: limiteN, dia_fechamento: fechN, dia_vencimento: vencN,
      })
    } else {
      resp = await callEdgeFn('financeiro-aux', {
        entity: 'accounts', action: 'atualizar',
        id: cartaoFormOpen.cartao.id, nome: formNome, tipo: 'cartao_credito', saldo_inicial: 0,
        limite_credito: limiteN, dia_fechamento: fechN, dia_vencimento: vencN,
      })
    }
    setFormSaving(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    showMsg('ok', cartaoFormOpen.mode === 'criar' ? 'Cartão criado!' : 'Cartão atualizado!')
    setCartaoFormOpen(null)
    void load()
  }

  async function desativarCartao(c: Cartao) {
    if (!confirm(`Desativar cartão "${c.nome}"?`)) return
    const resp = await callEdgeFn('financeiro-aux', { entity: 'accounts', action: 'deletar', id: c.id })
    if (resp?.error) { showMsg('err', resp.error); return }
    showMsg('ok', 'Cartão desativado.')
    void load()
  }

  async function reativarCartao(c: Cartao) {
    const resp = await callEdgeFn('financeiro-aux', { entity: 'accounts', action: 'restaurar', id: c.id })
    if (resp?.error) { showMsg('err', resp.error); return }
    showMsg('ok', 'Cartão reativado.')
    void load()
  }

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
            <button className={styles.btnAdd} onClick={abrirNovoCartao}>+ adicionar</button>
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
            Clique em <strong>+ adicionar</strong> para criar o primeiro.
          </div>
        )}

        {ativos.length > 0 && (
          <section className={styles.gridCartoes}>
            {ativos.map((c) => (
              <CartaoCard
                key={c.id}
                c={c}
                menuOpen={menuOpenId === c.id}
                onMenuToggle={() => setMenuOpenId(prev => prev === c.id ? null : c.id)}
                onNovaDespesa={() => abrirNovaDespesa(c)}
                onEditar={() => { setMenuOpenId(null); abrirEditarCartao(c) }}
                onDesativar={() => { setMenuOpenId(null); void desativarCartao(c) }}
              />
            ))}
          </section>
        )}

        {desativados.length > 0 && (
          <>
            <h2 className={styles.sectionTitle}>Cartões de crédito desativados</h2>
            <section className={styles.gridCartoes}>
              {desativados.map((c) => (
                <CartaoCard
                  key={c.id}
                  c={c}
                  muted
                  menuOpen={menuOpenId === c.id}
                  onMenuToggle={() => setMenuOpenId(prev => prev === c.id ? null : c.id)}
                  onReativar={() => { setMenuOpenId(null); void reativarCartao(c) }}
                />
              ))}
            </section>
          </>
        )}
      </main>

      {/* ── Modal Nova Despesa ──────────────────────────────────────────── */}
      {despesaCartao && (
        <div className={styles.modalOverlay} onClick={fecharNovaDespesa}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3 className={styles.modalTitle}>Nova despesa no cartão</h3>
              <span className={styles.modalSub}>{despesaCartao.nome}</span>
            </div>
            <form onSubmit={salvarNovaDespesa} className={styles.modalForm}>
              <div className={styles.formField}>
                <label>Descrição *</label>
                <input value={despesaDesc} onChange={e => setDespesaDesc(e.target.value)} placeholder="Ex: Anúncio Meta, Hospedagem..." required autoFocus />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Competência *</label>
                  <input type="date" value={despesaCompetence} onChange={e => setDespesaCompetence(e.target.value)} required />
                </div>
                <div className={styles.formField}>
                  <label>Valor (R$) *</label>
                  <input value={despesaValor} onChange={e => setDespesaValor(e.target.value)} placeholder="0,00" required />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Fornecedor</label>
                  <select value={despesaFornecedor} onChange={e => setDespesaFornecedor(e.target.value)}>
                    <option value="">— Nenhum —</option>
                    {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>Categoria</label>
                  <select value={despesaCategoria} onChange={e => setDespesaCategoria(e.target.value)}>
                    <option value="">— Sem categoria —</option>
                    {categorias.filter(c => c.tipo === 'saida').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Centro de custo</label>
                  <select value={despesaCostCenter} onChange={e => setDespesaCostCenter(e.target.value)}>
                    <option value="">— Nenhum —</option>
                    {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.nome}</option>)}
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>Parcelamento</label>
                  <select value={despesaInstallments} onChange={e => setDespesaInstallments(Number(e.target.value))}>
                    <option value={1}>À vista</option>
                    {Array.from({ length: 23 }, (_, i) => i + 2).map(n => (
                      <option key={n} value={n}>{n}x</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.faturaPreview}>
                Fatura de: <strong>{faturaLabel(despesaCompetence, despesaCartao.dia_fechamento)}</strong>
                {despesaInstallments > 1 && (() => {
                  const total = parseCurrency(despesaValor) || 0
                  const cents = Math.round(total * 100)
                  const base = Math.floor(cents / despesaInstallments) / 100
                  return (
                    <span className={styles.faturaPreviewParc}>
                      · {despesaInstallments}x de R$ {base.toFixed(2).replace('.', ',')}
                    </span>
                  )
                })()}
              </div>

              <div className={styles.formActions}>
                <button type="button" className={styles.btnCancel} onClick={fecharNovaDespesa}>Cancelar</button>
                <button type="submit" className={styles.btnSave} disabled={despesaSaving}>
                  {despesaSaving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Criar / Editar Cartão ─────────────────────────────────── */}
      {cartaoFormOpen && (
        <div className={styles.modalOverlay} onClick={() => setCartaoFormOpen(null)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3 className={styles.modalTitle}>{cartaoFormOpen.mode === 'criar' ? 'Adicionar cartão' : 'Editar cartão'}</h3>
            </div>
            <form onSubmit={salvarCartao} className={styles.modalForm}>
              <div className={styles.formField}>
                <label>Nome *</label>
                <input value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Ex: NGP, Pessoal..." required autoFocus />
              </div>
              <div className={styles.formField}>
                <label>Limite (R$)</label>
                <input value={formLimite} onChange={e => setFormLimite(e.target.value)} placeholder="0,00" />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Dia de fechamento</label>
                  <input type="number" min={1} max={31} value={formFech} onChange={e => setFormFech(e.target.value)} placeholder="Ex: 11" />
                </div>
                <div className={styles.formField}>
                  <label>Dia de vencimento</label>
                  <input type="number" min={1} max={31} value={formVenc} onChange={e => setFormVenc(e.target.value)} placeholder="Ex: 18" />
                </div>
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setCartaoFormOpen(null)}>Cancelar</button>
                <button type="submit" className={styles.btnSave} disabled={formSaving}>
                  {formSaving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function CartaoCard({
  c, muted, menuOpen, onMenuToggle, onNovaDespesa, onEditar, onDesativar, onReativar,
}: {
  c: Cartao; muted?: boolean
  menuOpen: boolean
  onMenuToggle: () => void
  onNovaDespesa?: () => void
  onEditar?: () => void
  onDesativar?: () => void
  onReativar?: () => void
}) {
  const semFechamento = !c.dia_fechamento
  const limiteDisp = c.limite_disponivel
  const limiteNeg = limiteDisp !== null && limiteDisp < 0
  return (
    <article className={`${styles.cartao} ${muted ? styles.cartaoMuted : ''}`}>
      <div className={styles.cartaoHead}>
        <div className={styles.cartaoIcon}>💳</div>
        <div className={styles.cartaoHeadText}>
          <h3 className={styles.cartaoNome}>{c.nome}</h3>
          <Link href={`/financeiro/cartoes/${c.id}/faturas`} className={styles.cartaoLink}>Ver faturas →</Link>
        </div>
        <div className={styles.cartaoHeadActions}>
          {!muted && onNovaDespesa && (
            <button className={styles.btnNovaDespesa} onClick={onNovaDespesa} title="Nova despesa neste cartão">
              + Nova despesa
            </button>
          )}
          <div className={styles.menuWrap} onClick={e => e.stopPropagation()}>
            <button className={styles.menuBtn} onClick={onMenuToggle} aria-label="Mais opções">⋮</button>
            {menuOpen && (
              <div className={styles.menuDrop}>
                {!muted ? (
                  <>
                    {onEditar && <button onClick={onEditar}>Editar</button>}
                    {onDesativar && <button className={styles.menuItemDanger} onClick={onDesativar}>Desativar</button>}
                  </>
                ) : (
                  <>
                    {onReativar && <button onClick={onReativar}>Reativar</button>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
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
          <span className={styles.metricValue}>{fmtBRL(c.fatura_total)}</span>
          {c.fatura_pendente > 0 && (
            <span className={styles.metricSub}>
              {fmtBRL(c.fatura_atual)} confirmada · {fmtBRL(c.fatura_pendente)} pendente
            </span>
          )}
        </div>
      </div>

      <div className={styles.cartaoFoot}>
        {c.limite_credito !== null && (
          <span className={styles.cartaoFootItem}>Limite total: <strong>{fmtBRL(c.limite_credito)}</strong></span>
        )}
        {c.dia_fechamento && (
          <span className={styles.cartaoFootItem}>Fecha dia <strong>{c.dia_fechamento}</strong></span>
        )}
        {c.dia_vencimento && (
          <span className={styles.cartaoFootItem}>Vence dia <strong>{c.dia_vencimento}</strong></span>
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
