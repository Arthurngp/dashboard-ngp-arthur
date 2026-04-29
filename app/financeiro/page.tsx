'use client'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { parseCurrencyInput } from '@/lib/financeiro'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import CustomSelect from '@/components/CustomSelect'
import CustomDatePicker from '@/components/CustomDatePicker'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import { financeiroNav } from './financeiro-nav'
import styles from './financeiro.module.css'

type Tab = 'transacoes' | 'clientes' | 'fornecedores' | 'categorias' | 'contas'
type TipoFiltro = 'todos' | 'entrada' | 'saida'
type ViewMode = 'competencia' | 'caixa'

interface Categoria    { id: string; nome: string; cor: string; tipo: string }
interface FinCliente   {
  id: string
  nome: string
  documento?: string
  telefone?: string
  email?: string
  observacoes?: string
  mensalidade_valor?: number | null
  mensalidade_descricao?: string | null
  dia_cobranca?: number | null
  assinatura_ativa?: boolean | null
}
interface FinFornecedor{ id: string; nome: string; documento?: string; telefone?: string; email?: string; observacoes?: string }
interface FinAccount   { id: string; nome: string; tipo: string; saldo_inicial: number; saldo_atual: number }
interface FinCostCenter{ id: string; nome: string; descricao?: string }
interface FinProduct   { id: string; nome: string; tipo: string; valor_padrao?: number | null }

interface Transacao {
  id: string
  tipo: 'entrada' | 'saida'
  descricao: string
  valor: number
  data_transacao: string
  competence_date?: string | null
  payment_date?: string | null
  status: 'confirmado' | 'pendente' | 'cancelado'
  observacoes?: string
  categoria?: Categoria | null
  cliente?: FinCliente | null
  fornecedor?: FinFornecedor | null
  account?: FinAccount | null
  cost_center?: FinCostCenter | null
  product?: FinProduct | null
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function fmtBRL(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function todayISO() { return new Date().toISOString().split('T')[0] }
function monthStartISO() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
}

// ── SelectComCadastro: CustomSelect + botão inline de cadastro rápido ────────
interface QuickCreateField { key: string; label: string; placeholder?: string; type?: string; required?: boolean }

function SelectComCadastro({
  label, value, options, onChange, placeholder,
  createLabel, createFields, onQuickCreate,
}: {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (v: string) => void
  placeholder?: string
  createLabel: string
  createFields: QuickCreateField[]
  onQuickCreate: (fields: Record<string, string>) => Promise<boolean>
}) {
  const [showQuick, setShowQuick] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function openQuick() {
    const init: Record<string, string> = {}
    createFields.forEach(f => { init[f.key] = '' })
    setFieldValues(init)
    setShowQuick(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const ok = await onQuickCreate(fieldValues)
      if (ok) setShowQuick(false)
    } finally { setSaving(false) }
  }

  return (
    <div className={styles.selectComCadastro}>
      <CustomSelect
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder}
      />
      {!showQuick && (
        <button type="button" className={styles.btnQuickCreate} onClick={openQuick}>
          + {createLabel}
        </button>
      )}
      {showQuick && (
        <form onSubmit={handleSubmit} className={styles.quickForm}>
          {createFields.map(f => (
            <input
              key={f.key}
              type={f.type || 'text'}
              placeholder={f.placeholder || f.label}
              value={fieldValues[f.key] || ''}
              onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
              required={f.required}
              className={styles.quickInput}
            />
          ))}
          <div className={styles.quickActions}>
            <button type="button" className={styles.btnQuickCancel} onClick={() => setShowQuick(false)}>Cancelar</button>
            <button type="submit" className={styles.btnQuickSave} disabled={saving}>{saving ? '...' : 'Salvar'}</button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
function FinanceiroInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sess, setSess]             = useState<ReturnType<typeof getSession> | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [activeTab, setActiveTab]   = useState<Tab>('transacoes')
  const [loading, setLoading]       = useState(false)
  const [msg, setMsg]               = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const now = new Date()
  const [mesFiltro, setMesFiltro]   = useState(now.getMonth() + 1)
  const [anoFiltro, setAnoFiltro]   = useState(now.getFullYear())
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')
  const [viewMode, setViewMode]     = useState<ViewMode>('competencia')

  const [transacoes, setTransacoes]     = useState<Transacao[]>([])
  const [resumo, setResumo]             = useState({ entradas: 0, saidas: 0, saldo: 0 })
  const [categorias, setCategorias]     = useState<Categoria[]>([])
  const [clientes, setClientes]         = useState<FinCliente[]>([])
  const [fornecedores, setFornecedores] = useState<FinFornecedor[]>([])
  const [accounts, setAccounts]         = useState<FinAccount[]>([])
  const [costCenters, setCostCenters]   = useState<FinCostCenter[]>([])
  const [products, setProducts]         = useState<FinProduct[]>([])

  // ── Modal transação ───────────────────────────────────────────────────────
  const [showForm, setShowForm]       = useState(false)
  const [formMode, setFormMode]       = useState<'criar' | 'editar'>('criar')
  const [editId, setEditId]           = useState<string | null>(null)
  const [fTipo, setFTipo]             = useState<'entrada' | 'saida'>('saida')
  const [fDesc, setFDesc]             = useState('')
  const [fValor, setFValor]           = useState('')
  const [fCompDate, setFCompDate]     = useState(todayISO())
  const [fPayDate, setFPayDate]       = useState(todayISO())
  const [fCat, setFCat]               = useState('')
  const [fCliente, setFCliente]       = useState('')
  const [fFornecedor, setFFornecedor] = useState('')
  const [fAccount, setFAccount]       = useState('')
  const [fCostCenter, setFCostCenter] = useState('')
  const [fProduct, setFProduct]       = useState('')
  const [fStatus, setFStatus]         = useState<'confirmado' | 'pendente'>('confirmado')
  const [fObs, setFObs]               = useState('')
  const [saving, setSaving]           = useState(false)

  // ── Modal cadastro cliente/fornecedor (aba) ───────────────────────────────
  const [showCadForm, setShowCadForm] = useState(false)
  const [cadMode, setCadMode]         = useState<'criar' | 'editar'>('criar')
  const [cadEditId, setCadEditId]     = useState<string | null>(null)
  const [cadNome, setCadNome]         = useState('')
  const [cadDoc, setCadDoc]           = useState('')
  const [cadTel, setCadTel]           = useState('')
  const [cadEmail, setCadEmail]       = useState('')
  const [cadObs, setCadObs]           = useState('')
  const [cadMensalidadeValor, setCadMensalidadeValor] = useState('')
  const [cadMensalidadeDesc, setCadMensalidadeDesc]   = useState('')
  const [cadDiaCobranca, setCadDiaCobranca]           = useState('')
  const [cadAssinaturaAtiva, setCadAssinaturaAtiva]   = useState(false)
  const [cadCriarRecebimento, setCadCriarRecebimento] = useState(false)
  const [cadRecebimentoValor, setCadRecebimentoValor] = useState('')
  const [cadRecebimentoDesc, setCadRecebimentoDesc]   = useState('')
  const [cadRecebimentoData, setCadRecebimentoData]   = useState(todayISO())
  const [cadSaving, setCadSaving]     = useState(false)

  // ── Modal nova conta bancária (aba Contas) ────────────────────────────────
  const [showContaForm, setShowContaForm] = useState(false)
  const [contaNome, setContaNome]         = useState('')
  const [contaTipo, setContaTipo]         = useState<'banco'|'carteira'|'cartao'>('banco')
  const [contaSaldo, setContaSaldo]       = useState('')
  const [contaSaving, setContaSaving]     = useState(false)

  // Sync tab com query params
  useEffect(() => {
    const tab  = searchParams.get('tab')
    const tipo = searchParams.get('tipo')
    if (tab === 'clientes')     { setActiveTab('clientes');     return }
    if (tab === 'fornecedores') { setActiveTab('fornecedores'); return }
    if (tab === 'categorias')   { setActiveTab('categorias');   return }
    if (tab === 'contas')       { setActiveTab('contas');       return }
    setActiveTab('transacoes')
    if (tipo === 'entrada') setTipoFiltro('entrada')
    else if (tipo === 'saida') setTipoFiltro('saida')
    else setTipoFiltro('todos')
  }, [searchParams])

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    const flag = sessionStorage.getItem('fin_auth_ok')
    setSess(s)
    setAuthorized(flag === '1')
    setAuthChecked(true)
  }, [router])

