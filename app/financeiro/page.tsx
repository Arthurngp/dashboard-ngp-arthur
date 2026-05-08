'use client'
import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { parseCurrencyInput } from '@/lib/financeiro'
import {
  type ImportedCsvRow,
  type AiDuplicateMatch,
  type DupActionState,
  type ImportPreviewData,
  type ImportAlertKey,
  fmtBRL,
  fmtDate,
  normalizeContactKey,
  parseImportCsvContent,
  summarizeImportRows,
} from '@/lib/financeiro-import'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import CustomSelect from '@/components/CustomSelect'
import CustomDatePicker from '@/components/CustomDatePicker'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import { financeiroNav } from './financeiro-nav'
import styles from './financeiro.module.css'
import type {
  Tab,
  TipoFiltro,
  PeriodoTipo,
  ViewMode,
  ContatoTipo,
  ContatoFiltro,
  TransacaoSortField,
  SortDirection,
  ImportBulkField,
  Categoria,
  FinCliente,
  FinFornecedor,
  FinAccount,
  FinCostCenter,
  FinProduct,
  FinContato,
  ReceitaCnpjData,
  Transacao,
  DreCellValue,
  DreRow,
  DreData,
  ResumoData,
} from './types'
import {
  MESES,
  MESES_CURTO,
  normalizeSearchText,
  isInternalTransferTransaction,
  todayISO,
  monthStartISO,
  calcPeriodo,
  digitsOnly,
  formatCnpj,
  formatPhoneBR,
  getReceitaSnapshot,
  buildObservacoesFromCnpj,
  getContactGroupKey,
  escapeCsvValue,
  buildImportWarnings,
  getImportAlertRows,
  buildImportAlerts,
} from './utils'
import { useColResize } from './hooks'
import SelectComCadastro from './SelectComCadastro'

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
  const [periodoTipo, setPeriodoTipo]         = useState<PeriodoTipo>('mes')
  const [periodoMesEsp, setPeriodoMesEsp]     = useState(`${now.getFullYear()}-${now.getMonth() + 1}`)
  const [periodoCustomStart, setPeriodoCustomStart] = useState(monthStartISO())
  const [periodoCustomEnd, setPeriodoCustomEnd]     = useState(todayISO())
  const [showMesEspDropdown, setShowMesEspDropdown] = useState(false)
  const periodo = calcPeriodo(periodoTipo, periodoMesEsp, periodoCustomStart, periodoCustomEnd)
  // mantém mesFiltro/anoFiltro apenas para compatibilidade com aba contas
  const mesFiltro = periodoTipo === 'mes_especifico' ? Number(periodoMesEsp.split('-')[1]) : (periodoTipo === 'mes' ? now.getMonth() + 1 : 0)
  const anoFiltro = periodoTipo === 'mes_especifico' ? Number(periodoMesEsp.split('-')[0]) : (periodoTipo === 'mes' ? now.getFullYear() : 0)
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')
  const [viewMode, setViewMode]     = useState<ViewMode>('competencia')
  const [contatoFiltro, setContatoFiltro] = useState<ContatoFiltro>('todos')
  const [accountFilterId, setAccountFilterId] = useState('')
  const [transacaoSort, setTransacaoSort] = useState<{ field: TransacaoSortField; direction: SortDirection }>({
    field: 'payment_date',
    direction: 'desc',
  })

  const [transacoes, setTransacoes]     = useState<Transacao[]>([])
  const [resumo, setResumo]             = useState<ResumoData>({ entradas: 0, saidas: 0, saldo: 0 })
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
  const [fTipo, setFTipo]             = useState<'entrada' | 'saida' | 'transferencia'>('saida')
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
  const [fStatus, setFStatus]         = useState<'confirmado' | 'pendente'>('pendente')
  const [fObs, setFObs]               = useState('')
  const [saving, setSaving]           = useState(false)
  const transactionSubmitModeRef      = useRef<'close' | 'create-another'>('close')

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
  const [cadCnpjLoading, setCadCnpjLoading] = useState(false)
  const [cadCnpjError, setCadCnpjError]     = useState('')
  const [cadCnpjData, setCadCnpjData]       = useState<ReceitaCnpjData | null>(null)
  const [cadTipoContato, setCadTipoContato] = useState<ContatoTipo>('cliente')
  const [cadOrigin, setCadOrigin]           = useState<'contatos' | 'transacao-cliente' | 'transacao-fornecedor' | 'import-contato'>('contatos')

  // ── DRE ──────────────────────────────────────────────────────────────────
  const [dreData, setDreData]           = useState<DreData | null>(null)
  const [dreLoading, setDreLoading]     = useState(false)
  const [dreAno, setDreAno]             = useState(now.getFullYear())
  const [dreViewMode, setDreViewMode]   = useState<ViewMode>('competencia')
  const [dreAccountId, setDreAccountId] = useState('')

  // ── Modal nova conta bancária (aba Contas) ────────────────────────────────
  const [showContaForm, setShowContaForm] = useState(false)
  const [contaMode, setContaMode]         = useState<'criar' | 'editar'>('criar')
  const [contaEditId, setContaEditId]     = useState<string | null>(null)
  const [contaNome, setContaNome]         = useState('')
  const [contaTipo, setContaTipo]         = useState<'banco'|'carteira'|'cartao'>('banco')
  const [contaSaldo, setContaSaldo]       = useState('')
  const [contaSaving, setContaSaving]     = useState(false)
  const [accountMenuOpenId, setAccountMenuOpenId] = useState<string | null>(null)
  const [showArchivedAccounts, setShowArchivedAccounts] = useState(false)
  const [importingAccountId, setImportingAccountId] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<'single' | 'multi'>('single')
  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null)
  const [importPreviewLoading, setImportPreviewLoading] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [editingImportRowIndex, setEditingImportRowIndex] = useState<number | null>(null)
  const [editingImportRow, setEditingImportRow] = useState<ImportedCsvRow | null>(null)
  const [importContactRowIndex, setImportContactRowIndex] = useState<number | null>(null)
  const [activeImportAlert, setActiveImportAlert] = useState<ImportAlertKey | null>(null)
  const [importDupActions, setImportDupActions] = useState<Map<number, DupActionState>>(new Map())
  const [selectedDupIdx, setSelectedDupIdx] = useState<number | null>(null)
  const [dupResolveChoices, setDupResolveChoices] = useState<Record<number, Record<string, 'csv' | 'existing'>>>({})
  const [showBulkApplyPanel, setShowBulkApplyPanel] = useState(false)
  const [bulkApplyFields, setBulkApplyFields] = useState<Record<ImportBulkField, boolean>>({
    contato: true,
    categoria: true,
    tipo: true,
    status: true,
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Sync tab com query params
  useEffect(() => {
    const tab  = searchParams.get('tab')
    const tipo = searchParams.get('tipo')
    if (tab === 'clientes')     { setActiveTab('contatos'); setContatoFiltro('clientes'); return }
    if (tab === 'fornecedores') { setActiveTab('contatos'); setContatoFiltro('fornecedores'); return }
    if (tab === 'contatos')     { setActiveTab('contatos'); setContatoFiltro('todos'); return }
    if (tab === 'categorias')   { setActiveTab('categorias');   return }
    if (tab === 'contas')       { setActiveTab('contas');       return }
    if (tab === 'dre')          { setActiveTab('dre');          return }
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

  // AbortControllers por função — cancela a chamada anterior ao disparar uma nova
  const abortRefs = useRef<Record<string, AbortController>>({})

  const callFn = useCallback(async (fn: string, body: object) => {
    const s = getSession()
    if (!s) return null

    // Cancela apenas requests equivalentes. A mesma Edge Function pode servir
    // entidades diferentes em paralelo, como accounts, cost_centers e products.
    const requestKey = [
      fn,
      (body as { entity?: unknown }).entity || '',
      (body as { action?: unknown }).action || '',
    ].join(':')
    abortRefs.current[requestKey]?.abort()
    const controller = new AbortController()
    abortRefs.current[requestKey] = controller
    const signal = controller.signal

    try {
      const res = await fetchWithRetry(
        `${SURL}/functions/v1/${fn}`,
        { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), signal, cache: 'no-store' },
      )
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok && !data?.error) return { error: 'Erro inesperado ao processar a solicitação.' }
      return data
    } catch (e: any) {
      if (e?.name === 'AbortError') return null // request cancelada — ignorar
      return { error: 'Erro de conexão. Tente novamente.' }
    } finally {
      if (abortRefs.current[requestKey] === controller) delete abortRefs.current[requestKey]
    }
  }, [])

  const transacoesInflightRef = useRef(false)
  const fetchTransacoes = useCallback(async () => {
    if (transacoesInflightRef.current) return
    transacoesInflightRef.current = true
    setLoading(true)
    try {
      const p = calcPeriodo(periodoTipo, periodoMesEsp, periodoCustomStart, periodoCustomEnd)
      const data = await callFn('financeiro-transacoes', { action: 'listar', date_start: p.start, date_end: p.end, view: viewMode, account_id: accountFilterId || undefined })
      if (data === null) return // request abortada
      if (data?.error) {
        setTransacoes([])
        setResumo({ entradas: 0, saidas: 0, saldo: 0 })
        showMsg('err', data.error)
      } else if (data?.transacoes) {
        setTransacoes(data.transacoes)
      }
    } finally {
      setLoading(false)
      transacoesInflightRef.current = false
    }
  }, [callFn, periodoTipo, periodoMesEsp, periodoCustomStart, periodoCustomEnd, viewMode, accountFilterId])

  const fetchCategorias   = useCallback(async () => { const d = await callFn('financeiro-categorias',   { action: 'listar' }); if (d?.categorias)   setCategorias(d.categorias)     }, [callFn])
  const fetchClientes     = useCallback(async () => { const d = await callFn('financeiro-clientes',     { action: 'listar' }); if (d?.clientes)     setClientes(d.clientes)         }, [callFn])
  const fetchFornecedores = useCallback(async () => { const d = await callFn('financeiro-fornecedores', { action: 'listar' }); if (d?.fornecedores) setFornecedores(d.fornecedores) }, [callFn])
  const fetchAccounts     = useCallback(async () => {
    const d = await callFn('financeiro-aux', {
      entity: 'accounts',
      action: 'listar',
      show_archived: showArchivedAccounts,
    });
    if (d?.error) {
      setAccounts([])
      showMsg('err', d.error)
      return
    }
    if (d?.accounts) setAccounts(d.accounts)
  }, [callFn, showArchivedAccounts])
  const fetchCostCenters  = useCallback(async () => { const d = await callFn('financeiro-aux', { entity: 'cost_centers', action: 'listar' }); if (d?.cost_centers) setCostCenters(d.cost_centers)   }, [callFn])
  const fetchProducts     = useCallback(async () => { const d = await callFn('financeiro-aux', { entity: 'products',     action: 'listar' }); if (d?.products)     setProducts(d.products)         }, [callFn])

  const dreInflightRef = useRef(false)
  const fetchDre = useCallback(async () => {
    if (dreInflightRef.current) return
    dreInflightRef.current = true
    setDreLoading(true)
    try {
      const d = await callFn('financeiro-dre', { ano: dreAno, view: dreViewMode, account_id: dreAccountId || undefined })
      if (d === null) return // request abortada
      if (d && !d.error) setDreData(d as DreData)
    } finally {
      setDreLoading(false)
      dreInflightRef.current = false
    }
  }, [callFn, dreAno, dreViewMode, dreAccountId])

  useEffect(() => {
    if (!authorized) return
    fetchCategorias(); fetchClientes(); fetchFornecedores()
    fetchAccounts(); fetchCostCenters(); fetchProducts()
  }, [authorized, fetchCategorias, fetchClientes, fetchFornecedores, fetchAccounts, fetchCostCenters, fetchProducts])

  useEffect(() => {
    if (authorized && activeTab === 'transacoes') fetchTransacoes()
  }, [authorized, activeTab, fetchTransacoes])

  const resumoComputado = useMemo(() => {
    const semInternas = transacoes.filter(t => !isInternalTransferTransaction(t))
    const entradas = semInternas
      .filter(t => t.tipo === 'entrada')
      .reduce((sum, t) => sum + Number(t.valor || 0), 0)
    const saidas = semInternas
      .filter(t => t.tipo === 'saida')
      .reduce((sum, t) => sum + Number(t.valor || 0), 0)
    const selectedAccount = accountFilterId ? accounts.find(a => a.id === accountFilterId) || null : null
    const saldo = selectedAccount
      ? Number(selectedAccount.saldo_atual || 0)
      : accounts.reduce((sum, a) => sum + Number(a.saldo_atual || 0), 0)
    return { entradas, saidas, saldo }
  }, [accounts, accountFilterId, transacoes])

  useEffect(() => {
    setResumo(resumoComputado)
  }, [resumoComputado])

  useEffect(() => {
    if (authorized && activeTab === 'dre') fetchDre()
  }, [authorized, activeTab, fetchDre])

  useEffect(() => {
    if (!accountMenuOpenId) return
    function handleClickOutside() {
      setAccountMenuOpenId(null)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [accountMenuOpenId])

  function resetForm() {
    setFormMode('criar'); setEditId(null)
    setFTipo('saida'); setFDesc(''); setFValor('')
    setFCompDate(todayISO()); setFPayDate(todayISO())
    setFCat(''); setFCliente(''); setFFornecedor('')
    setFAccount(''); setFCostCenter(''); setFProduct('')
    setFStatus('pendente'); setFObs('')
  }

  function resetCadastroForm() {
    setCadMode('criar'); setCadEditId(null)
    setCadTipoContato('cliente')
    setCadOrigin('contatos')
    setCadNome(''); setCadDoc(''); setCadTel(''); setCadEmail(''); setCadObs('')
    setCadMensalidadeValor(''); setCadMensalidadeDesc(''); setCadDiaCobranca(''); setCadAssinaturaAtiva(false)
    setCadCriarRecebimento(false); setCadRecebimentoValor(''); setCadRecebimentoDesc(''); setCadRecebimentoData(todayISO())
    setCadCnpjLoading(false); setCadCnpjError(''); setCadCnpjData(null)
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
    setCadOrigin('contatos')
    setShowCadForm(true)
  }

  function openAccountTransacoes(account: FinAccount) {
    setAccountFilterId(account.id)
    setTipoFiltro('todos')
    setActiveTab('transacoes')
  }

  function toggleTransacaoSort(field: TransacaoSortField) {
    setTransacaoSort(current => current.field === field
      ? { field, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { field, direction: 'desc' })
  }

  function getTransacaoSortValue(transacao: Transacao, field: TransacaoSortField) {
    if (field === 'payment_date') return transacao.payment_date || ''
    if (field === 'descricao') return transacao.descricao || ''
    if (field === 'categoria') return transacao.categoria?.nome || ''
    if (field === 'cost_center') return transacao.cost_center?.nome || ''
    if (field === 'account') return transacao.account?.nome || ''
    if (field === 'tipo') return transacao.tipo || ''
    if (field === 'valor') return Number(transacao.valor || 0)
    return transacao.status || ''
  }

  function openNovoContatoDaTransacao(tipo: 'cliente' | 'fornecedor') {
    resetCadastroForm()
    setCadTipoContato(tipo)
    setCadOrigin(tipo === 'cliente' ? 'transacao-cliente' : 'transacao-fornecedor')
    setShowCadForm(true)
  }

  function openNovoContatoDaImportacao(rowIndex: number, tipo: 'entrada' | 'saida') {
    resetCadastroForm()
    setImportContactRowIndex(rowIndex)
    setCadTipoContato(tipo === 'entrada' ? 'cliente' : 'fornecedor')
    setCadOrigin('import-contato')
    setShowCadForm(true)
  }

  function openEditarContato(contato: FinContato) {
    setCadMode('editar')
    setCadEditId(contato.key)
    setCadTipoContato(contato.tipo)
    setCadNome(contato.nome || '')
    setCadDoc(contato.documento || '')
    setCadTel(contato.telefone || '')
    setCadEmail(contato.email || '')
    setCadObs(contato.observacoes || '')
    setCadMensalidadeValor(contato.mensalidade_valor != null ? String(contato.mensalidade_valor) : '')
    setCadMensalidadeDesc(contato.mensalidade_descricao || '')
    setCadDiaCobranca(contato.dia_cobranca != null ? String(contato.dia_cobranca) : '')
    setCadAssinaturaAtiva(Boolean(contato.assinatura_ativa))
    setCadCriarRecebimento(false)
    setCadRecebimentoValor('')
    setCadRecebimentoDesc('')
    setCadRecebimentoData(todayISO())
    setCadCnpjLoading(false); setCadCnpjError(''); setCadCnpjData(null)
    setCadOrigin('contatos')
    setShowCadForm(true)
  }

  async function preencherCadastroPorCnpj() {
    const digits = digitsOnly(cadDoc)
    if (digits.length !== 14) {
      setCadCnpjError('Informe um CNPJ válido com 14 dígitos.')
      setCadCnpjData(null)
      return
    }

    setCadCnpjLoading(true)
    setCadCnpjError('')
    try {
      const res = await fetch(`https://publica.cnpj.ws/cnpj/${digits}`)
      if (res.status === 404) {
        setCadCnpjError('CNPJ não encontrado na Receita Federal.')
        setCadCnpjData(null)
        return
      }
      if (res.status === 429) {
        setCadCnpjError('Muitas consultas seguidas. Aguarde um momento.')
        setCadCnpjData(null)
        return
      }
      if (!res.ok) {
        setCadCnpjError(`Erro ao consultar CNPJ (${res.status}).`)
        setCadCnpjData(null)
        return
      }

      const data = await res.json() as ReceitaCnpjData
      setCadCnpjData(data)
      setCadDoc(formatCnpj(digits))
      const snapshot = getReceitaSnapshot(data)
      setCadNome(snapshot.nome || data.razao_social || '')
      if (snapshot.email) setCadEmail(snapshot.email.toLowerCase())
      if (snapshot.phone) setCadTel(snapshot.phone)

      const obsFromCnpj = buildObservacoesFromCnpj(data)
      if (obsFromCnpj) setCadObs(obsFromCnpj)

      showMsg('ok', 'Dados do CNPJ importados.')
    } catch {
      setCadCnpjError('Não foi possível consultar o CNPJ agora.')
      setCadCnpjData(null)
    } finally {
      setCadCnpjLoading(false)
    }
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
    const shouldCreateAnother = formMode === 'criar' && transactionSubmitModeRef.current === 'create-another'
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
      showMsg('ok',
        formMode === 'criar'
          ? (shouldCreateAnother ? 'Transação criada! Preencha a próxima.' : 'Transação criada!')
          : 'Transação atualizada!',
      )
      await fetchTransacoes()
      if (shouldCreateAnother) {
        resetForm()
        setShowForm(true)
        return
      }
      setShowForm(false)
    } finally {
      transactionSubmitModeRef.current = 'close'
      setSaving(false)
    }
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
    const includeCliente = cadTipoContato === 'cliente' || cadTipoContato === 'ambos'
    const includeFornecedor = cadTipoContato === 'fornecedor' || cadTipoContato === 'ambos'
    const contatoAtual = cadMode === 'editar' ? contatos.find(contato => contato.key === cadEditId) : null
    const mensalidadeValor = parseCurrencyInput(cadMensalidadeValor)
    if (includeCliente && cadMensalidadeValor.trim() && (mensalidadeValor == null || mensalidadeValor <= 0)) {
      showMsg('err', 'Informe um valor mensal válido.')
      return
    }
    const diaCobranca = cadDiaCobranca.trim() ? Number(cadDiaCobranca) : null
    if (includeCliente && diaCobranca != null && (!Number.isInteger(diaCobranca) || diaCobranca < 1 || diaCobranca > 31)) {
      showMsg('err', 'Use um dia de cobrança entre 1 e 31.')
      return
    }
    if (includeCliente && cadAssinaturaAtiva && (mensalidadeValor == null || mensalidadeValor <= 0)) {
      showMsg('err', 'Defina um valor mensal maior que zero para ativar a assinatura.')
      return
    }
    const recebimentoValor = parseCurrencyInput(cadRecebimentoValor)
    if (includeCliente && cadCriarRecebimento && (recebimentoValor == null || recebimentoValor <= 0)) {
      showMsg('err', 'Informe um valor válido para o recebimento pendente.')
      return
    }
    if (includeCliente && cadCriarRecebimento && !cadRecebimentoData) {
      showMsg('err', 'Defina a data do recebimento pendente.')
      return
    }
    if (cadMode === 'editar' && contatoAtual?.tipo === 'ambos' && cadTipoContato !== 'ambos') {
      showMsg('err', 'Este contato existe como cliente e fornecedor. Para não perder vínculo, mantenha o tipo "Ambos".')
      return
    }
    if (cadMode === 'editar' && contatoAtual?.tipo === 'cliente' && cadTipoContato === 'fornecedor') {
      showMsg('err', 'Este contato hoje é cliente. Para ampliar o cadastro, troque para "Ambos".')
      return
    }
    if (cadMode === 'editar' && contatoAtual?.tipo === 'fornecedor' && cadTipoContato === 'cliente') {
      showMsg('err', 'Este contato hoje é fornecedor. Para ampliar o cadastro, troque para "Ambos".')
      return
    }
    setCadSaving(true)
    try {
      const basePayload = {
        nome: cadNome,
        documento: cadDoc,
        telefone: cadTel,
        email: cadEmail,
        observacoes: cadObs,
      }
      const clientePayload = {
        ...basePayload,
        mensalidade_valor: mensalidadeValor,
        mensalidade_descricao: cadMensalidadeDesc || null,
        dia_cobranca: diaCobranca,
        assinatura_ativa: cadAssinaturaAtiva,
        criar_recebimento_pendente: cadCriarRecebimento,
        recebimento_valor: recebimentoValor,
        recebimento_descricao: cadRecebimentoDesc || null,
        recebimento_competencia: cadRecebimentoData || null,
      }

      if (includeCliente) {
        const clienteAction = contatoAtual?.clienteId ? 'atualizar' : 'criar'
        const clienteData = await callFn('financeiro-clientes', {
          action: clienteAction,
          id: clienteAction === 'atualizar' ? contatoAtual?.clienteId : undefined,
          ...clientePayload,
        })
        if (clienteData?.error) { showMsg('err', clienteData.error); return }
        if (cadOrigin === 'transacao-cliente' && clienteData?.cliente?.id) setFCliente(clienteData.cliente.id)
      }

      if (includeFornecedor) {
        const fornecedorAction = contatoAtual?.fornecedorId ? 'atualizar' : 'criar'
        const fornecedorData = await callFn('financeiro-fornecedores', {
          action: fornecedorAction,
          id: fornecedorAction === 'atualizar' ? contatoAtual?.fornecedorId : undefined,
          ...basePayload,
        })
        if (fornecedorData?.error) { showMsg('err', fornecedorData.error); return }
        if (cadOrigin === 'transacao-fornecedor' && fornecedorData?.fornecedor?.id) setFFornecedor(fornecedorData.fornecedor.id)
      }

      if (cadOrigin === 'import-contato' && importContactRowIndex != null) {
        setImportPreview(prev => prev ? ({
          ...prev,
          rows: prev.rows.map((row, index) => index === importContactRowIndex ? { ...row, contato: cadNome.trim() } : row),
        }) : prev)
      }

      showMsg('ok', `Contato ${cadMode === 'criar' ? 'cadastrado' : 'atualizado'}!`)
      setShowCadForm(false)
      setImportContactRowIndex(null)
      resetCadastroForm()
      await fetchClientes()
      await fetchFornecedores()
      if (includeCliente) fetchTransacoes()
    } finally { setCadSaving(false) }
  }

  async function deletarContato(contato: FinContato) {
    const label = contato.tipo === 'ambos' ? 'este contato de cliente e fornecedor' : 'este contato'
    if (!confirm(`Remover ${label}?`)) return

    if (contato.clienteId) {
      const data = await callFn('financeiro-clientes', { action: 'deletar', id: contato.clienteId })
      if (data?.error) { showMsg('err', data.error); return }
    }
    if (contato.fornecedorId) {
      const data = await callFn('financeiro-fornecedores', { action: 'deletar', id: contato.fornecedorId })
      if (data?.error) { showMsg('err', data.error); return }
    }

    showMsg('ok', 'Contato removido.')
    await fetchClientes()
    await fetchFornecedores()
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
        entity: 'accounts', action: contaMode === 'criar' ? 'criar' : 'atualizar',
        id: contaMode === 'editar' ? contaEditId : undefined,
        nome: contaNome, tipo: contaTipo,
        saldo_inicial: saldoInicial ?? 0,
      })
      if (data?.error) { showMsg('err', data.error); return }
      showMsg('ok', contaMode === 'criar' ? 'Conta cadastrada!' : 'Conta atualizada!')
      setShowContaForm(false); setContaMode('criar'); setContaEditId(null); setContaNome(''); setContaTipo('banco'); setContaSaldo('')
      fetchAccounts()
    } finally { setContaSaving(false) }
  }

  function openNovaConta() {
    setContaMode('criar')
    setContaEditId(null)
    setContaNome('')
    setContaTipo('banco')
    setContaSaldo('')
    setShowContaForm(true)
  }

  function openEditarConta(account: FinAccount) {
    setContaMode('editar')
    setContaEditId(account.id)
    setContaNome(account.nome)
    setContaTipo(account.tipo as 'banco' | 'carteira' | 'cartao')
    setContaSaldo(String(account.saldo_inicial ?? 0))
    setAccountMenuOpenId(null)
    setShowContaForm(true)
  }

  async function deletarConta(account: FinAccount) {
    if (!confirm(`Deseja realmente arquivar a conta "${account.nome}"? Ela será removida da lista e suas transações não serão mais contabilizadas nos totais.`)) return
    setAccountMenuOpenId(null)
    const data = await callFn('financeiro-aux', { entity: 'accounts', action: 'deletar', id: account.id })
    if (data?.error) { showMsg('err', data.error); return }
    if (accountFilterId === account.id) setAccountFilterId('')
    showMsg('ok', 'Conta removida com sucesso.')
    await fetchAccounts()
    if (activeTab === 'transacoes') await fetchTransacoes()
  }

  async function restaurarConta(account: FinAccount) {
    if (!confirm(`Deseja restaurar a conta "${account.nome}"?`)) return
    setAccountMenuOpenId(null)
    const data = await callFn('financeiro-aux', { entity: 'accounts', action: 'restaurar', id: account.id })
    if (data?.error) { showMsg('err', data.error); return }
    showMsg('ok', 'Conta restaurada com sucesso.')
    await fetchAccounts()
  }

  function openAccountMenu(accountId: string) {
    setAccountMenuOpenId(prev => prev === accountId ? null : accountId)
  }

  function triggerImportForAccount(accountId: string) {
    setImportMode('single')
    setImportingAccountId(accountId)
    setAccountMenuOpenId(null)
    fileInputRef.current?.click()
  }

  function triggerImportMultiConta() {
    setImportMode('multi')
    setImportingAccountId(null)
    setAccountMenuOpenId(null)
    fileInputRef.current?.click()
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const accountId = importingAccountId
    e.currentTarget.value = ''
    if (!file || (importMode === 'single' && !accountId)) return

    const text = await file.text()
    const rows = parseImportCsvContent(text)
    if (rows.length === 0) {
      showMsg('err', 'Nenhuma linha válida encontrada no CSV.')
      setImportingAccountId(null)
      return
    }

    // Se modo multi mas CSV não tem coluna de conta, trata como single (sem account_id forçado)
    const effectiveImportMode = (importMode === 'multi' && !rows.some(row => normalizeContactKey(row.account_name ?? '')))
      ? 'single'
      : importMode

    const accountName = effectiveImportMode === 'multi'
      ? 'Importação multi-conta'
      : (accounts.find(account => account.id === accountId)?.nome || 'Conta selecionada')
    setImportPreviewLoading(true)
    try {
      const analysis = await callFn('financeiro-transacoes', {
        action: 'analisar_importacao_csv',
        account_id: effectiveImportMode === 'single' ? accountId : undefined,
        rows,
      })
      console.log('[DEBUG] Analysis response:', analysis)
      if (analysis?.error) { showMsg('err', analysis.error); return }
      setImportPreview({
        accountId: effectiveImportMode === 'single' ? accountId : null,
        accountName,
        fileName: file.name,
        rows,
        analysis,
      })
      setActiveImportAlert(null)
      // Inicializa todas as duplicatas como 'pending'.
      // Pré-seleciona 'transfer' quando a IA marcou como transferência interna no reason.
      const dups: AiDuplicateMatch[] = analysis?.potential_duplicates || []
      const actionsMap = new Map<number, DupActionState>()
      for (const d of dups) {
        const reason = (d.reason || '').toUpperCase()
        const isInternalTransfer = reason.includes('TRANSFERÊNCIA INTERNA') || reason.includes('TRANSFERENCIA INTERNA')
        actionsMap.set(d.csv_index, { action: isInternalTransfer ? 'transfer' : 'pending' })
      }
      setImportDupActions(actionsMap)
    } finally {
      setImportPreviewLoading(false)
      setImportingAccountId(null)
    }
  }

  async function confirmImportPreview() {
    if (!importPreview) return
    // Verifica se há duplicatas pendentes
    const pendingDups = Array.from(importDupActions.values()).filter(a => a.action === 'pending')
    if (pendingDups.length > 0) {
      showMsg('err', `Resolva ${pendingDups.length} duplicata${pendingDups.length > 1 ? 's' : ''} antes de importar.`)
      return
    }

    setImportPreviewLoading(true)
    const duplicates = importPreview.analysis?.potential_duplicates || []

    try {
      // 1. Executar combinações primeiro
      let combined = 0
      for (const dup of duplicates) {
        const dupAction = importDupActions.get(dup.csv_index)
        if (dupAction?.action !== 'combine') continue
        const csvRow = importPreview.rows[dup.csv_index]
        const res = await callFn('financeiro-transacoes', {
          action: 'combinar_transacao',
          existing_id: dup.existing_id,
          chosen_status: dupAction.chosenStatus || dup.existing_status,
          csv_payment_date: csvRow?.payment_date,
        })
        if (res?.error) { showMsg('err', res.error); return }
        combined++
      }

      // 2. Determinar quais linhas importar (excluir as combinadas)
      const combineIndices = new Set(
        duplicates.filter(d => importDupActions.get(d.csv_index)?.action === 'combine').map(d => d.csv_index)
      )
      // Linhas marcadas como transferência interna: vão ser importadas, mas com tipo='transferencia'
      const transferIndices = new Set(
        duplicates.filter(d => importDupActions.get(d.csv_index)?.action === 'transfer').map(d => d.csv_index)
      )
      const allOriginalRows = importPreview.rows
      const rowsToImport = allOriginalRows
        .map((row, i) => transferIndices.has(i) ? { ...row, tipo: 'transferencia' as const } : row)
        .filter((_, i) => !combineIndices.has(i))

      // 3. Importar as linhas restantes em batches
      const BATCH_SIZE = 500
      const totalBatches = Math.ceil(rowsToImport.length / BATCH_SIZE)
      setImportProgress({ done: 0, total: rowsToImport.length })
      let totalImported = 0
      let totalSkipped = 0

      for (let i = 0; i < totalBatches; i++) {
        const batch = rowsToImport.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        const data = await callFn('financeiro-transacoes', {
          action: 'importar_csv',
          account_id: importPreview.accountId || undefined,
          rows: batch,
        })
        if (data?.error) { showMsg('err', data.error); return }
        totalImported += data.imported || 0
        totalSkipped += data.skipped || 0
        setImportProgress({ done: Math.min((i + 1) * BATCH_SIZE, rowsToImport.length), total: rowsToImport.length })
      }

      const transferCount = transferIndices.size
      const parts = [`${totalImported} importados`]
      if (combined > 0) parts.push(`${combined} combinados`)
      if (transferCount > 0) parts.push(`${transferCount} como transferência`)
      if (totalSkipped > 0) parts.push(`${totalSkipped} ignorados`)
      const periodoAviso = periodoTipo !== 'tudo' ? ' · Ajuste o filtro de período se não aparecerem na lista.' : ''
      showMsg('ok', `Importação concluída: ${parts.join(', ')}.${periodoAviso}`)
      setImportPreview(null)
      setEditingImportRowIndex(null)
      setEditingImportRow(null)
      setActiveImportAlert(null)
      setImportDupActions(new Map())
      setSelectedDupIdx(null)
      setDupResolveChoices({})
      await fetchAccounts()
      if (activeTab === 'transacoes') await fetchTransacoes()
    } finally {
      setImportPreviewLoading(false)
      setImportProgress(null)
    }
  }

  function startImportRowEdit(index: number) {
    if (!importPreview?.rows[index]) return
    setEditingImportRowIndex(index)
    setEditingImportRow({ ...importPreview.rows[index] })
  }

  function cancelImportRowEdit() {
    setEditingImportRowIndex(null)
    setEditingImportRow(null)
    setShowBulkApplyPanel(false)
  }

  function saveImportRowEdit() {
    if (editingImportRowIndex == null || !editingImportRow || !importPreview) return
    if (!editingImportRow.descricao.trim()) {
      showMsg('err', 'A descrição da linha é obrigatória.')
      return
    }
    if (!editingImportRow.competence_date) {
      showMsg('err', 'A data de competência é obrigatória.')
      return
    }
    if (Number(editingImportRow.valor) <= 0) {
      showMsg('err', 'O valor da linha deve ser maior que zero.')
      return
    }

    setImportPreview({
      ...importPreview,
      rows: importPreview.rows.map((row, index) => index === editingImportRowIndex ? {
        ...editingImportRow,
        descricao: editingImportRow.descricao.trim(),
        contato: editingImportRow.contato?.trim() || null,
        categoria: editingImportRow.categoria?.trim() || null,
        cost_center: editingImportRow.cost_center?.trim() || null,
        additional_info: editingImportRow.additional_info?.trim() || null,
        attachments: editingImportRow.attachments?.trim() || null,
        tags: editingImportRow.tags?.trim() || null,
        payment_date: editingImportRow.status === 'confirmado'
          ? (editingImportRow.payment_date || editingImportRow.competence_date)
          : null,
      } : row),
    })
    cancelImportRowEdit()
  }

  function applyImportEditToFilteredRows() {
    if (editingImportRowIndex == null || !editingImportRow || !importPreview || !activeImportAlert) return
    if (!Object.values(bulkApplyFields).some(Boolean)) {
      showMsg('err', 'Selecione pelo menos um campo para aplicar em lote.')
      return
    }
    const filteredRows = getImportAlertRows(importPreview.rows, activeImportAlert)
    const filteredIndexes = new Set(
      filteredRows.map(row => importPreview.rows.indexOf(row)).filter(index => index >= 0),
    )

    setImportPreview({
      ...importPreview,
      rows: importPreview.rows.map((row, index) => {
        if (!filteredIndexes.has(index)) return row
        return {
          ...row,
          contato: bulkApplyFields.contato ? (editingImportRow.contato?.trim() || null) : row.contato,
          categoria: bulkApplyFields.categoria ? (editingImportRow.categoria?.trim() || null) : row.categoria,
          tipo: bulkApplyFields.tipo ? editingImportRow.tipo : row.tipo,
          status: bulkApplyFields.status ? editingImportRow.status : row.status,
          payment_date: bulkApplyFields.status
            ? (editingImportRow.status === 'confirmado' ? (row.payment_date || row.competence_date) : null)
            : row.payment_date,
        }
      }),
    })

    showMsg('ok', `Campos aplicados em ${filteredIndexes.size} linhas filtradas.`)
    setShowBulkApplyPanel(false)
  }

  async function exportAccountCsv(account: FinAccount) {
    setAccountMenuOpenId(null)
    const data = await callFn('financeiro-transacoes', {
      action: 'listar',
      account_id: account.id,
      view: 'competencia',
    })
    if (data?.error) { showMsg('err', data.error); return }

    const rows = (data?.transacoes || []).map((t: Transacao) => {
      const competencia = fmtDate(t.competence_date || t.data_transacao)
      const pagamento = t.payment_date ? fmtDate(t.payment_date) : ''
      const contato = t.tipo === 'entrada' ? (t.cliente?.nome || '') : (t.fornecedor?.nome || '')
      const valor = t.tipo === 'saida' ? `R$ -${fmtBRL(t.valor).replace('R$', '').trim()}` : `R$ ${fmtBRL(t.valor).replace('R$', '').trim()}`
      return [
        competencia,
        '',
        pagamento,
        t.descricao,
        t.status === 'confirmado' ? 'Pago' : 'Não Pago',
        contato,
        '',
        t.observacoes || '',
        '',
        account.nome,
        t.source_tag || '',
        t.categoria?.nome || '',
        t.cost_center?.nome || '',
        valor,
      ]
    })

    const header = [
      'Data competência','Data vencimento','Data pagamento','Descrição','Situação','Contato','Tags','Informações adicionais','Anexos','Conta/cartão','Origem','Categoria','Centro de custo','Valor',
    ]
    const csv = [header, ...rows].map(row => row.map(escapeCsvValue).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lancamentos-${account.nome.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    showMsg('ok', 'CSV exportado com sucesso.')
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

  async function quickCreateCostCenter(fields: Record<string, string>): Promise<boolean> {
    const data = await callFn('financeiro-aux', {
      entity: 'cost_centers',
      action: 'criar',
      nome: fields.nome,
      descricao: fields.descricao || null,
    })
    if (data?.error) { showMsg('err', data.error); return false }
    await fetchCostCenters()
    if (data?.cost_center) setFCostCenter(data.cost_center.id)
    showMsg('ok', 'Centro de custo cadastrado!')
    return true
  }

  async function quickCreateCategoria(fields: Record<string, string>): Promise<boolean> {
    const data = await callFn('financeiro-categorias', {
      action: 'criar',
      nome: fields.nome,
      tipo: fTipo,
      cor: fields.cor || '#6b7280',
    })
    if (data?.error) { showMsg('err', data.error); return false }
    await fetchCategorias()
    if (data?.categoria) setFCat(data.categoria.id)
    showMsg('ok', 'Categoria cadastrada!')
    return true
  }

  const contatos = (() => {
    const grouped = new Map<string, FinContato>()

    for (const cliente of clientes) {
      const key = getContactGroupKey(cliente)
      const current = grouped.get(key)
      grouped.set(key, {
        key,
        nome: current?.nome || cliente.nome,
        documento: current?.documento || cliente.documento,
        telefone: current?.telefone || cliente.telefone,
        email: current?.email || cliente.email,
        observacoes: current?.observacoes || cliente.observacoes,
        tipo: current?.fornecedorId ? 'ambos' : 'cliente',
        clienteId: cliente.id,
        fornecedorId: current?.fornecedorId,
        mensalidade_valor: cliente.mensalidade_valor,
        mensalidade_descricao: cliente.mensalidade_descricao,
        dia_cobranca: cliente.dia_cobranca,
        assinatura_ativa: cliente.assinatura_ativa,
      })
    }

    for (const fornecedor of fornecedores) {
      const key = getContactGroupKey(fornecedor)
      const current = grouped.get(key)
      grouped.set(key, {
        key,
        nome: current?.nome || fornecedor.nome,
        documento: current?.documento || fornecedor.documento,
        telefone: current?.telefone || fornecedor.telefone,
        email: current?.email || fornecedor.email,
        observacoes: current?.observacoes || fornecedor.observacoes,
        tipo: current?.clienteId ? 'ambos' : 'fornecedor',
        clienteId: current?.clienteId,
        fornecedorId: fornecedor.id,
        mensalidade_valor: current?.mensalidade_valor,
        mensalidade_descricao: current?.mensalidade_descricao,
        dia_cobranca: current?.dia_cobranca,
        assinatura_ativa: current?.assinatura_ativa,
      })
    }

    return Array.from(grouped.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  })()

  const contatosFiltrados = useMemo(() => contatos.filter(contato => {
    if (contatoFiltro === 'todos') return true
    if (contatoFiltro === 'clientes') return contato.tipo === 'cliente' || contato.tipo === 'ambos'
    if (contatoFiltro === 'fornecedores') return contato.tipo === 'fornecedor' || contato.tipo === 'ambos'
    return contato.tipo === 'ambos'
  }), [contatos, contatoFiltro])

  const transacoesFiltradas = useMemo(() =>
    transacoes
      .filter(t => tipoFiltro === 'todos' || t.tipo === tipoFiltro)
      .sort((a, b) => {
        const aValue = getTransacaoSortValue(a, transacaoSort.field)
        const bValue = getTransacaoSortValue(b, transacaoSort.field)
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return transacaoSort.direction === 'asc' ? aValue - bValue : bValue - aValue
        }
        const comparison = String(aValue).localeCompare(String(bValue), 'pt-BR', { numeric: true, sensitivity: 'base' })
        return transacaoSort.direction === 'asc' ? comparison : -comparison
      }),
  [transacoes, tipoFiltro, transacaoSort])

  const catsFiltradas = useMemo(() => categorias.filter(c => c.tipo === fTipo), [categorias, fTipo])

  const resumoLabel = viewMode === 'competencia' ? 'Competência (DRE)' : 'Caixa (Pagos)'

  const selectedAccountFilter = useMemo(
    () => accountFilterId ? accounts.find(a => a.id === accountFilterId) || null : null,
    [accountFilterId, accounts],
  )

  const importSummary = useMemo(
    () => importPreview ? summarizeImportRows(importPreview.rows) : null,
    [importPreview],
  )
  const importWarnings = useMemo(
    () => importPreview ? buildImportWarnings(importPreview.rows) : [],
    [importPreview],
  )
  const importAlerts = useMemo(
    () => importPreview ? buildImportAlerts(importPreview.rows) : [],
    [importPreview],
  )
  const importContactOptions = useMemo(
    () => contatos.map(contato => ({ value: contato.nome, label: contato.nome })),
    [contatos],
  )
  const importRowsToDisplay = useMemo(
    () => importPreview
      ? (activeImportAlert ? getImportAlertRows(importPreview.rows, activeImportAlert) : importPreview.rows)
      : [],
    [importPreview, activeImportAlert],
  )
  const sortableHeaders: { field: TransacaoSortField; label: string }[] = [
    { field: 'payment_date', label: 'Pagamento' },
    { field: 'descricao', label: 'Descrição' },
    { field: 'categoria', label: 'Categoria' },
    { field: 'cost_center', label: 'Centro' },
    { field: 'account', label: 'Conta' },
    { field: 'tipo', label: 'Tipo' },
    { field: 'valor', label: 'Valor' },
    { field: 'status', label: 'Status' },
  ]
  // col 0=Competência, 1=Pagamento, 2=Descrição, 3=Categoria, 4=Centro, 5=Conta, 6=Tipo, 7=Valor, 8=Status, 9=Ações
  const { widths: colWidths, onMouseDown: colResizeDown } = useColResize([130, 130, 280, 180, 130, 140, 110, 140, 130, 200])

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
                  {viewMode === 'competencia'
                    ? 'Entradas e saídas mostram o período por competência, sem contar transferências internas; o saldo mostra o caixa geral acumulado das contas.'
                    : 'Entradas e saídas mostram apenas transações pagas no período, sem contar transferências internas; o saldo mostra o caixa geral acumulado das contas.'}
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
                  <div className={styles.resumoLabel}>Saldo geral</div>
                  <div className={`${styles.resumoValue} ${styles.resumoSaldo}`} style={{ color: resumo.saldo >= 0 ? '#059669' : '#DC2626' }}>{fmtBRL(resumo.saldo)}</div>
                </div>
              </div>

              <div className={styles.toolbar}>
                <div className={styles.toolbarLeft}>
                  <div className={styles.periodoFiltroWrap}>
                    <CustomSelect
                      value={periodoTipo}
                      options={[
                        { id: 'hoje',          label: 'Hoje' },
                        { id: 'semana',        label: 'Esta semana' },
                        { id: 'mes',           label: 'Este mês' },
                        { id: '30dias',        label: 'Últimos 30 dias' },
                        { id: 'ultimo_mes',    label: 'Último mês' },
                        { id: 'trimestre',     label: 'Este trimestre' },
                        { id: 'ano',           label: `Ano ${now.getFullYear()}` },
                        { id: 'mes_especifico',label: 'Mês específico…' },
                        { id: 'personalizado', label: 'Personalizado…' },
                        { id: 'tudo',          label: 'Todo o período' },
                      ]}
                      onChange={v => setPeriodoTipo(v as PeriodoTipo)}
                      className={styles.selectMesCustom}
                    />
                    {periodoTipo === 'mes_especifico' && (
                      <CustomSelect
                        value={periodoMesEsp}
                        options={[
                          ...MESES.map((nome, i) => ({ id: `${2022}-${i + 1}`, label: `${nome} 2022` })),
                          ...MESES.map((nome, i) => ({ id: `${2023}-${i + 1}`, label: `${nome} 2023` })),
                          ...MESES.map((nome, i) => ({ id: `${2024}-${i + 1}`, label: `${nome} 2024` })),
                          ...MESES.map((nome, i) => ({ id: `${2025}-${i + 1}`, label: `${nome} 2025` })),
                          ...MESES.map((nome, i) => ({ id: `${2026}-${i + 1}`, label: `${nome} 2026` })),
                        ]}
                        onChange={v => setPeriodoMesEsp(v)}
                        className={styles.selectMesCustom}
                      />
                    )}
                    {periodoTipo === 'personalizado' && (
                      <div className={styles.periodoCustomInputs}>
                        <input type="date" className={styles.periodoDateInput} value={periodoCustomStart} onChange={e => setPeriodoCustomStart(e.target.value)} />
                        <span className={styles.periodoDateSep}>até</span>
                        <input type="date" className={styles.periodoDateInput} value={periodoCustomEnd} onChange={e => setPeriodoCustomEnd(e.target.value)} />
                      </div>
                    )}
                  </div>
                  <div className={styles.filtroTipo}>
                    {(['todos','entrada','saida'] as TipoFiltro[]).map(f => (
                      <button key={f} className={`${styles.filtroBtn} ${tipoFiltro === f ? styles.filtroBtnActive : ''}`} onClick={() => setTipoFiltro(f)}>
                        {f === 'todos' ? 'Todos' : f === 'entrada' ? 'Entradas' : 'Saídas'}
                      </button>
                    ))}
                  </div>
                  <CustomSelect
                    value={accountFilterId}
                    options={[{ id: '', label: 'Todas as contas' }, ...accounts.map(account => ({ id: account.id, label: account.nome }))]}
                    onChange={setAccountFilterId}
                    className={styles.selectMesCustom}
                  />
                </div>
                <button className={styles.btnNovo} onClick={openNovaTransacao}>+ Nova transação</button>
              </div>

              {selectedAccountFilter && (
                <div className={styles.filterInfoBar}>
                  Mostrando transações da conta <strong>{selectedAccountFilter.nome}</strong>.
                  <button type="button" className={styles.filterInfoAction} onClick={() => router.push(`/financeiro/conciliacao/${selectedAccountFilter.id}`)}>🔀 Conciliar extrato</button>
                  <button type="button" className={styles.filterInfoAction} onClick={() => setAccountFilterId('')}>Ver todas</button>
                </div>
              )}

              {loading ? (
                <div className={styles.empty}>Carregando...</div>
              ) : transacoesFiltradas.length === 0 ? (
                <div className={styles.empty}>Nenhuma transação encontrada para este período.</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.transacoesTable}`} style={{ tableLayout: 'fixed', width: colWidths.reduce((a, b) => a + b, 0) }}>
                    <colgroup>
                      {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ position: 'relative' }}>
                          Competência
                          <span className={styles.colResizer} onMouseDown={colResizeDown(0)} />
                        </th>
                        {sortableHeaders.map((header, i) => (
                          <th key={header.field} style={{ position: 'relative' }}>
                            <button
                              type="button"
                              className={`${styles.sortHeaderBtn} ${transacaoSort.field === header.field ? styles.sortHeaderBtnActive : ''}`}
                              onClick={() => toggleTransacaoSort(header.field)}
                            >
                              <span>{header.label}</span>
                              <span className={styles.sortHeaderArrow}>
                                {transacaoSort.field === header.field
                                  ? (transacaoSort.direction === 'desc' ? '↓' : '↑')
                                  : '↓'}
                              </span>
                            </button>
                            <span className={styles.colResizer} onMouseDown={colResizeDown(i + 1)} />
                          </th>
                        ))}
                        <th className={styles.actionsHeader} style={{ position: 'relative' }}>
                          Ações
                          <span className={styles.colResizer} onMouseDown={colResizeDown(9)} />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {transacoesFiltradas.map(t => {
                        const isPago = t.status === 'confirmado'
                        return (
                        <tr key={t.id}>
                          <td className={styles.tdMuted}>{fmtDate(t.competence_date || t.data_transacao)}</td>
                          <td className={styles.tdMuted}>{fmtDate(t.payment_date)}</td>
                          <td>
                            <div className={styles.cellEllipsis} title={t.descricao}>{t.descricao}</div>
                            {t.source_type === 'api' && (
                              <div className={styles.sourceTag} title={t.source_message || t.source_tag || 'Lançamento criado via API'}>
                                {t.source_tag || 'API'}
                              </div>
                            )}
                            {t.product && <div className={styles.tdSub}>{t.product.nome}</div>}
                          </td>
                          <td>
                            {t.categoria
                              ? <span className={styles.cellEllipsis} title={t.categoria.nome}><span className={styles.catDot} style={{ background: t.categoria.cor }} />{t.categoria.nome}</span>
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
                            <span className={`${styles.statusBadge} ${
                              t.status === 'confirmado'
                                ? styles.statusConfirmado
                                : t.status === 'pendente'
                                  ? styles.statusPendente
                                  : styles.statusCancelado
                            }`}>
                              {t.status === 'confirmado' ? 'Pago' : t.status === 'pendente' ? 'Pendente' : 'Cancelado'}
                            </span>
                          </td>
                          <td className={styles.actionsCell}>
                            <div className={styles.rowActions}>
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

          {/* ── CONTATOS ── */}
          {activeTab === 'contatos' && (
            <>
              <div className={styles.toolbar}>
                <div className={styles.toolbarLeft}>
                  <span style={{ fontSize: 13, color: '#8E8E93' }}>{contatosFiltrados.length} contato{contatosFiltrados.length !== 1 ? 's' : ''}</span>
                  <div className={styles.filtroTipo}>
                    {([
                      { id: 'todos', label: 'Todos' },
                      { id: 'clientes', label: 'Clientes' },
                      { id: 'fornecedores', label: 'Fornecedores' },
                      { id: 'ambos', label: 'Ambos' },
                    ] as { id: ContatoFiltro; label: string }[]).map(f => (
                      <button key={f.id} className={`${styles.filtroBtn} ${contatoFiltro === f.id ? styles.filtroBtnActive : ''}`} onClick={() => setContatoFiltro(f.id)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className={styles.btnNovo} onClick={openNovoCadastro}>+ Novo contato</button>
              </div>
              {contatosFiltrados.length === 0 ? <div className={styles.empty}>Nenhum contato encontrado neste filtro.</div> : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Nome</th><th>Tipo</th><th>Documento</th><th>Telefone</th><th>E-mail</th><th>Detalhes</th><th></th></tr>
                    </thead>
                    <tbody>
                  {contatosFiltrados.map(contato => (
                    <tr key={contato.key}>
                      <td>
                        <div className={styles.cadastroNome}>{contato.nome}</div>
                      </td>
                      <td>
                        <span className={`${styles.tipoBadge} ${contato.tipo === 'cliente' ? styles.tipoEntrada : contato.tipo === 'fornecedor' ? styles.tipoSaida : styles.statusConfirmado}`}>
                          {contato.tipo === 'cliente' ? 'Cliente' : contato.tipo === 'fornecedor' ? 'Fornecedor' : 'Ambos'}
                        </span>
                      </td>
                      <td className={styles.tdMuted}>{contato.documento || '—'}</td>
                      <td className={styles.tdMuted}>{contato.telefone || '—'}</td>
                      <td className={styles.tdMuted}>{contato.email || '—'}</td>
                      <td>
                        <div className={styles.listMain}>
                          {(contato.mensalidade_valor != null || contato.mensalidade_descricao || contato.dia_cobranca != null) && (
                            <div className={styles.listSubmeta}>
                              {contato.mensalidade_valor != null && (
                                <span className={`${styles.cadastroRecurring} ${contato.assinatura_ativa ? styles.cadastroRecurringActive : styles.cadastroRecurringPaused}`}>
                                  {contato.assinatura_ativa ? 'Assinatura ativa' : 'Assinatura cadastrada'} · {fmtBRL(contato.mensalidade_valor)}
                                </span>
                              )}
                              {contato.dia_cobranca != null && <span>Cobrança dia {contato.dia_cobranca}</span>}
                              {contato.mensalidade_descricao && <span>{contato.mensalidade_descricao}</span>}
                            </div>
                          )}
                          {contato.observacoes && <div className={styles.tdSub}>{contato.observacoes}</div>}
                        </div>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button className={styles.actionBtn} onClick={() => openEditarContato(contato)}>Editar</button>
                          {contato.clienteId && contato.assinatura_ativa && contato.mensalidade_valor != null && contato.mensalidade_valor > 0 && (
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnRecurring}`}
                              onClick={() => {
                                const cliente = clientes.find(c => c.id === contato.clienteId)
                                if (cliente) lancarMensalidade(cliente)
                              }}
                            >
                              Lançar mensalidade
                            </button>
                          )}
                          {contato.clienteId && (
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnRecurring}`}
                              onClick={() => {
                                const cliente = clientes.find(c => c.id === contato.clienteId)
                                if (cliente) abrirRecebimentoPendenteCliente(cliente)
                              }}
                            >
                              Recebimento pendente
                            </button>
                          )}
                          <button className={`${styles.actionBtn} ${styles.actionBtnDel}`} onClick={() => deletarContato(contato)}>Remover</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                    </tbody>
                  </table>
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
                <div className={styles.listWrap}>
                  {categorias.map(c => (
                    <div key={c.id} className={styles.listRow}>
                      <div className={styles.listMain}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.cor, flexShrink: 0, display: 'inline-block' }} />
                          <div className={styles.cadastroNome}>{c.nome}</div>
                        </div>
                        <div className={styles.listMeta}>
                          <span>{c.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span>
                        </div>
                      </div>
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
                <div className={styles.toolbarLeft}>
                  <span style={{ fontSize: 13, color: '#8E8E93' }}>{accounts.length} conta{accounts.length !== 1 ? 's' : ''}</span>
                  <button type="button" className={styles.filtroBtn} onClick={() => setShowArchivedAccounts(!showArchivedAccounts)}>
                    {showArchivedAccounts ? 'Ver Ativas' : 'Ver Arquivadas'}
                  </button>
                </div>
                <button className={styles.btnNovo} onClick={openNovaConta}>+ Nova conta</button>
              </div>
              {accounts.length === 0 ? <div className={styles.empty}>Nenhuma conta bancária cadastrada. Adicione uma para controlar seu saldo real.</div> : (
                <div className={styles.listWrap}>
                  {accounts.map(a => (
                    <div
                      key={a.id}
                      className={`${styles.listRow} ${styles.listRowClickable}`}
                      style={accountMenuOpenId === a.id ? { zIndex: 50 } : undefined}
                      onClick={() => openAccountTransacoes(a)}
                    >
                      <div className={styles.listMain}>
                        <div className={styles.cadastroNome}>{a.nome}</div>
                        <div className={styles.listMeta}>
                          <span>{a.tipo}</span>
                          <span>Saldo inicial: {fmtBRL(a.saldo_inicial)}</span>
                        </div>
                      </div>
                      <div className={styles.accountRowAside}>
                        <div className={styles.listValue} style={{ color: a.saldo_atual >= 0 ? '#059669' : '#DC2626' }}>
                          {fmtBRL(a.saldo_atual)}
                        </div>
                        {mesFiltro > 0 && <div className={styles.tdSub} style={{ fontSize: 10, textAlign: 'right' }}>em {MESES[mesFiltro-1]} {anoFiltro}</div>}
                        <div className={styles.accountMenuWrap}>
                          <button className={styles.iconMenuBtn} type="button" onClick={(e) => { e.stopPropagation(); openAccountMenu(a.id) }} aria-label="Ações da conta">
                            ⋯
                          </button>
                          {accountMenuOpenId === a.id && (
                            <div className={styles.accountMenu} onClick={e => e.stopPropagation()}>
                              <button type="button" className={styles.accountMenuItem} onClick={() => openEditarConta(a)}>Editar conta</button>
                              <button type="button" className={styles.accountMenuItem} onClick={() => router.push(`/financeiro/conciliacao/${a.id}`)}>🔀 Conciliar extrato</button>
                              <button type="button" className={styles.accountMenuItem} onClick={() => void exportAccountCsv(a)}>Exportar CSV</button>
                              {showArchivedAccounts ? (
                                <button type="button" className={styles.accountMenuItem} onClick={() => void restaurarConta(a)}>Restaurar conta</button>
                              ) : (
                                <button type="button" className={`${styles.accountMenuItem} ${styles.accountMenuItemDanger}`} onClick={() => void deletarConta(a)}>Arquivar conta</button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── DRE ── */}
          {activeTab === 'dre' && (() => {
            const hoje = new Date()
            const mesAtualIdx = dreAno === hoje.getFullYear() ? hoje.getMonth() : (dreAno < hoje.getFullYear() ? 11 : -1)
            // mesAtualIdx: índice 0-11 do mês atual; meses > mesAtualIdx são futuros
            const isFuturo = (i: number) => dreAno > hoje.getFullYear() || (dreAno === hoje.getFullYear() && i > mesAtualIdx)
            const fmtCell = (c: DreCellValue, tipo: 'entrada' | 'saida', futuro: boolean) => {
              const cellCls = tipo === 'entrada' ? styles.dreCellEntrada : styles.dreCellSaida
              const wrapCls = futuro ? `${cellCls} ${styles.dreCellFuturo}` : cellCls
              return (
                <td className={wrapCls}>
                  {c.confirmado > 0
                    ? <span>{fmtBRL(c.confirmado)}</span>
                    : <span className={styles.dreMuted}>—</span>
                  }
                  {c.pendente > 0 && <span className={styles.drePendente}>+{fmtBRL(c.pendente)}</span>}
                </td>
              )
            }
            const totalConf = (arr: DreCellValue[]) => arr.reduce((s,c) => s + c.confirmado, 0)
            const totalPend = (arr: DreCellValue[]) => arr.reduce((s,c) => s + c.pendente, 0)

            return (
              <>
                <div className={styles.toolbar}>
                  <div className={styles.toolbarLeft}>
                    <button className={`${styles.filtroBtn} ${dreViewMode === 'competencia' ? styles.filtroBtnActive : ''}`} onClick={() => setDreViewMode('competencia')}>Competência</button>
                    <button className={`${styles.filtroBtn} ${dreViewMode === 'caixa' ? styles.filtroBtnActive : ''}`} onClick={() => setDreViewMode('caixa')}>Caixa</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button className={styles.filtroBtn} onClick={() => setDreAno(a => a - 1)}>‹</button>
                      <span style={{ fontSize: 14, fontWeight: 600, minWidth: 44, textAlign: 'center' }}>{dreAno}</span>
                      <button className={styles.filtroBtn} onClick={() => setDreAno(a => a + 1)}>›</button>
                    </div>
                    <div style={{ minWidth: 180 }}>
                      <CustomSelect
                        label=""
                        value={dreAccountId}
                        options={[{ id: '', label: 'Todas as contas' }, ...accounts.map(a => ({ id: a.id, label: a.nome }))]}
                        onChange={v => setDreAccountId(v)}
                      />
                    </div>
                  </div>
                </div>

                {dreLoading ? (
                  <div className={styles.empty}>Carregando DRE...</div>
                ) : !dreData ? (
                  <div className={styles.empty}>Selecione um ano para visualizar o DRE.</div>
                ) : (
                  <div className={styles.dreWrap}>
                    <table className={styles.dreTable}>
                      <thead>
                        <tr>
                          <th className={styles.dreThCat}>Categoria</th>
                          {MESES_CURTO.map((m, i) => (
                            <th key={m} className={`${styles.dreThMes} ${isFuturo(i) ? styles.dreThFuturo : ''}`}>{m}</th>
                          ))}
                          <th className={styles.dreThTotal}>Total</th>
                          <th className={styles.dreThTotal}>Projetado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* ── RECEITAS ── */}
                        <tr className={styles.dreGroupHeader}>
                          <td colSpan={15}>RECEITAS</td>
                        </tr>
                        {dreData.entradas.map(row => {
                          const conf = row.meses.reduce((s,c) => s + c.confirmado, 0)
                          const pend = row.meses.reduce((s,c) => s + c.pendente, 0)
                          return (
                            <tr key={row.categoria_id ?? 'sem-cat-entrada'} className={styles.dreRow}>
                              <td className={styles.dreCatNome}>{row.categoria_nome}</td>
                              {row.meses.map((c, i) => fmtCell(c, 'entrada', isFuturo(i)))}
                              <td className={styles.dreTotalConf}><strong>{fmtBRL(conf)}</strong></td>
                              <td className={styles.dreTotalProj}>{pend > 0 ? <span>{fmtBRL(conf + pend)}</span> : <span className={styles.dreMuted}>—</span>}</td>
                            </tr>
                          )
                        })}
                        <tr className={styles.dreTotalRow}>
                          <td className={styles.dreCatNome}>Total Receitas</td>
                          {dreData.total_entradas.map((c, i) => fmtCell(c, 'entrada', isFuturo(i)))}
                          <td className={`${styles.dreTotalConf} ${styles.dreCellEntrada}`}><strong>{fmtBRL(totalConf(dreData.total_entradas))}</strong></td>
                          <td className={`${styles.dreTotalProj} ${styles.dreCellEntrada}`}><strong>{fmtBRL(totalConf(dreData.total_entradas) + totalPend(dreData.total_entradas))}</strong></td>
                        </tr>

                        {/* ── DESPESAS ── */}
                        <tr className={styles.dreGroupHeader}>
                          <td colSpan={15}>DESPESAS</td>
                        </tr>
                        {dreData.saidas.map(row => {
                          const conf = row.meses.reduce((s,c) => s + c.confirmado, 0)
                          const pend = row.meses.reduce((s,c) => s + c.pendente, 0)
                          return (
                            <tr key={row.categoria_id ?? 'sem-cat-saida'} className={styles.dreRow}>
                              <td className={styles.dreCatNome}>{row.categoria_nome}</td>
                              {row.meses.map((c, i) => fmtCell(c, 'saida', isFuturo(i)))}
                              <td className={styles.dreTotalConf}><strong>{fmtBRL(conf)}</strong></td>
                              <td className={styles.dreTotalProj}>{pend > 0 ? <span>{fmtBRL(conf + pend)}</span> : <span className={styles.dreMuted}>—</span>}</td>
                            </tr>
                          )
                        })}
                        <tr className={styles.dreTotalRow}>
                          <td className={styles.dreCatNome}>Total Despesas</td>
                          {dreData.total_saidas.map((c, i) => fmtCell(c, 'saida', isFuturo(i)))}
                          <td className={`${styles.dreTotalConf} ${styles.dreCellSaida}`}><strong>{fmtBRL(totalConf(dreData.total_saidas))}</strong></td>
                          <td className={`${styles.dreTotalProj} ${styles.dreCellSaida}`}><strong>{fmtBRL(totalConf(dreData.total_saidas) + totalPend(dreData.total_saidas))}</strong></td>
                        </tr>

                        {/* ── RESULTADO CONFIRMADO ── */}
                        <tr className={styles.dreResultadoRow}>
                          <td className={styles.dreCatNome}>Resultado realizado</td>
                          {dreData.resultado.map((c, i) => (
                            <td key={i} className={`${c.confirmado >= 0 ? styles.dreResultadoPos : styles.dreResultadoNeg} ${isFuturo(i) ? styles.dreResultadoFuturo : ''}`}>
                              <strong>{fmtBRL(c.confirmado)}</strong>
                            </td>
                          ))}
                          {(() => {
                            const v = totalConf(dreData.resultado)
                            return (
                              <>
                                <td className={v >= 0 ? styles.dreResultadoPos : styles.dreResultadoNeg}><strong>{fmtBRL(v)}</strong></td>
                                <td className={styles.dreResultadoVazio}>—</td>
                              </>
                            )
                          })()}
                        </tr>

                        {/* ── RESULTADO PROJETADO (confirmado + pendente) ── */}
                        {totalPend(dreData.resultado) !== 0 && (
                          <tr className={styles.dreResultadoProjetadoRow}>
                            <td className={styles.dreCatNome}>Resultado projetado</td>
                            {dreData.resultado.map((c, i) => {
                              const val = c.confirmado + c.pendente
                              return (
                                <td key={i} className={`${val >= 0 ? styles.dreResultadoProjPos : styles.dreResultadoProjNeg} ${isFuturo(i) ? styles.dreResultadoFuturo : ''}`}>
                                  <strong>{fmtBRL(val)}</strong>
                                </td>
                              )
                            })}
                            {(() => {
                              const v = totalConf(dreData.resultado) + totalPend(dreData.resultado)
                              return (
                                <>
                                  <td className={styles.dreResultadoVazio}>—</td>
                                  <td className={v >= 0 ? styles.dreResultadoProjPos : styles.dreResultadoProjNeg}><strong>{fmtBRL(v)}</strong></td>
                                </>
                              )
                            })()}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          })()}

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
                  options={[{ id: 'saida', label: '↓ Saída' }, { id: 'entrada', label: '↑ Entrada' }, { id: 'transferencia', label: '⇄ Transferência' }]}
                  onChange={v => { setFTipo(v as 'entrada'|'saida'|'transferencia'); setFCat(''); setFCliente(''); setFFornecedor(''); setFProduct('') }}
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

                <SelectComCadastro
                  label="Centro de Custo"
                  value={fCostCenter}
                  placeholder="Selecionar..."
                  menuFixed
                  options={costCenters.map(cc => ({ id: cc.id, label: cc.nome }))}
                  onChange={setFCostCenter}
                  createLabel="Cadastrar"
                  createFields={[
                    { key: 'nome', label: 'Nome do centro de custo', placeholder: 'Ex: Tráfego Pago', required: true },
                    { key: 'descricao', label: 'Descrição', placeholder: 'Opcional' },
                  ]}
                  onQuickCreate={quickCreateCostCenter}
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
                  menuFixed
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

                <SelectComCadastro
                  label="Categoria"
                  value={fCat}
                  placeholder="Sem categoria"
                  menuFixed
                  options={[{ id: '', label: 'Sem categoria' }, ...catsFiltradas.map(c => ({ id: c.id, label: c.nome }))]}
                  onChange={setFCat}
                  createLabel="Cadastrar"
                  createFields={[
                    { key: 'nome', label: 'Nome da categoria', placeholder: 'Ex: Ferramentas', required: true },
                    { key: 'cor', label: 'Cor', placeholder: '#6b7280' },
                  ]}
                  onQuickCreate={quickCreateCategoria}
                />

                {/* Cliente com cadastro rápido (só entrada) */}
                {fTipo === 'entrada' && (
                  <CustomSelect
                    label="Cliente" value={fCliente} placeholder="Selecionar..." menuFixed
                    options={clientes.map(c => ({ id: c.id, label: c.nome }))}
                    onChange={setFCliente}
                    createOptionLabel="+ Cadastrar"
                    onCreateOption={() => openNovoContatoDaTransacao('cliente')}
                  />
                )}

                {/* Produto com cadastro rápido (só entrada) */}
                {fTipo === 'entrada' && (
                  <SelectComCadastro
                    label="Produto / Serviço" value={fProduct} placeholder="Selecionar..."
                    menuFixed
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
                  <CustomSelect
                    label="Fornecedor" value={fFornecedor} placeholder="Selecionar..." menuFixed
                    options={fornecedores.map(f => ({ id: f.id, label: f.nome }))}
                    onChange={setFFornecedor}
                    createOptionLabel="+ Cadastrar"
                    onCreateOption={() => openNovoContatoDaTransacao('fornecedor')}
                  />
                )}

                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Observações</label>
                  <textarea value={fObs} onChange={e => setFObs(e.target.value)} placeholder="Opcional" />
                </div>

                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.btnCancelForm} onClick={() => setShowForm(false)}>Cancelar</button>
                  {formMode === 'criar' && (
                    <button
                      type="submit"
                      className={styles.btnSaveSecondary}
                      disabled={saving}
                      onClick={() => { transactionSubmitModeRef.current = 'create-another' }}
                    >
                      {saving ? 'Salvando...' : 'Salvar e criar nova'}
                    </button>
                  )}
                  <button
                    type="submit"
                    className={styles.btnSave}
                    disabled={saving}
                    onClick={() => { transactionSubmitModeRef.current = 'close' }}
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal cadastro cliente/fornecedor (aba) ── */}
        {showCadForm && (
          <div className={styles.formOverlay} onClick={() => setShowCadForm(false)}>
            <div className={styles.sidePanel} onClick={e => e.stopPropagation()}>
              <div className={styles.formTitle}>
                {cadMode === 'criar' ? 'Novo contato' : 'Editar contato'}
              </div>
              <form onSubmit={salvarCadastro}>
                <div className={styles.formGrid}>
                <CustomSelect
                  label="Tipo do contato"
                  value={cadTipoContato}
                  menuFixed
                  options={[
                    { id: 'cliente', label: 'Cliente' },
                    { id: 'fornecedor', label: 'Fornecedor' },
                    { id: 'ambos', label: 'Ambos' },
                  ]}
                  onChange={v => setCadTipoContato(v as ContatoTipo)}
                />
                <div className={`${styles.field} ${styles.formGridFull}`}>
                  <label>Nome *</label>
                  <input value={cadNome} onChange={e => setCadNome(e.target.value)} placeholder="Nome completo ou razão social" required />
                </div>
                <div className={styles.field}>
                  <label>CPF / CNPJ</label>
                  <div className={styles.inlineFieldAction}>
                    <input
                      value={cadDoc}
                      onChange={e => {
                        setCadDoc(e.target.value)
                        if (cadCnpjError) setCadCnpjError('')
                      }}
                      placeholder="Opcional"
                    />
                    <button
                      type="button"
                      className={styles.inlineActionBtn}
                      onClick={() => void preencherCadastroPorCnpj()}
                      disabled={cadCnpjLoading || digitsOnly(cadDoc).length !== 14}
                    >
                      {cadCnpjLoading ? 'Buscando...' : 'Buscar CNPJ'}
                    </button>
                  </div>
                  {cadCnpjError && <div className={styles.inlineError}>{cadCnpjError}</div>}
                  {cadCnpjData && !cadCnpjError && (
                    <div className={styles.inlineHint}>
                      Dados importados: {getReceitaSnapshot(cadCnpjData).nome || cadCnpjData.razao_social}
                    </div>
                  )}
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

                {(cadTipoContato === 'cliente' || cadTipoContato === 'ambos') && (
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
              <div className={styles.formTitle}>{contaMode === 'criar' ? 'Nova conta bancária' : 'Editar conta e ajustar caixa'}</div>
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
                  <label>{contaMode === 'criar' ? 'Saldo inicial (R$)' : 'Ajuste de caixa base (R$)'}</label>
                  <input value={contaSaldo} onChange={e => setContaSaldo(e.target.value)} placeholder="0,00" />
                </div>
                {contaMode === 'editar' && (
                  <div className={`${styles.field} ${styles.formGridFull}`}>
                    <label>Observação</label>
                    <div className={styles.accountAdjustmentHint}>
                      Esse ajuste altera o saldo base da conta para acertar o caixa inicial, sem criar transação financeira.
                    </div>
                  </div>
                )}
                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.btnCancelForm} onClick={() => setShowContaForm(false)}>Cancelar</button>
                  <button type="submit" className={styles.btnSave} disabled={contaSaving}>{contaSaving ? 'Salvando...' : contaMode === 'criar' ? 'Cadastrar' : 'Salvar ajuste'}</button>
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