  const callFn = useCallback(async (fn: string, body: object) => {
    const s = getSession()
    if (!s) return null
    try {
      const res = await fetch(`${SURL}/functions/v1/${fn}`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, ...body }),
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok && !data?.error) return { error: 'Erro inesperado ao processar a solicitação.' }
      return data
    } catch {
      return { error: 'Erro de conexão. Tente novamente.' }
    }
  }, [])

  const fetchTransacoes   = useCallback(async () => {
    setLoading(true)
    try {
      const [data, r] = await Promise.all([
        callFn('financeiro-transacoes', { action: 'listar', mes: mesFiltro, ano: anoFiltro, view: viewMode }),
        callFn('financeiro-transacoes', { action: 'resumo', mes: mesFiltro, ano: anoFiltro, view: viewMode }),
      ])
      if (data?.error) {
        setTransacoes([])
        showMsg('err', data.error)
      } else if (data?.transacoes) {
        setTransacoes(data.transacoes)
      }
      if (r?.error) {
        setResumo({ entradas: 0, saidas: 0, saldo: 0 })
        showMsg('err', r.error)
      } else if (r) {
        setResumo(r)
      }
    } finally { setLoading(false) }
  }, [callFn, mesFiltro, anoFiltro, viewMode])

  const fetchCategorias   = useCallback(async () => { const d = await callFn('financeiro-categorias',   { action: 'listar' }); if (d?.categorias)   setCategorias(d.categorias)     }, [callFn])
  const fetchClientes     = useCallback(async () => { const d = await callFn('financeiro-clientes',     { action: 'listar' }); if (d?.clientes)     setClientes(d.clientes)         }, [callFn])
  const fetchFornecedores = useCallback(async () => { const d = await callFn('financeiro-fornecedores', { action: 'listar' }); if (d?.fornecedores) setFornecedores(d.fornecedores) }, [callFn])
  const fetchAccounts     = useCallback(async () => { const d = await callFn('financeiro-aux', { entity: 'accounts',     action: 'listar' }); if (d?.accounts)     setAccounts(d.accounts)         }, [callFn])
  const fetchCostCenters  = useCallback(async () => { const d = await callFn('financeiro-aux', { entity: 'cost_centers', action: 'listar' }); if (d?.cost_centers) setCostCenters(d.cost_centers)   }, [callFn])
  const fetchProducts     = useCallback(async () => { const d = await callFn('financeiro-aux', { entity: 'products',     action: 'listar' }); if (d?.products)     setProducts(d.products)         }, [callFn])

  useEffect(() => {
    if (!authorized) return
    fetchCategorias(); fetchClientes(); fetchFornecedores()
    fetchAccounts(); fetchCostCenters(); fetchProducts()
  }, [authorized, fetchCategorias, fetchClientes, fetchFornecedores, fetchAccounts, fetchCostCenters, fetchProducts])

  useEffect(() => {
    if (authorized && activeTab === 'transacoes') fetchTransacoes()
  }, [authorized, activeTab, fetchTransacoes])

  function resetForm() {
    setFormMode('criar'); setEditId(null)
    setFTipo('saida'); setFDesc(''); setFValor('')
    setFCompDate(todayISO()); setFPayDate(todayISO())
    setFCat(''); setFCliente(''); setFFornecedor('')
    setFAccount(''); setFCostCenter(''); setFProduct('')
    setFStatus('confirmado'); setFObs('')
  }

  function resetCadastroForm() {
    setCadMode('criar'); setCadEditId(null)
    setCadNome(''); setCadDoc(''); setCadTel(''); setCadEmail(''); setCadObs('')
    setCadMensalidadeValor(''); setCadMensalidadeDesc(''); setCadDiaCobranca(''); setCadAssinaturaAtiva(false)
    setCadCriarRecebimento(false); setCadRecebimentoValor(''); setCadRecebimentoDesc(''); setCadRecebimentoData(todayISO())
  }

  function openNovaTransacao() { resetForm(); setShowForm(true) }

  function openEditarTransacao(t: Transacao) {
    setFormMode('editar'); setEditId(t.id)
    setFTipo(t.tipo); setFDesc(t.descricao); setFValor(String(t.valor))
    setFCompDate(t.competence_date || t.data_transacao)
    setFPayDate(t.payment_date || todayISO())
    setFCat(t.categoria?.id || ''); setFCliente(t.cliente?.id || '')
    setFFornecedor(t.fornecedor?.id || ''); setFAccount(t.account?.id || '')
    setFCostCenter(t.cost_center?.id || ''); setFProduct(t.product?.id || '')
    setFStatus(t.status === 'pendente' ? 'pendente' : 'confirmado')
    setFObs(t.observacoes || '')
    setShowForm(true)
  }

  function handleStatusChange(s: 'confirmado' | 'pendente') {
    setFStatus(s)
    if (s === 'confirmado' && !fPayDate) setFPayDate(todayISO())
  }

  function handleProductChange(id: string) {
    setFProduct(id)
    if (id) {
      const p = products.find(p => p.id === id)
      if (p?.valor_padrao) setFValor(String(p.valor_padrao))
    }
  }

  function openNovoCadastro() {
    resetCadastroForm()
    setShowCadForm(true)
  }

  function openEditarCadastroCliente(cliente: FinCliente) {
    setCadMode('editar'); setCadEditId(cliente.id)
    setCadNome(cliente.nome || '')
    setCadDoc(cliente.documento || '')
    setCadTel(cliente.telefone || '')
    setCadEmail(cliente.email || '')
    setCadObs(cliente.observacoes || '')
    setCadMensalidadeValor(cliente.mensalidade_valor != null ? String(cliente.mensalidade_valor) : '')
    setCadMensalidadeDesc(cliente.mensalidade_descricao || '')
    setCadDiaCobranca(cliente.dia_cobranca != null ? String(cliente.dia_cobranca) : '')
    setCadAssinaturaAtiva(Boolean(cliente.assinatura_ativa))
    setCadCriarRecebimento(false)
    setCadRecebimentoValor('')
    setCadRecebimentoDesc('')
    setCadRecebimentoData(todayISO())
    setShowCadForm(true)
  }

  function openEditarCadastroFornecedor(fornecedor: FinFornecedor) {
    setCadMode('editar'); setCadEditId(fornecedor.id)
    setCadNome(fornecedor.nome || '')
    setCadDoc(fornecedor.documento || '')
    setCadTel(fornecedor.telefone || '')
    setCadEmail(fornecedor.email || '')
    setCadObs(fornecedor.observacoes || '')
    setCadMensalidadeValor(''); setCadMensalidadeDesc(''); setCadDiaCobranca(''); setCadAssinaturaAtiva(false)
    setCadCriarRecebimento(false); setCadRecebimentoValor(''); setCadRecebimentoDesc(''); setCadRecebimentoData(todayISO())
    setShowCadForm(true)
  }

  function lancarMensalidade(cliente: FinCliente) {
    if (!cliente.mensalidade_valor || cliente.mensalidade_valor <= 0) {
      showMsg('err', 'Este cliente não possui uma mensalidade válida cadastrada.')
      return
    }
    resetForm()
    setFormMode('criar')
    setFTipo('entrada')
    setFDesc(cliente.mensalidade_descricao?.trim() || `Mensalidade ${cliente.nome}`)
    setFValor(String(cliente.mensalidade_valor))
    setFCompDate(monthStartISO())
    setFPayDate('')
    setFCliente(cliente.id)
    setFStatus('pendente')
    setShowForm(true)
  }

  function abrirRecebimentoPendenteCliente(cliente: FinCliente) {
    resetForm()
    setFormMode('criar')
    setFTipo('entrada')
    setFDesc(`Recebimento pendente ${cliente.nome}`)
    setFCompDate(todayISO())
    setFPayDate('')
    setFCliente(cliente.id)
    setFStatus('pendente')
    setShowForm(true)
  }

  async function salvarTransacao(e: React.FormEvent) {
    e.preventDefault()
    const valor = parseCurrencyInput(fValor)
    if (valor == null || valor <= 0) {
      showMsg('err', 'Informe um valor monetário válido maior que zero.')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        tipo: fTipo, descricao: fDesc,
        valor,
        competence_date: fCompDate,
        payment_date: fStatus === 'confirmado' ? fPayDate : null,
        categoria_id: fCat || null, cliente_id: fCliente || null,
        fornecedor_id: fFornecedor || null, account_id: fAccount || null,
        cost_center_id: fCostCenter || null,
        product_id: fTipo === 'entrada' ? (fProduct || null) : null,
        status: fStatus, observacoes: fObs || null,
      }
      const data = await callFn('financeiro-transacoes', formMode === 'criar'
        ? { action: 'criar', ...payload }
        : { action: 'atualizar', id: editId, ...payload })
      if (data?.error) { showMsg('err', data.error); return }
      showMsg('ok', formMode === 'criar' ? 'Transação criada!' : 'Transação atualizada!')
      setShowForm(false); fetchTransacoes()
    } finally { setSaving(false) }
  }

  async function deletarTransacao(id: string) {
    if (!confirm('Excluir esta transação?')) return
    const data = await callFn('financeiro-transacoes', { action: 'deletar', id })
    if (data?.error) { showMsg('err', data.error); return }
    showMsg('ok', 'Transação excluída.'); fetchTransacoes()
  }

  async function togglePagamento(t: Transacao) {
    const isPago = t.status === 'confirmado'
    const update = isPago
      ? { status: 'pendente', payment_date: null }
      : { status: 'confirmado', payment_date: todayISO() }
    const data = await callFn('financeiro-transacoes', { action: 'atualizar', id: t.id, ...update })
    if (data?.error) { showMsg('err', data.error); return }
    showMsg('ok', isPago ? 'Marcado como pendente.' : 'Transação paga!')
    fetchTransacoes()
  }

  async function salvarCadastro(e: React.FormEvent) {
    e.preventDefault()
    const isCliente = activeTab === 'clientes'
    const mensalidadeValor = parseCurrencyInput(cadMensalidadeValor)
    if (isCliente && cadMensalidadeValor.trim() && (mensalidadeValor == null || mensalidadeValor <= 0)) {
      showMsg('err', 'Informe um valor mensal válido.')
      return
    }
    const diaCobranca = cadDiaCobranca.trim() ? Number(cadDiaCobranca) : null
    if (isCliente && diaCobranca != null && (!Number.isInteger(diaCobranca) || diaCobranca < 1 || diaCobranca > 31)) {
      showMsg('err', 'Use um dia de cobrança entre 1 e 31.')
      return
    }
    if (isCliente && cadAssinaturaAtiva && (mensalidadeValor == null || mensalidadeValor <= 0)) {
      showMsg('err', 'Defina um valor mensal maior que zero para ativar a assinatura.')
      return
    }
    const recebimentoValor = parseCurrencyInput(cadRecebimentoValor)
    if (isCliente && cadCriarRecebimento && (recebimentoValor == null || recebimentoValor <= 0)) {
      showMsg('err', 'Informe um valor válido para o recebimento pendente.')
      return
    }
    if (isCliente && cadCriarRecebimento && !cadRecebimentoData) {
      showMsg('err', 'Defina a data do recebimento pendente.')
      return
    }
    setCadSaving(true)
    try {
      const fn   = activeTab === 'clientes' ? 'financeiro-clientes' : 'financeiro-fornecedores'
      const action = cadMode === 'criar' ? 'criar' : 'atualizar'
      const data = await callFn(fn, {
        action,
        id: cadMode === 'editar' ? cadEditId : undefined,
        nome: cadNome,
        documento: cadDoc,
        telefone: cadTel,
        email: cadEmail,
        observacoes: cadObs,
        ...(isCliente ? {
          mensalidade_valor: mensalidadeValor,
          mensalidade_descricao: cadMensalidadeDesc || null,
          dia_cobranca: diaCobranca,
          assinatura_ativa: cadAssinaturaAtiva,
          criar_recebimento_pendente: cadCriarRecebimento,
          recebimento_valor: recebimentoValor,
          recebimento_descricao: cadRecebimentoDesc || null,
          recebimento_competencia: cadRecebimentoData || null,
        } : {}),
      })
      if (data?.error) { showMsg('err', data.error); return }
      showMsg('ok', `${activeTab === 'clientes' ? 'Cliente' : 'Fornecedor'} ${cadMode === 'criar' ? 'cadastrado' : 'atualizado'}!`)
      setShowCadForm(false)
      resetCadastroForm()
      activeTab === 'clientes' ? fetchClientes() : fetchFornecedores()
      if (activeTab === 'clientes') fetchTransacoes()
    } finally { setCadSaving(false) }
  }

  async function deletarCadastro(id: string, tipo: 'clientes' | 'fornecedores') {
    const label = tipo === 'clientes' ? 'cliente' : 'fornecedor'
    if (!confirm(`Remover este ${label}?`)) return
    const fn   = tipo === 'clientes' ? 'financeiro-clientes' : 'financeiro-fornecedores'
    const data = await callFn(fn, { action: 'deletar', id })
    if (data?.error) { showMsg('err', data.error); return }
    showMsg('ok', `${label.charAt(0).toUpperCase() + label.slice(1)} removido.`)
    tipo === 'clientes' ? fetchClientes() : fetchFornecedores()
  }

  async function deletarCategoria(id: string) {
    if (!confirm('Remover esta categoria?')) return
    const data = await callFn('financeiro-categorias', { action: 'deletar', id })
    if (data?.error) { showMsg('err', data.error); return }
    showMsg('ok', 'Categoria removida.'); fetchCategorias()
  }

  async function salvarConta(e: React.FormEvent) {
    e.preventDefault()
    const saldoInicial = parseCurrencyInput(contaSaldo)
    if (contaSaldo.trim() && saldoInicial == null) {
      showMsg('err', 'Informe um saldo inicial válido.')
      return
    }
    setContaSaving(true)
    try {
      const data = await callFn('financeiro-aux', {
        entity: 'accounts', action: 'criar',
        nome: contaNome, tipo: contaTipo,
        saldo_inicial: saldoInicial ?? 0,
      })
      if (data?.error) { showMsg('err', data.error); return }
      showMsg('ok', 'Conta cadastrada!')
      setShowContaForm(false); setContaNome(''); setContaTipo('banco'); setContaSaldo('')
      fetchAccounts()
    } finally { setContaSaving(false) }
  }

  // ── Funções de cadastro rápido inline (dentro do modal de transação) ───────
  async function quickCreateCliente(fields: Record<string, string>): Promise<boolean> {
    const data = await callFn('financeiro-clientes', { action: 'criar', nome: fields.nome, email: fields.email || null })
    if (data?.error) { showMsg('err', data.error); return false }
    await fetchClientes()
    if (data?.cliente) setFCliente(data.cliente.id)
    showMsg('ok', 'Cliente cadastrado!'); return true
  }

  async function quickCreateFornecedor(fields: Record<string, string>): Promise<boolean> {
    const data = await callFn('financeiro-fornecedores', { action: 'criar', nome: fields.nome, email: fields.email || null })
    if (data?.error) { showMsg('err', data.error); return false }
    await fetchFornecedores()
    if (data?.fornecedor) setFFornecedor(data.fornecedor.id)
    showMsg('ok', 'Fornecedor cadastrado!'); return true
  }

  async function quickCreateProduto(fields: Record<string, string>): Promise<boolean> {
    const valorPadrao = parseCurrencyInput(fields.valor_padrao)
    if (fields.valor_padrao?.trim() && valorPadrao == null) {
      showMsg('err', 'Informe um valor padrão válido.')
      return false
    }
    const data = await callFn('financeiro-aux', {
      entity: 'products', action: 'criar',
      nome: fields.nome, tipo: fields.tipo || 'servico',
      valor_padrao: valorPadrao,
    })
    if (data?.error) { showMsg('err', data.error); return false }
    await fetchProducts()
    if (data?.product) { setFProduct(data.product.id); if (data.product.valor_padrao) setFValor(String(data.product.valor_padrao)) }
    showMsg('ok', 'Produto cadastrado!'); return true
  }

  async function quickCreateConta(fields: Record<string, string>): Promise<boolean> {
    const saldoInicial = parseCurrencyInput(fields.saldo_inicial)
    if (fields.saldo_inicial?.trim() && saldoInicial == null) {
      showMsg('err', 'Informe um saldo inicial válido.')
      return false
    }
    const data = await callFn('financeiro-aux', {
      entity: 'accounts', action: 'criar',
      nome: fields.nome, tipo: fields.tipo || 'banco',
      saldo_inicial: saldoInicial ?? 0,
    })
    if (data?.error) { showMsg('err', data.error); return false }
    await fetchAccounts()
    if (data?.account) setFAccount(data.account.id)
    showMsg('ok', 'Conta cadastrada!'); return true
  }

  const transacoesFiltradas = transacoes.filter(t => tipoFiltro === 'todos' || t.tipo === tipoFiltro)
  const catsFiltradas = categorias.filter(c => c.tipo === fTipo)
  const resumoLabel = viewMode === 'competencia' ? 'Competência (DRE)' : 'Caixa (Pagos)'

  if (!authChecked) return <NGPLoading loading loadingText="Carregando financeiro..." />

  return (
    <>
      {!authorized && (
        <FinanceiroAuthModal
          onSuccess={() => setAuthorized(true)}
          onClose={() => router.replace('/setores')}
        />
      )}

      <div className={styles.layout}>
        <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />

        <main className={styles.main}>
          <div className={styles.content}>

            <header className={styles.header}>
              <div className={styles.eyebrow}>Setor Financeiro</div>
              <h1 className={styles.title}>Financeiro NGP</h1>
              <p className={styles.subtitle}>Controle de entradas, saídas, clientes e fornecedores.</p>
            </header>


          {msg && (
            <div className={`${styles.msgBar} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
              {msg.type === 'ok' ? '✓ ' : '✕ '}{msg.text}
            </div>
          )}

          {/* ── TRANSAÇÕES ── */}
          {activeTab === 'transacoes' && (
            <>
              <div className={styles.viewToggleRow}>
                <span className={styles.viewToggleLabel}>Visão:</span>
                <div className={styles.viewToggle}>
                  <button className={`${styles.viewToggleBtn} ${viewMode === 'competencia' ? styles.viewToggleBtnActive : ''}`} onClick={() => setViewMode('competencia')}>Competência (DRE)</button>
                  <button className={`${styles.viewToggleBtn} ${viewMode === 'caixa' ? styles.viewToggleBtnActive : ''}`} onClick={() => setViewMode('caixa')}>Caixa (Pagos)</button>
                </div>
                <span className={styles.viewToggleHint}>
                  {viewMode === 'competencia' ? 'Mostra todas as transações do período por data de competência' : 'Mostra apenas transações pagas no período'}
                </span>
              </div>

              <div className={styles.resumoGrid}>
                <div className={styles.resumoCard}>
                  <div className={styles.resumoLabel}>Entradas · {resumoLabel}</div>
                  <div className={`${styles.resumoValue} ${styles.resumoEntrada}`}>{fmtBRL(resumo.entradas)}</div>
                </div>
                <div className={styles.resumoCard}>
                  <div className={styles.resumoLabel}>Saídas · {resumoLabel}</div>
                  <div className={`${styles.resumoValue} ${styles.resumoSaida}`}>{fmtBRL(resumo.saidas)}</div>
                </div>
                <div className={styles.resumoCard}>
                  <div className={styles.resumoLabel}>Saldo · {resumoLabel}</div>
                  <div className={`${styles.resumoValue} ${styles.resumoSaldo}`} style={{ color: resumo.saldo >= 0 ? '#059669' : '#DC2626' }}>{fmtBRL(resumo.saldo)}</div>
                </div>
              </div>

              <div className={styles.toolbar}>
                <div className={styles.toolbarLeft}>
                  <CustomSelect
                    value={`${anoFiltro}-${mesFiltro}`}
                    options={MESES.map((nome, i) => ({ id: `${anoFiltro}-${i + 1}`, label: `${nome} ${anoFiltro}` }))}
                    onChange={v => { const [y, m] = v.split('-'); setAnoFiltro(Number(y)); setMesFiltro(Number(m)) }}
                    className={styles.selectMesCustom}
                  />
                  <div className={styles.filtroTipo}>
                    {(['todos','entrada','saida'] as TipoFiltro[]).map(f => (
                      <button key={f} className={`${styles.filtroBtn} ${tipoFiltro === f ? styles.filtroBtnActive : ''}`} onClick={() => setTipoFiltro(f)}>
                        {f === 'todos' ? 'Todos' : f === 'entrada' ? 'Entradas' : 'Saídas'}
                      </button>
                    ))}
                  </div>
                </div>
                <button className={styles.btnNovo} onClick={openNovaTransacao}>+ Nova transação</button>
              </div>

              {loading ? (
                <div className={styles.empty}>Carregando...</div>
              ) : transacoesFiltradas.length === 0 ? (
                <div className={styles.empty}>Nenhuma transação encontrada para este período.</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Competência</th><th>Pagamento</th><th>Descrição</th><th>Categoria</th><th>Centro</th><th>Conta</th><th>Tipo</th><th>Valor</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {transacoesFiltradas.map(t => {
                        const isPago = t.status === 'confirmado'
                        return (
                        <tr key={t.id}>
                          <td className={styles.tdMuted}>{fmtDate(t.competence_date || t.data_transacao)}</td>
                          <td className={styles.tdMuted}>{fmtDate(t.payment_date)}</td>
                          <td>
                            <div>{t.descricao}</div>
                            {t.product && <div className={styles.tdSub}>{t.product.nome}</div>}
                          </td>
                          <td>
                            {t.categoria
                              ? <span><span className={styles.catDot} style={{ background: t.categoria.cor }} />{t.categoria.nome}</span>
                              : <span className={styles.tdMuted}>—</span>}
                          </td>
                          <td className={styles.tdMuted}>{t.cost_center?.nome || '—'}</td>
                          <td className={styles.tdMuted}>{t.account?.nome || '—'}</td>
                          <td>
                            <span className={`${styles.tipoBadge} ${t.tipo === 'entrada' ? styles.tipoEntrada : styles.tipoSaida}`}>
                              {t.tipo === 'entrada' ? '↑ Entrada' : '↓ Saída'}
                            </span>
                          </td>
                          <td className={t.tipo === 'entrada' ? styles.valorEntrada : styles.valorSaida}>
                            {t.tipo === 'entrada' ? '+' : '-'}{fmtBRL(t.valor)}
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              {/* Pagar / Pago */}
                              <button
                                className={`${styles.actionBtn} ${isPago ? styles.actionBtnPago : styles.actionBtnPagar}`}
                                onClick={() => togglePagamento(t)}
                                title={isPago ? 'Marcar como pendente' : 'Marcar como pago'}
                              >
                                {isPago ? '✓ Pago' : '$ Pagar'}
                              </button>
                              <button className={styles.actionBtn} onClick={() => openEditarTransacao(t)}>Editar</button>
                              <button className={`${styles.actionBtn} ${styles.actionBtnDel}`} onClick={() => deletarTransacao(t.id)}>Excluir</button>
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── CLIENTES ── */}
          {activeTab === 'clientes' && (
            <>
              <div className={styles.toolbar}>
                <span style={{ fontSize: 13, color: '#8E8E93' }}>{clientes.length} cliente{clientes.length !== 1 ? 's' : ''}</span>
                <button className={styles.btnNovo} onClick={openNovoCadastro}>+ Novo cliente</button>
              </div>
              {clientes.length === 0 ? <div className={styles.empty}>Nenhum cliente cadastrado.</div> : (
                <div className={styles.cardGrid}>
                  {clientes.map(c => (
                    <div key={c.id} className={styles.cadastroCard}>
                      <div className={styles.cadastroNome}>{c.nome}</div>
                      {c.mensalidade_valor != null && (
                        <div className={`${styles.cadastroRecurring} ${c.assinatura_ativa ? styles.cadastroRecurringActive : styles.cadastroRecurringPaused}`}>
                          {c.assinatura_ativa ? 'Assinatura ativa' : 'Assinatura cadastrada'} · {fmtBRL(c.mensalidade_valor)}
                        </div>
                      )}
                      {c.dia_cobranca != null && <div className={styles.cadastroInfo}>Cobrança no dia {c.dia_cobranca}</div>}
                      {c.mensalidade_descricao && <div className={styles.cadastroInfo}>{c.mensalidade_descricao}</div>}
                      {c.documento   && <div className={styles.cadastroInfo}>Doc: {c.documento}</div>}
                      {c.telefone    && <div className={styles.cadastroInfo}>Tel: {c.telefone}</div>}
                      {c.email       && <div className={styles.cadastroInfo}>{c.email}</div>}
                      {c.observacoes && <div className={styles.cadastroInfo}>{c.observacoes}</div>}
                      <div className={styles.cadastroActions}>
                        <button className={styles.actionBtn} onClick={() => openEditarCadastroCliente(c)}>Editar</button>
                        {c.assinatura_ativa && c.mensalidade_valor != null && c.mensalidade_valor > 0 && (
                          <button className={`${styles.actionBtn} ${styles.actionBtnRecurring}`} onClick={() => lancarMensalidade(c)}>
                            Lançar mensalidade
                          </button>
                        )}
                        <button className={`${styles.actionBtn} ${styles.actionBtnRecurring}`} onClick={() => abrirRecebimentoPendenteCliente(c)}>
                          Recebimento pendente
                        </button>
                        <button className={`${styles.actionBtn} ${styles.actionBtnDel}`} onClick={() => deletarCadastro(c.id, 'clientes')}>Remover</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── FORNECEDORES ── */}
          {activeTab === 'fornecedores' && (
            <>
              <div className={styles.toolbar}>
                <span style={{ fontSize: 13, color: '#8E8E93' }}>{fornecedores.length} fornecedor{fornecedores.length !== 1 ? 'es' : ''}</span>
                <button className={styles.btnNovo} onClick={openNovoCadastro}>+ Novo fornecedor</button>
              </div>
              {fornecedores.length === 0 ? <div className={styles.empty}>Nenhum fornecedor cadastrado.</div> : (
                <div className={styles.cardGrid}>
                  {fornecedores.map(f => (
                    <div key={f.id} className={styles.cadastroCard}>
                      <div className={styles.cadastroNome}>{f.nome}</div>
                      {f.documento   && <div className={styles.cadastroInfo}>Doc: {f.documento}</div>}
                      {f.telefone    && <div className={styles.cadastroInfo}>Tel: {f.telefone}</div>}
                      {f.email       && <div className={styles.cadastroInfo}>{f.email}</div>}
                      {f.observacoes && <div className={styles.cadastroInfo}>{f.observacoes}</div>}
                      <div className={styles.cadastroActions}>
                        <button className={styles.actionBtn} onClick={() => openEditarCadastroFornecedor(f)}>Editar</button>
                        <button className={`${styles.actionBtn} ${styles.actionBtnDel}`} onClick={() => deletarCadastro(f.id, 'fornecedores')}>Remover</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── CATEGORIAS ── */}
          {activeTab === 'categorias' && (
            <>
              <div className={styles.toolbar}>
                <span style={{ fontSize: 13, color: '#8E8E93' }}>{categorias.length} categoria{categorias.length !== 1 ? 's' : ''}</span>
              </div>
              {categorias.length === 0 ? <div className={styles.empty}>Nenhuma categoria cadastrada.</div> : (
                <div className={styles.cardGrid}>
                  {categorias.map(c => (
                    <div key={c.id} className={styles.cadastroCard}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.cor, flexShrink: 0, display: 'inline-block' }} />
                        <div className={styles.cadastroNome}>{c.nome}</div>
                      </div>
                      <div className={styles.cadastroInfo}>{c.tipo === 'entrada' ? 'Entrada' : 'Saída'}</div>
                      <div className={styles.cadastroActions}>
                        <button className={`${styles.actionBtn} ${styles.actionBtnDel}`} onClick={() => deletarCategoria(c.id)}>Remover</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── CONTAS ── */}
          {activeTab === 'contas' && (
            <>
              <div className={styles.toolbar}>
                <span style={{ fontSize: 13, color: '#8E8E93' }}>{accounts.length} conta{accounts.length !== 1 ? 's' : ''}</span>
                <button className={styles.btnNovo} onClick={() => { setContaNome(''); setContaTipo('banco'); setContaSaldo(''); setShowContaForm(true) }}>+ Nova conta</button>
              </div>
              {accounts.length === 0 ? <div className={styles.empty}>Nenhuma conta bancária cadastrada. Adicione uma para controlar seu saldo real.</div> : (
                <div className={styles.resumoGrid} style={{ marginBottom: 0 }}>
                  {accounts.map(a => (
                    <div key={a.id} className={styles.resumoCard}>
                      <div className={styles.resumoLabel}>{a.nome} · {a.tipo}</div>
                      <div className={styles.resumoValue} style={{ color: a.saldo_atual >= 0 ? '#059669' : '#DC2626' }}>
                        {fmtBRL(a.saldo_atual)}
                      </div>
                      <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>
                        Saldo inicial: {fmtBRL(a.saldo_inicial)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

            <footer className={styles.footer}>
              <span className={styles.footerDot} />
              Conectado ao Supabase · {sess?.user}
            </footer>
          </div>
        </main>

        {/* ── Modal transação V2 ── */}
        {showForm && (
          <div className={styles.formOverlay} onClick={() => setShowForm(false)}>
            <div className={styles.formModal} onClick={e => e.stopPropagation()}>
              <div className={styles.formTitle}>{formMode === 'criar' ? 'Nova transação' : 'Editar transação'}</div>
              <form onSubmit={salvarTransacao}>
                <div className={styles.formGrid}>

                <CustomSelect label="Tipo" value={fTipo} menuFixed
                  options={[{ id: 'saida', label: '↓ Saída' }, { id: 'entrada', label: '↑ Entrada' }]}
                  onChange={v => { setFTipo(v as 'entrada'|'saida'); setFCat(''); setFCliente(''); setFFornecedor(''); setFProduct('') }}
                />
                <CustomSelect label="Status" value={fStatus} menuFixed
                  options={[{ id: 'confirmado', label: 'Confirmado' }, { id: 'pendente', label: 'Pendente' }]}
                  onChange={v => handleStatusChange(v as 'confirmado'|'pendente')}
                />

                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Descrição *</label>
                  <input value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="Ex: Pagamento fornecedor XYZ" required />
                </div>

                <div className={styles.field}>
                  <label>Valor (R$) *</label>
                  <input value={fValor} onChange={e => setFValor(e.target.value)} placeholder="0,00" required />
                </div>

                <CustomSelect label="Centro de Custo" value={fCostCenter} placeholder="Selecionar..." menuFixed
                  options={costCenters.map(cc => ({ id: cc.id, label: cc.nome }))}
                  onChange={setFCostCenter}
                />

                <CustomDatePicker caption="Data de Competência *" value={fCompDate} onChange={setFCompDate} />

                <CustomDatePicker
                  caption={fStatus === 'pendente' ? 'Data de Pagamento · pendente' : 'Data de Pagamento'}
                  value={fStatus === 'confirmado' ? fPayDate : ''}
                  onChange={setFPayDate}
                  disabled={fStatus === 'pendente'}
                />

                {/* Conta Bancária com cadastro rápido */}
                <SelectComCadastro
                  label="Conta Bancária" value={fAccount} placeholder="Selecionar..."
                  options={accounts.map(a => ({ id: a.id, label: a.nome }))}
                  onChange={setFAccount}
                  createLabel="Nova conta"
                  createFields={[
                    { key: 'nome', label: 'Nome da conta', placeholder: 'Ex: Nubank PJ', required: true },
                    { key: 'tipo', label: 'Tipo', placeholder: 'banco / carteira / cartao' },
                    { key: 'saldo_inicial', label: 'Saldo inicial (R$)', placeholder: '0,00' },
                  ]}
                  onQuickCreate={quickCreateConta}
                />

                <CustomSelect label="Categoria" value={fCat} placeholder="Sem categoria" menuFixed
                  options={[{ id: '', label: 'Sem categoria' }, ...catsFiltradas.map(c => ({ id: c.id, label: c.nome }))]}
                  onChange={setFCat}
                />

                {/* Cliente com cadastro rápido (só entrada) */}
                {fTipo === 'entrada' && (
                  <SelectComCadastro
                    label="Cliente" value={fCliente} placeholder="Selecionar..."
                    options={clientes.map(c => ({ id: c.id, label: c.nome }))}
                    onChange={setFCliente}
                    createLabel="Novo cliente"
                    createFields={[
                      { key: 'nome', label: 'Nome', placeholder: 'Nome completo ou empresa', required: true },
                      { key: 'email', label: 'E-mail', placeholder: 'email@exemplo.com', type: 'email' },
                    ]}
                    onQuickCreate={quickCreateCliente}
                  />
                )}

                {/* Produto com cadastro rápido (só entrada) */}
                {fTipo === 'entrada' && (
                  <SelectComCadastro
                    label="Produto / Serviço" value={fProduct} placeholder="Selecionar..."
                    options={products.map(p => ({ id: p.id, label: p.nome }))}
                    onChange={handleProductChange}
                    createLabel="Novo produto"
                    createFields={[
                      { key: 'nome', label: 'Nome', placeholder: 'Ex: Consultoria, Setup...', required: true },
                      { key: 'tipo', label: 'Tipo', placeholder: 'servico / software / curso / outro' },
                      { key: 'valor_padrao', label: 'Valor padrão (R$)', placeholder: '0,00' },
                    ]}
                    onQuickCreate={quickCreateProduto}
                  />
                )}

                {/* Fornecedor com cadastro rápido (só saída) */}
                {fTipo === 'saida' && (
                  <SelectComCadastro
                    label="Fornecedor" value={fFornecedor} placeholder="Selecionar..."
                    options={fornecedores.map(f => ({ id: f.id, label: f.nome }))}
                    onChange={setFFornecedor}
                    createLabel="Novo fornecedor"
                    createFields={[
                      { key: 'nome', label: 'Nome', placeholder: 'Nome ou razão social', required: true },
                      { key: 'email', label: 'E-mail', placeholder: 'email@exemplo.com', type: 'email' },
                    ]}
                    onQuickCreate={quickCreateFornecedor}
                  />
                )}

                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Observações</label>
                  <textarea value={fObs} onChange={e => setFObs(e.target.value)} placeholder="Opcional" />
                </div>

                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.btnCancelForm} onClick={() => setShowForm(false)}>Cancelar</button>
                  <button type="submit" className={styles.btnSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal cadastro cliente/fornecedor (aba) ── */}
        {showCadForm && (
          <div className={styles.formOverlay} onClick={() => setShowCadForm(false)}>
            <div className={styles.formModal} onClick={e => e.stopPropagation()}>
              <div className={styles.formTitle}>
                {cadMode === 'criar'
                  ? activeTab === 'clientes' ? 'Novo cliente' : 'Novo fornecedor'
                  : activeTab === 'clientes' ? 'Editar cliente' : 'Editar fornecedor'}
              </div>
              <form onSubmit={salvarCadastro}>
                <div className={styles.formGrid}>
                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Nome *</label>
                  <input value={cadNome} onChange={e => setCadNome(e.target.value)} placeholder="Nome completo ou razão social" required />
                </div>
                <div className={styles.field}>
                  <label>CPF / CNPJ</label>
                  <input value={cadDoc} onChange={e => setCadDoc(e.target.value)} placeholder="Opcional" />
                </div>
                <div className={styles.field}>
                  <label>Telefone</label>
                  <input value={cadTel} onChange={e => setCadTel(e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>E-mail</label>
                  <input type="email" value={cadEmail} onChange={e => setCadEmail(e.target.value)} placeholder="email@exemplo.com" />
                </div>
                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Observações</label>
                  <textarea value={cadObs} onChange={e => setCadObs(e.target.value)} placeholder="Opcional" />
                </div>

                {activeTab === 'clientes' && (
                  <>
                    <CustomSelect
                      label="Assinatura mensal"
                      value={cadAssinaturaAtiva ? 'ativa' : 'inativa'}
                      menuFixed
                      options={[
                        { id: 'inativa', label: 'Sem assinatura ativa' },
                        { id: 'ativa', label: 'Assinatura ativa' },
                      ]}
                      onChange={v => setCadAssinaturaAtiva(v === 'ativa')}
                    />
                    <div className={styles.field}>
                      <label>Valor mensal (R$)</label>
                      <input value={cadMensalidadeValor} onChange={e => setCadMensalidadeValor(e.target.value)} placeholder="1000,00" />
                    </div>
                    <div className={styles.field}>
                      <label>Dia de cobrança</label>
                      <input type="number" min="1" max="31" value={cadDiaCobranca} onChange={e => setCadDiaCobranca(e.target.value)} placeholder="Ex: 5" />
                    </div>
                    <div className={`${styles.field} ${styles.formGridFull}`}>
                      <label>Descrição da assinatura</label>
                      <input value={cadMensalidadeDesc} onChange={e => setCadMensalidadeDesc(e.target.value)} placeholder="Ex: Gestão de Performance Mensal" />
                    </div>

                    <CustomSelect
                      label="Recebimento pendente agora"
                      value={cadCriarRecebimento ? 'sim' : 'nao'}
                      menuFixed
                      options={[
                        { id: 'nao', label: 'Não criar agora' },
                        { id: 'sim', label: 'Criar recebimento pendente' },
                      ]}
                      onChange={v => setCadCriarRecebimento(v === 'sim')}
                    />
                    <div className={styles.field}>
                      <label>Valor do recebimento (R$)</label>
                      <input value={cadRecebimentoValor} onChange={e => setCadRecebimentoValor(e.target.value)} placeholder="1000,00" disabled={!cadCriarRecebimento} />
                    </div>
                    <CustomDatePicker
                      caption="Competência do recebimento"
                      value={cadCriarRecebimento ? cadRecebimentoData : ''}
                      onChange={setCadRecebimentoData}
                      disabled={!cadCriarRecebimento}
                    />
                    <div className={`${styles.field} ${styles.formGridFull}`}>
                      <label>Descrição do recebimento</label>
                      <input value={cadRecebimentoDesc} onChange={e => setCadRecebimentoDesc(e.target.value)} placeholder="Ex: Setup inicial, parcela única, entrada pendente" disabled={!cadCriarRecebimento} />
                    </div>
                  </>
                )}
                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.btnCancelForm} onClick={() => setShowCadForm(false)}>Cancelar</button>
                  <button type="submit" className={styles.btnSave} disabled={cadSaving}>
                    {cadSaving ? 'Salvando...' : cadMode === 'criar' ? 'Cadastrar' : 'Salvar alterações'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal nova conta (aba Contas) ── */}
        {showContaForm && (
          <div className={styles.formOverlay} onClick={() => setShowContaForm(false)}>
            <div className={styles.formModal} onClick={e => e.stopPropagation()}>
              <div className={styles.formTitle}>Nova conta bancária</div>
              <form onSubmit={salvarConta}>
                <div className={styles.formGrid}>
                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Nome da conta *</label>
                  <input value={contaNome} onChange={e => setContaNome(e.target.value)} placeholder="Ex: Nubank PJ, Caixa Empresa" required />
                </div>
                <CustomSelect label="Tipo" value={contaTipo} menuFixed
                  options={[
                    { id: 'banco',    label: 'Conta Bancária' },
                    { id: 'carteira', label: 'Carteira / Caixa' },
                    { id: 'cartao',   label: 'Cartão de Crédito' },
                  ]}
                  onChange={v => setContaTipo(v as 'banco'|'carteira'|'cartao')}
                />
                <div className={styles.field}>
                  <label>Saldo inicial (R$)</label>
                  <input value={contaSaldo} onChange={e => setContaSaldo(e.target.value)} placeholder="0,00" />
                </div>
                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.btnCancelForm} onClick={() => setShowContaForm(false)}>Cancelar</button>
                  <button type="submit" className={styles.btnSave} disabled={contaSaving}>{contaSaving ? 'Salvando...' : 'Cadastrar'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default function FinanceiroPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando financeiro..." />}>
      <FinanceiroInner />
    </Suspense>
  )
}
