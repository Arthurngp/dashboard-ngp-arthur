'use client'
import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { parseCurrencyInput } from '@/lib/financeiro'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry, debounce } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import CustomSelect from '@/components/CustomSelect'
import CustomDatePicker from '@/components/CustomDatePicker'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import { financeiroNav } from './financeiro-nav'
import styles from './financeiro.module.css'

type Tab = 'transacoes' | 'contatos' | 'categorias' | 'contas' | 'dre'
type TipoFiltro = 'todos' | 'entrada' | 'saida'
type PeriodoTipo = 'hoje' | 'semana' | 'mes' | '30dias' | 'ultimo_mes' | 'trimestre' | 'ano' | 'mes_especifico' | 'personalizado' | 'tudo'
type ViewMode = 'competencia' | 'caixa'
type ContatoTipo = 'cliente' | 'fornecedor' | 'ambos'
type ContatoFiltro = 'todos' | 'clientes' | 'fornecedores' | 'ambos'
type TransacaoSortField = 'payment_date' | 'descricao' | 'categoria' | 'cost_center' | 'account' | 'tipo' | 'valor' | 'status'
type SortDirection = 'asc' | 'desc'

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
interface FinContato {
  key: string
  nome: string
  documento?: string
  telefone?: string
  email?: string
  observacoes?: string
  tipo: ContatoTipo
  clienteId?: string
  fornecedorId?: string
  mensalidade_valor?: number | null
  mensalidade_descricao?: string | null
  dia_cobranca?: number | null
  assinatura_ativa?: boolean | null
}
interface ImportedCsvRow {
  competence_date: string
  due_date?: string | null
  payment_date?: string | null
  descricao: string
  status: 'confirmado' | 'pendente'
  contato?: string | null
  tags?: string | null
  additional_info?: string | null
  attachments?: string | null
  categoria?: string | null
  cost_center?: string | null
  account_name?: string | null
  valor: number
  tipo: 'entrada' | 'saida' | 'transferencia'
}
interface AiDuplicateMatch {
  csv_index: number
  existing_id: string
  existing_descricao: string
  existing_valor: number
  existing_date: string
  existing_status: string
  existing_contato: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}
type DupAction = 'pending' | 'combine' | 'import' | 'transfer'
interface DupActionState {
  action: DupAction
  chosenStatus?: 'confirmado' | 'pendente'
}
interface ImportPreviewData {
  accountId: string | null
  accountName: string
  fileName: string
  rows: ImportedCsvRow[]
  analysis?: {
    account_name?: string
    summary?: {
      entradas: number
      saidas: number
      confirmados: number
      pendentes: number
      total_entradas: number
      total_saidas: number
    }
    accounts_detected?: string[]
    accounts_to_create?: string[]
    warnings?: string[]
    sample?: ImportedCsvRow[]
    ai_review?: {
      headline?: string
      summary?: string
      warnings?: string[]
      opportunities?: string[]
      confidence?: 'high' | 'medium' | 'low'
    } | null
    potential_duplicates?: AiDuplicateMatch[]
    duplicate_debug?: any
  } | null
}
type ImportAlertKey = 'duplicados' | 'transferencias' | 'sem-categoria' | 'sem-contato'
type ImportBulkField = 'contato' | 'categoria' | 'tipo' | 'status'
interface ReceitaCnpjData {
  razao_social?: string
  nome_fantasia?: string
  email?: string | null
  ddd_telefone_1?: string
  telefone_1?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  descricao_situacao_cadastral?: string
  estabelecimento?: {
    nome_fantasia?: string | null
    email?: string | null
    ddd1?: string | null
    telefone1?: string | null
    logradouro?: string | null
    numero?: string | null
    complemento?: string | null
    bairro?: string | null
    cep?: string | null
    situacao_cadastral?: string | null
    cidade?: { nome?: string | null } | null
    estado?: { sigla?: string | null } | null
  } | null
}

interface Transacao {
  id: string
  tipo: 'entrada' | 'saida' | 'transferencia'
  descricao: string
  valor: number
  data_transacao: string
  competence_date?: string | null
  payment_date?: string | null
  status: 'confirmado' | 'pendente' | 'cancelado'
  observacoes?: string
  source_type?: 'manual' | 'api' | 'import' | 'system' | null
  source_tag?: string | null
  source_message?: string | null
  api_token_id?: string | null
  categoria?: Categoria | null
  cliente?: FinCliente | null
  fornecedor?: FinFornecedor | null
  account?: FinAccount | null
  cost_center?: FinCostCenter | null
  product?: FinProduct | null
}

interface DreCellValue { confirmado: number; pendente: number }
interface DreRow {
  categoria_id: string | null
  categoria_nome: string
  tipo: 'entrada' | 'saida'
  meses: DreCellValue[]
}
interface DreData {
  ano: number
  view: ViewMode
  entradas: DreRow[]
  saidas: DreRow[]
  total_entradas: DreCellValue[]
  total_saidas: DreCellValue[]
  resultado: DreCellValue[]
}
interface ResumoData {
  entradas: number
  saidas: number
  saldo: number
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const MESES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtBRL(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function normalizeSearchText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
function isInternalTransferTransaction(transaction: Pick<Transacao, 'descricao' | 'observacoes' | 'categoria'>) {
  const combined = [
    transaction.descricao,
    transaction.observacoes,
    transaction.categoria?.nome,
  ].map(normalizeSearchText).join(' ')

  return (
    combined.includes('transfer') ||
    combined.includes('movimentacao entre contas') ||
    combined.includes('movimentacao interna') ||
    combined.includes('entre contas')
  )
}
function todayISO() { return new Date().toISOString().split('T')[0] }
function monthStartISO() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
}
function calcPeriodo(tipo: PeriodoTipo, mesEspecifico?: string, customStart?: string, customEnd?: string): { start: string | null; end: string | null; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (date: Date) => date.toISOString().split('T')[0]
  switch (tipo) {
    case 'hoje': {
      const t = todayISO()
      return { start: t, end: t, label: 'Hoje' }
    }
    case 'semana': {
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1 // seg=0
      const seg = new Date(y, m, d - dow)
      const dom = new Date(y, m, d - dow + 6)
      return { start: iso(seg), end: iso(dom), label: 'Esta semana' }
    }
    case 'mes': {
      const start = `${y}-${pad(m + 1)}-01`
      const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
      return { start, end, label: 'Este mês' }
    }
    case '30dias': {
      const from = new Date(y, m, d - 29)
      return { start: iso(from), end: todayISO(), label: 'Últimos 30 dias' }
    }
    case 'ultimo_mes': {
      const start = `${m === 0 ? y - 1 : y}-${pad(m === 0 ? 12 : m)}-01`
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      return { start, end, label: 'Último mês' }
    }
    case 'trimestre': {
      const q = Math.floor(m / 3)
      const start = `${y}-${pad(q * 3 + 1)}-01`
      const end = new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10)
      return { start, end, label: 'Este trimestre' }
    }
    case 'ano':
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Ano ${y}` }
    case 'mes_especifico': {
      if (!mesEspecifico) return { start: null, end: null, label: 'Mês específico' }
      const [my, mm] = mesEspecifico.split('-').map(Number)
      const start = `${my}-${pad(mm)}-01`
      const end = new Date(Date.UTC(my, mm, 0)).toISOString().slice(0, 10)
      const label = `${MESES[mm - 1]} ${my}`
      return { start, end, label }
    }
    case 'personalizado':
      return { start: customStart || null, end: customEnd || null, label: 'Personalizado' }
    case 'tudo':
    default:
      return { start: null, end: null, label: 'Todo o período' }
  }
}
function digitsOnly(value: string) { return value.replace(/\D/g, '') }
function formatCnpj(value: string) {
  const d = digitsOnly(value).slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
function formatPhoneBR(value?: string | null) {
  const d = digitsOnly(value || '')
  if (!d) return ''
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return value || ''
}
function getReceitaSnapshot(data: ReceitaCnpjData) {
  const estabelecimento = data.estabelecimento || null
  const nome = estabelecimento?.nome_fantasia || data.nome_fantasia || data.razao_social || ''
  const email = estabelecimento?.email || data.email || ''
  const phoneDigits = digitsOnly(`${estabelecimento?.ddd1 || data.ddd_telefone_1 || ''}${estabelecimento?.telefone1 || data.telefone_1 || ''}`)
  const phone = formatPhoneBR(phoneDigits)
  const address = [
    estabelecimento?.logradouro || data.logradouro,
    estabelecimento?.numero || data.numero,
    estabelecimento?.complemento || data.complemento,
    estabelecimento?.bairro || data.bairro,
  ].filter(Boolean).join(', ')
  const city = [
    estabelecimento?.cidade?.nome || data.municipio,
    estabelecimento?.estado?.sigla || data.uf,
  ].filter(Boolean).join(' / ')
  const cepRaw = estabelecimento?.cep || data.cep || ''
  const cep = cepRaw ? cepRaw.replace(/^(\d{5})(\d{3})$/, '$1-$2') : ''
  const status = estabelecimento?.situacao_cadastral || data.descricao_situacao_cadastral || ''
  return { nome, email, phone, address, city, cep, status }
}
function buildObservacoesFromCnpj(data: ReceitaCnpjData) {
  const snapshot = getReceitaSnapshot(data)
  const lines = [
    data.razao_social && snapshot.nome && data.razao_social !== snapshot.nome ? `Razão social: ${data.razao_social}` : '',
    snapshot.status ? `Situação cadastral: ${snapshot.status}` : '',
    snapshot.address ? `Endereço: ${snapshot.address}` : '',
    snapshot.city ? `Cidade: ${snapshot.city}` : '',
    snapshot.cep ? `CEP: ${snapshot.cep}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}
function normalizeContactKey(value?: string | null) {
  return (value || '').trim().toLowerCase()
}
function getContactGroupKey(item: { nome?: string; documento?: string; email?: string; telefone?: string }) {
  const documento = digitsOnly(item.documento || '')
  if (documento) return `doc:${documento}`
  const email = normalizeContactKey(item.email)
  if (email) return `email:${email}`
  const phone = digitsOnly(item.telefone || '')
  if (phone) return `phone:${phone}`
  return `nome:${normalizeContactKey(item.nome)}`
}
function parseCsvLine(line: string, delimiter = ',') {
  const result: string[] = []
  let current = ''
  let insideQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }
    if (char === delimiter && !insideQuotes) {
      result.push(current)
      current = ''
      continue
    }
    current += char
  }

  result.push(current)
  return result.map(item => item.trim())
}
function parsePtBrDateToIso(value: string) {
  const raw = value.trim()
  if (!raw) return null
  // DD/MM/YYYY ou D/M/YYYY
  const matchBr = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (matchBr) {
    let day = matchBr[1].padStart(2, '0')
    let month = matchBr[2].padStart(2, '0')
    let year = matchBr[3]
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }
  // YYYY-MM-DD (ISO)
  const matchIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (matchIso) return `${matchIso[1]}-${matchIso[2]}-${matchIso[3]}`
  
  // DD-MM-YYYY
  const matchDash = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (matchDash) return `${matchDash[3]}-${matchDash[2]}-${matchDash[1]}`

  return null
}

// Hook para redimensionamento de colunas via drag
function useColResize(initialWidths: number[]) {
  const [widths, setWidths] = useState<number[]>(initialWidths)
  const dragging = useRef<{ colIdx: number; startX: number; startW: number } | null>(null)

  const onMouseDown = useCallback((colIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { colIdx, startX: e.clientX, startW: widths[colIdx] }

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return
      const delta = ev.clientX - dragging.current.startX
      const newW = Math.max(60, dragging.current.startW + delta)
      setWidths(prev => { const next = [...prev]; next[dragging.current!.colIdx] = newW; return next })
    }
    function onUp() {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [widths])

  return { widths, onMouseDown }
}

function parseImportCsvContent(content: string): ImportedCsvRow[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim())
  if (lines.length <= 1) return []

  // Detecção automática de delimitador (usa amostra de linha com mais separadores)
  const sampleLine = lines.find(l => l.includes(';') || l.includes(',')) ?? lines[0]
  const countComma = (sampleLine.match(/,/g) || []).length
  const countSemi = (sampleLine.match(/;/g) || []).length
  const delimiter = countSemi > countComma ? ';' : ','

  // Encontra a linha de cabeçalho real — ignora linhas de título/período no topo do arquivo
  const headerKeywords = ['data', 'date', 'valor', 'value', 'descrição', 'descricao', 'historico', 'histórico', 'transacao', 'transação']
  const headerLineIdx = lines.findIndex(line => {
    const cols = parseCsvLine(line, delimiter).map(h => normalizeContactKey(h))
    return cols.some(h => headerKeywords.some(k => h.includes(k)))
  })
  if (headerLineIdx < 0) return []

  const headers = parseCsvLine(lines[headerLineIdx], delimiter).map(h => normalizeContactKey(h))
  const rows: ImportedCsvRow[] = []

  // Mapeamento inteligente de colunas
  const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)))

  const idxDate = findIdx(['data', 'date', 'competência', 'competencia'])
  const idxDue = findIdx(['vencimento', 'venc'])
  const idxPayment = findIdx(['pagamento', 'pago em', 'baixa'])
  const idxDesc = findIdx(['descrição', 'descricao', 'histórico', 'historico'])
  const idxValor = findIdx(['valor', 'total', 'montante', 'preço', 'débito', 'crédito', 'debito', 'credito'])
  const idxStatus = findIdx(['status', 'situação', 'situacao', 'pago'])
  const idxCat = findIdx(['categoria', 'plano'])
  const idxCont = findIdx(['contato', 'cliente', 'fornecedor', 'favorecido', 'pessoa'])
  // 'conta/' para não bater em 'contato'; 'cartao' cobre 'conta/cartão' do Controlle
  const idxAcc = findIdx(['conta/', 'cartao', 'cartão', 'banco', 'caixa'])
  const idxCenter = findIdx(['centro', 'custo'])
  const idxTipo = findIdx(['lancamento', 'lançamento', 'natureza', 'e/s'])

  for (const line of lines.slice(headerLineIdx + 1)) {
    const cols = parseCsvLine(line, delimiter)
    if (cols.length === 0) continue

    const descricao = idxDesc >= 0 ? cols[idxDesc] : ''
    const valorRaw = idxValor >= 0 ? parseCurrencyInput(cols[idxValor]) : null
    const competenceDate = idxDate >= 0 ? parsePtBrDateToIso(cols[idxDate]) : null

    if (!descricao || valorRaw == null || valorRaw === 0 || !competenceDate) continue

    // Lógica de Status
    let status: 'confirmado' | 'pendente' = 'pendente'
    const statusVal = idxStatus >= 0 ? normalizeContactKey(cols[idxStatus]) : ''
    const paymentDate = idxPayment >= 0 ? parsePtBrDateToIso(cols[idxPayment]) : null
    if (paymentDate || statusVal.includes('pago') || statusVal.includes('confirmado') || statusVal.includes('liquidado')) {
      status = 'confirmado'
    }
    // Se o CSV não tem coluna de status NEM de pagamento, é um extrato bancário
    // (ex: Asaas) — tudo já foi efetivado
    if (idxStatus < 0 && idxPayment < 0) {
      status = 'confirmado'
    }

    // Lógica de Tipo (Entrada/Saída/Transferência)
    let tipo: 'entrada' | 'saida' | 'transferencia' = valorRaw < 0 ? 'saida' : 'entrada'
    const descNorm = normalizeContactKey(descricao)
    if (descNorm.includes('transfer') || descNorm.includes('transf ') || descNorm.includes('moviment')) {
      tipo = 'transferencia'
    } else if (idxTipo >= 0) {
      const t = normalizeContactKey(cols[idxTipo])
      if (t.includes('transfer') || t.includes('transf')) tipo = 'transferencia'
      else if (t.includes('sai') || t.includes('desp') || t.includes('deb') || t.includes('pag')) tipo = 'saida'
      else if (t.includes('ent') || t.includes('rec') || t.includes('cre')) tipo = 'entrada'
    }

    rows.push({
      competence_date: competenceDate,
      due_date: idxDue >= 0 ? parsePtBrDateToIso(cols[idxDue]) : null,
      payment_date: paymentDate || (status === 'confirmado' ? competenceDate : null),
      descricao: descricao.trim(),
      status,
      contato: idxCont >= 0 ? cols[idxCont] : null,
      categoria: idxCat >= 0 ? cols[idxCat] : null,
      account_name: idxAcc >= 0 ? cols[idxAcc] : null,
      cost_center: idxCenter >= 0 ? cols[idxCenter] : null,
      valor: Math.abs(valorRaw),
      tipo,
      tags: null,
      additional_info: null,
      attachments: null,
    })
  }

  return rows
}
function escapeCsvValue(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function summarizeImportRows(rows: ImportedCsvRow[]) {
  return rows.reduce((acc, row) => {
    const valor = Number(row.valor || 0)
    if (row.tipo === 'entrada') {
      acc.entradas += 1
      acc.total_entradas += valor
    } else {
      acc.saidas += 1
      acc.total_saidas += valor
    }
    if (row.status === 'pendente') acc.pendentes += 1
    else acc.confirmados += 1
    return acc
  }, {
    entradas: 0,
    saidas: 0,
    confirmados: 0,
    pendentes: 0,
    total_entradas: 0,
    total_saidas: 0,
  })
}

function buildImportWarnings(rows: ImportedCsvRow[]) {
  const warnings: string[] = []
  const duplicateKeys = new Set<string>()
  const seen = new Set<string>()
  const transferRows = rows.filter(row => /transfer/i.test(String(row.descricao || '')))
  const noCategory = rows.filter(row => !normalizeContactKey(row.categoria)).length
  const noContact = rows.filter(row => !normalizeContactKey(row.contato)).length

  for (const row of rows) {
    const key = [row.tipo, normalizeContactKey(row.descricao), row.competence_date, Number(row.valor || 0)].join('|')
    if (seen.has(key)) duplicateKeys.add(key)
    seen.add(key)
  }

  if (duplicateKeys.size > 0) warnings.push(`${duplicateKeys.size} lançamentos parecem duplicados dentro do próprio arquivo.`)
  if (transferRows.length > 0) warnings.push(`${transferRows.length} lançamentos parecem transferências entre contas e merecem revisão.`)
  if (noCategory > 0) warnings.push(`${noCategory} linhas vieram sem categoria e dependerão de fallback automático.`)
  if (noContact > 0) warnings.push(`${noContact} linhas vieram sem contato identificado.`)
  return warnings
}

function getImportAlertRows(rows: ImportedCsvRow[], key: ImportAlertKey) {
  if (key === 'transferencias') return rows.filter(row => /transfer/i.test(String(row.descricao || '')))
  if (key === 'sem-categoria') return rows.filter(row => !normalizeContactKey(row.categoria))
  if (key === 'sem-contato') return rows.filter(row => !normalizeContactKey(row.contato))
  const seen = new Set<string>()
  const duplicateKeys = new Set<string>()
  for (const row of rows) {
    const rowKey = [row.tipo, normalizeContactKey(row.descricao), row.competence_date, Number(row.valor || 0)].join('|')
    if (seen.has(rowKey)) duplicateKeys.add(rowKey)
    seen.add(rowKey)
  }
  return rows.filter(row => {
    const rowKey = [row.tipo, normalizeContactKey(row.descricao), row.competence_date, Number(row.valor || 0)].join('|')
    return duplicateKeys.has(rowKey)
  })
}

function buildImportAlerts(rows: ImportedCsvRow[]) {
  const alertConfigs: { key: ImportAlertKey; buildLabel: (count: number) => string }[] = [
    { key: 'duplicados', buildLabel: count => `${count} lançamentos parecem duplicados dentro do próprio arquivo.` },
    { key: 'transferencias', buildLabel: count => `${count} lançamentos parecem transferências entre contas e merecem revisão.` },
    { key: 'sem-categoria', buildLabel: count => `${count} linhas vieram sem categoria e dependerão de fallback automático.` },
    { key: 'sem-contato', buildLabel: count => `${count} linhas vieram sem contato identificado.` },
  ]

  return alertConfigs
    .map(config => {
      const matchedRows = getImportAlertRows(rows, config.key)
      return {
        key: config.key,
        count: matchedRows.length,
        label: config.buildLabel(matchedRows.length),
      }
    })
    .filter(alert => alert.count > 0)
}

// ── SelectComCadastro: CustomSelect + botão inline de cadastro rápido ────────
interface QuickCreateField { key: string; label: string; placeholder?: string; type?: string; required?: boolean }

function SelectComCadastro({
  label, value, options, onChange, placeholder,
  createLabel, createFields, onQuickCreate, menuFixed,
}: {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (v: string) => void
  placeholder?: string
  createLabel: string
  createFields: QuickCreateField[]
  onQuickCreate: (fields: Record<string, string>) => Promise<boolean>
  menuFixed?: boolean
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

  async function handleSubmit() {
    const hasMissingRequired = createFields.some(f => f.required && !(fieldValues[f.key] || '').trim())
    if (hasMissingRequired) return
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
        createOptionLabel="+ Cadastrar"
        onCreateOption={openQuick}
        menuFixed={menuFixed}
      />
      {showQuick && (
        <div className={styles.quickForm}>
          {createFields.map(f => (
            <input
              key={f.key}
              type={f.type || 'text'}
              placeholder={f.placeholder || f.label}
              value={fieldValues[f.key] || ''}
              onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
              required={f.required}
              className={styles.quickInput}
            />
          ))}
          <div className={styles.quickActions}>
            <button type="button" className={styles.btnQuickCancel} onClick={() => setShowQuick(false)}>Cancelar</button>
            <button type="button" className={styles.btnQuickSave} disabled={saving} onClick={() => void handleSubmit()}>{saving ? '...' : 'Salvar'}</button>
          </div>
        </div>
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
      showMsg('ok', `Importação concluída: ${parts.join(', ')}.`)
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={handleImportFileChange}
              />
              <div className={styles.toolbar}>
                <div className={styles.toolbarLeft}>
                  <span style={{ fontSize: 13, color: '#8E8E93' }}>{accounts.length} conta{accounts.length !== 1 ? 's' : ''}</span>
                  <button type="button" className={styles.filtroBtn} onClick={triggerImportMultiConta}>Importar multi-conta</button>
                  <button type="button" className={styles.filtroBtn} onClick={() => setShowArchivedAccounts(!showArchivedAccounts)}>
                    {showArchivedAccounts ? 'Ver Ativas' : 'Ver Arquivadas'}
                  </button>
                </div>
                <button className={styles.btnNovo} onClick={openNovaConta}>+ Nova conta</button>
              </div>
              {accounts.length === 0 ? <div className={styles.empty}>Nenhuma conta bancária cadastrada. Adicione uma para controlar seu saldo real.</div> : (
                <div className={styles.listWrap}>
                  {accounts.map(a => (
                    <div key={a.id} className={`${styles.listRow} ${styles.listRowClickable}`} onClick={() => openAccountTransacoes(a)}>
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
                              <button type="button" className={styles.accountMenuItem} onClick={() => triggerImportForAccount(a.id)}>Importar CSV</button>
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

        {/* Loading overlay enquanto a IA processa o CSV */}
        {importPreviewLoading && !importPreview && (
          <div className={styles.formOverlay}>
            <div className={styles.aiLoadingCard}>
              <div className={styles.aiLoadingSpinner}>
                <div className={styles.aiLoadingDot} />
                <div className={styles.aiLoadingDot} />
                <div className={styles.aiLoadingDot} />
              </div>
              <div className={styles.aiLoadingTitle}>🤖 IA analisando seu CSV…</div>
              <div className={styles.aiLoadingSubtitle}>
                Identificando duplicatas, contatos, categorias e conferindo lançamentos contra o sistema.
              </div>
              <div className={styles.aiLoadingHint}>
                Isso pode levar até 30 segundos para CSVs grandes.
              </div>
            </div>
          </div>
        )}

        {importPreview && (
          <div className={styles.formOverlay} onClick={() => !importPreviewLoading && setImportPreview(null)}>
            <div className={`${styles.formModal} ${styles.importPreviewModal}`} onClick={e => e.stopPropagation()}>
              <div className={styles.formTitle}>Prévia da importação</div>
              <div className={styles.importPreviewBody}>
                <div className={styles.importPreviewHeader}>
                  <div>
                    <div className={styles.importPreviewFile}>{importPreview.fileName}</div>
                    <div className={styles.importPreviewMeta}>Conta de destino: {importPreview.analysis?.account_name || importPreview.accountName}</div>
                  </div>
                  <div className={styles.importPreviewRows}>{importPreview.rows.length} linhas válidas</div>
                </div>

                {/* Barra compacta com KPIs + alertas inline */}
                <div className={styles.importTopBar}>
                  <div className={styles.importTopKpis}>
                    <div className={styles.importTopKpi}>
                      <span className={styles.importTopKpiLabel}>Entradas</span>
                      <strong className={styles.importTopKpiValue}>{importSummary?.entradas || 0}</strong>
                      <small>{fmtBRL(importSummary?.total_entradas || 0)}</small>
                    </div>
                    <div className={styles.importTopKpiDivider} />
                    <div className={styles.importTopKpi}>
                      <span className={styles.importTopKpiLabel}>Saídas</span>
                      <strong className={styles.importTopKpiValue}>{importSummary?.saidas || 0}</strong>
                      <small>{fmtBRL(importSummary?.total_saidas || 0)}</small>
                    </div>
                    <div className={styles.importTopKpiDivider} />
                    <div className={styles.importTopKpi}>
                      <span className={styles.importTopKpiLabel}>Confirmados</span>
                      <strong className={`${styles.importTopKpiValue} ${styles.importTopKpiValueOk}`}>{importSummary?.confirmados || 0}</strong>
                    </div>
                    <div className={styles.importTopKpiDivider} />
                    <div className={styles.importTopKpi}>
                      <span className={styles.importTopKpiLabel}>Pendentes</span>
                      <strong className={`${styles.importTopKpiValue} ${(importSummary?.pendentes || 0) > 0 ? styles.importTopKpiValueWarn : ''}`}>{importSummary?.pendentes || 0}</strong>
                    </div>
                  </div>
                  {!!importWarnings.length && (
                    <div className={styles.importTopAlerts}>
                      {importAlerts.map(alert => (
                        <button
                          key={alert.key}
                          type="button"
                          className={`${styles.importTopAlertChip} ${activeImportAlert === alert.key ? styles.importTopAlertChipActive : ''}`}
                          onClick={() => setActiveImportAlert(current => current === alert.key ? null : alert.key)}
                          title={alert.label}
                        >
                          ⚠ {alert.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {!!importPreview.analysis?.accounts_detected?.length && (
                  <div className={styles.importPreviewBlock}>
                    <div className={styles.importPreviewBlockTitle}>Contas detectadas no arquivo</div>
                    <div className={styles.importPreviewAccountList}>
                      {importPreview.analysis.accounts_detected.map(accountName => (
                        <span key={accountName} className={styles.importPreviewAccountChip}>{accountName}</span>
                      ))}
                    </div>
                    {!!importPreview.analysis.accounts_to_create?.length && (
                      <div className={styles.importPreviewAccountHint}>
                        Novas contas que serão criadas: {importPreview.analysis.accounts_to_create.join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {importPreview.analysis?.ai_review && (() => {
                  const review = importPreview.analysis.ai_review
                  const totalInsights = (review.warnings?.length || 0) + (review.opportunities?.length || 0)
                  return (
                    <details className={styles.aiReviewDetails}>
                      <summary className={styles.aiReviewSummary}>
                        <span>🧠 Leitura assistida por IA</span>
                        <span className={styles.aiReviewSummaryHint}>
                          {review.headline || 'Análise disponível'}
                          {totalInsights > 0 && ` · ${totalInsights} insight${totalInsights > 1 ? 's' : ''}`}
                          {' · '}clique para expandir
                        </span>
                      </summary>
                      <div className={styles.importPreviewAiCard}>
                        {review.summary && (
                          <p className={styles.importPreviewAiSummary}>{review.summary}</p>
                        )}
                        <div className={styles.importPreviewAiMeta}>
                          Confiança: {review.confidence === 'high' ? 'alta' : review.confidence === 'medium' ? 'média' : 'baixa'}
                        </div>
                        {!!review.warnings?.length && (
                          <div className={styles.importPreviewList}>
                            {review.warnings.map(item => (
                              <div key={item} className={styles.importPreviewWarning}>{item}</div>
                            ))}
                          </div>
                        )}
                        {!!review.opportunities?.length && (
                          <div className={styles.importPreviewList}>
                            {review.opportunities.map(item => (
                              <div key={item} className={styles.importPreviewOpportunity}>{item}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })()}

                {/* Banner de erro quando a IA não consegue rodar a detecção */}
                {importPreview.analysis?.duplicate_debug?.error_user_facing && (
                  <div className={styles.importPreviewBlock}>
                    <div className={styles.dupErrorBanner}>
                      <div className={styles.dupErrorIcon}>⚠</div>
                      <div className={styles.dupErrorContent}>
                        <div className={styles.dupErrorTitle}>Detecção de duplicatas indisponível</div>
                        <div className={styles.dupErrorText}>{importPreview.analysis.duplicate_debug.error_user_facing}</div>
                        <div className={styles.dupErrorHint}>
                          {importPreview.analysis.duplicate_debug.candidates_count > 0 && (
                            <>Foram encontrados <strong>{importPreview.analysis.duplicate_debug.candidates_count} candidatos prováveis</strong> no banco. Após corrigir a IA, refaça a importação para ver a análise.</>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Diagnóstico técnico — colapsado por padrão */}
                {importPreview.analysis?.duplicate_debug && (
                  <details className={styles.dupDebugDetails}>
                    <summary className={styles.dupDebugSummary}>
                      🐞 Diagnóstico técnico da detecção
                      <span className={styles.dupDebugSummaryHint}>
                        {importPreview.analysis.duplicate_debug.existing_count ?? 0} no DB · {importPreview.analysis.duplicate_debug.candidates_count ?? 0} candidatos · {importPreview.analysis.potential_duplicates?.length ?? 0} matches
                      </span>
                    </summary>
                    <div className={styles.dupDebugBody}>
                      <div><span className={styles.dupDebugLabel}>Saída:</span> <code>{importPreview.analysis.duplicate_debug.exit || '—'}</code></div>
                      <div><span className={styles.dupDebugLabel}>CSV:</span> {importPreview.analysis.duplicate_debug.csv_rows_count} linhas, {importPreview.analysis.duplicate_debug.csv_dates_count} com data</div>
                      {importPreview.analysis.duplicate_debug.search_range && (
                        <div><span className={styles.dupDebugLabel}>Busca DB:</span> {importPreview.analysis.duplicate_debug.search_range.minDate} → {importPreview.analysis.duplicate_debug.search_range.maxDate} {importPreview.analysis.duplicate_debug.account_id ? `(conta filtrada)` : '(todas as contas)'}</div>
                      )}
                      <div><span className={styles.dupDebugLabel}>Lançamentos no DB:</span> {importPreview.analysis.duplicate_debug.existing_count ?? '—'}</div>
                      <div><span className={styles.dupDebugLabel}>Candidatos (valor + ±5 dias):</span> {importPreview.analysis.duplicate_debug.candidates_count ?? '—'}</div>
                      {importPreview.analysis.duplicate_debug.ai_matches_breakdown && (
                        <div><span className={styles.dupDebugLabel}>IA analisou:</span> {importPreview.analysis.duplicate_debug.ai_matches_total} pares — <span style={{ color: '#16a34a' }}>high {importPreview.analysis.duplicate_debug.ai_matches_breakdown.high}</span>, <span style={{ color: '#ca8a04' }}>medium {importPreview.analysis.duplicate_debug.ai_matches_breakdown.medium}</span>, low {importPreview.analysis.duplicate_debug.ai_matches_breakdown.low}, rejeitados {importPreview.analysis.duplicate_debug.ai_matches_breakdown.false}</div>
                      )}
                      <div><span className={styles.dupDebugLabel}>Matches finais (após dedupe):</span> <strong>{importPreview.analysis.potential_duplicates?.length ?? 0}</strong></div>
                    </div>
                  </details>
                )}

                {(() => {
                  const dups = importPreview.analysis?.potential_duplicates || []
                  const dupByIdx = new Map<number, AiDuplicateMatch>()
                  for (const d of dups) dupByIdx.set(d.csv_index, d)
                  const totalDups = dups.length
                  const pending = dups.filter(d => (importDupActions.get(d.csv_index)?.action || 'pending') === 'pending').length

                  // Ordena: duplicatas primeiro (high → medium → low), depois resto por índice original
                  const confidenceRank = (c?: 'high' | 'medium' | 'low') => c === 'high' ? 0 : c === 'medium' ? 1 : c === 'low' ? 2 : 3
                  const orderedRows = importPreview.rows
                    .map((row, idx) => ({ row, idx, dup: dupByIdx.get(idx) }))
                    .sort((a, b) => {
                      const aHasDup = a.dup ? 0 : 1
                      const bHasDup = b.dup ? 0 : 1
                      if (aHasDup !== bHasDup) return aHasDup - bHasDup
                      if (a.dup && b.dup) {
                        const cr = confidenceRank(a.dup.confidence) - confidenceRank(b.dup.confidence)
                        if (cr !== 0) return cr
                      }
                      return a.idx - b.idx
                    })

                  return (
                    <div className={styles.importPreviewBlock}>
                      <div className={styles.dupSplitHeader}>
                        <div>
                          <div className={styles.dupSplitTitle}>🔀 Revisão e Conciliação</div>
                          <div className={styles.dupSplitSubtitle}>
                            {orderedRows.length} lançamento{orderedRows.length !== 1 ? 's' : ''} no CSV
                            {totalDups > 0 ? (
                              <> · <strong>{totalDups} possíveis duplicatas</strong> · <strong style={{ color: pending > 0 ? '#ea580c' : '#16a34a' }}>{pending} pendente{pending !== 1 ? 's' : ''}</strong></>
                            ) : (
                              <> · <strong style={{ color: '#16a34a' }}>nenhuma duplicata detectada pela IA</strong></>
                            )}
                          </div>
                        </div>
                        {totalDups > 0 && (
                          <div className={styles.dupSplitProgress}>
                            <div className={styles.dupSplitProgressBar}>
                              <div className={styles.dupSplitProgressFill} style={{ width: `${((totalDups - pending) / totalDups) * 100}%` }} />
                            </div>
                            <span>{totalDups - pending} / {totalDups} resolvidas</span>
                          </div>
                        )}
                      </div>

                      {/* Cabeçalho das colunas */}
                      <div className={styles.dupSplitColumnHeaders}>
                        <div className={`${styles.dupSplitColHead} ${styles.dupSplitColHeadExisting}`}>
                          💾 Já cadastrado no sistema
                        </div>
                        <div className={styles.dupSplitColHeadMatch}>
                          🤖 IA
                        </div>
                        <div className={`${styles.dupSplitColHead} ${styles.dupSplitColHeadCsv}`}>
                          📥 Vindo do CSV
                        </div>
                        <div className={styles.dupSplitColHeadActions}>
                          Ação
                        </div>
                      </div>

                      {/* Linhas split — sistema | match | csv | ações */}
                      <div className={styles.dupSplitList}>
                        {orderedRows.map(({ row: csvRow, idx, dup }) => {
                          const csvStatus = csvRow?.status || 'pendente'
                          const dupState = dup ? (importDupActions.get(dup.csv_index) || { action: 'pending' as DupAction }) : null
                          const existStatus = dup?.existing_status
                          const rowClass = dupState?.action === 'combine'
                            ? styles.dupSplitRowCombine
                            : dupState?.action === 'import'
                              ? styles.dupSplitRowImport
                              : dupState?.action === 'transfer'
                                ? styles.dupSplitRowTransfer
                                : !dup ? styles.dupSplitRowClean : ''
                          return (
                            <div key={idx} className={`${styles.dupSplitRow} ${rowClass}`}>
                              {/* COLUNA SISTEMA */}
                              {dup ? (
                                <div className={styles.dupSplitCellExisting}>
                                  <div className={styles.dupSplitCellMain}>{dup.existing_descricao}</div>
                                  <div className={styles.dupSplitCellMeta}>
                                    <span>📅 {fmtDate(dup.existing_date)}</span>
                                    <span className={styles.dupSplitCellValor}>{fmtBRL(dup.existing_valor)}</span>
                                    <span className={existStatus === 'confirmado' ? styles.dupSplitTagPaid : styles.dupSplitTagPending}>
                                      {existStatus === 'confirmado' ? '✓ Pago' : '⏳ Pendente'}
                                    </span>
                                  </div>
                                  {dup.existing_contato && (
                                    <div className={styles.dupSplitCellContact}>👤 {dup.existing_contato}</div>
                                  )}
                                </div>
                              ) : (
                                <div className={styles.dupSplitCellEmpty}>
                                  Sem correspondência no sistema
                                </div>
                              )}

                              {/* COLUNA MATCH (IA) */}
                              {dup ? (
                                <div className={styles.dupSplitCellMatch}>
                                  <span className={`${styles.dupSplitConfidence} ${styles[`dupSplitConfidence_${dup.confidence}`]}`}>
                                    {dup.confidence === 'high' ? '⬤ Alta' : dup.confidence === 'medium' ? '⬤ Média' : '⬤ Baixa'}
                                  </span>
                                  <div className={styles.dupSplitArrows}>⇆</div>
                                  <div className={styles.dupSplitReason} title={dup.reason}>{dup.reason}</div>
                                </div>
                              ) : (
                                <div className={styles.dupSplitCellMatchClean}>
                                  <span className={styles.dupSplitTagNew}>✓ Novo</span>
                                  <div className={styles.dupSplitReasonClean}>Lançamento sem duplicata detectada</div>
                                </div>
                              )}

                              {/* COLUNA CSV */}
                              <div className={styles.dupSplitCellCsv}>
                                <div className={styles.dupSplitCellMain}>{csvRow?.descricao || '—'}</div>
                                <div className={styles.dupSplitCellMeta}>
                                  <span>📅 {fmtDate(csvRow?.competence_date || dup?.existing_date || '')}</span>
                                  <span className={styles.dupSplitCellValor}>{fmtBRL(csvRow?.valor ?? dup?.existing_valor ?? 0)}</span>
                                  <span className={csvStatus === 'confirmado' ? styles.dupSplitTagPaid : styles.dupSplitTagPending}>
                                    {csvStatus === 'confirmado' ? '✓ Pago' : '⏳ Pendente'}
                                  </span>
                                </div>
                                {csvRow?.contato && (
                                  <div className={styles.dupSplitCellContact}>👤 {csvRow.contato}</div>
                                )}
                                {csvRow?.categoria && (
                                  <div className={styles.dupSplitCellContact}>🏷 {csvRow.categoria}</div>
                                )}
                              </div>

                              {/* COLUNA AÇÕES */}
                              <div className={styles.dupSplitCellActions}>
                                {dup ? (
                                  <>
                                    <button
                                      type="button"
                                      className={`${styles.dupSplitBtn} ${styles.dupSplitBtnCombine} ${dupState?.action === 'combine' ? styles.dupSplitBtnActive : ''}`}
                                      onClick={() => {
                                        setImportDupActions(prev => {
                                          const next = new Map(prev)
                                          next.set(dup.csv_index, { action: 'combine', chosenStatus: csvStatus as any })
                                          return next
                                        })
                                      }}
                                      title="Combinar: atualizar lançamento existente com dados do CSV"
                                    >
                                      🔗 Combinar
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.dupSplitBtn} ${styles.dupSplitBtnImport} ${dupState?.action === 'import' ? styles.dupSplitBtnActive : ''}`}
                                      onClick={() => {
                                        setImportDupActions(prev => {
                                          const next = new Map(prev)
                                          next.set(dup.csv_index, { action: 'import' })
                                          return next
                                        })
                                      }}
                                      title="Imputar como novo lançamento separado"
                                    >
                                      ➕ Separado
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.dupSplitBtn} ${styles.dupSplitBtnTransfer} ${dupState?.action === 'transfer' ? styles.dupSplitBtnActive : ''}`}
                                      onClick={() => {
                                        setImportDupActions(prev => {
                                          const next = new Map(prev)
                                          next.set(dup.csv_index, { action: 'transfer' })
                                          return next
                                        })
                                      }}
                                      title="Transferência interna: importa o lançamento como tipo 'transferência' (movimentação entre contas)"
                                    >
                                      🔄 Transferência
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.dupSplitBtnDetails}
                                      onClick={() => setSelectedDupIdx(dup.csv_index)}
                                      title="Abrir conciliação detalhada (escolher campo a campo)"
                                    >
                                      🔍 Detalhes
                                    </button>
                                    {dupState?.action !== 'pending' && (
                                      <button
                                        type="button"
                                        className={styles.dupSplitBtnReset}
                                        onClick={() => {
                                          setImportDupActions(prev => {
                                            const next = new Map(prev)
                                            next.set(dup.csv_index, { action: 'pending' })
                                            return next
                                          })
                                        }}
                                      >
                                        ↩ Desfazer
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <span className={styles.dupSplitNoAction}>✓ Será importado</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* MODAL SPLIT VIEW DE CONCILIAÇÃO */}
                {selectedDupIdx !== null && (() => {
                  const dup = importPreview.analysis?.potential_duplicates?.find(d => d.csv_index === selectedDupIdx)
                  if (!dup) return null
                  const csvRow = importPreview.rows[dup.csv_index]
                  if (!csvRow) return null
                  const dupState = importDupActions.get(dup.csv_index) || { action: 'pending' as DupAction }
                  const csvStatus = csvRow.status || 'pendente'
                  const existStatus = dup.existing_status
                  const choices = dupResolveChoices[dup.csv_index] || {}

                  // Define todos os campos a comparar
                  const fields: { key: string; label: string; csv: any; existing: any; format?: (v: any) => string; differs: boolean }[] = [
                    {
                      key: 'descricao',
                      label: 'Descrição',
                      csv: csvRow.descricao || '—',
                      existing: dup.existing_descricao || '—',
                      differs: (csvRow.descricao || '').trim().toLowerCase() !== (dup.existing_descricao || '').trim().toLowerCase(),
                    },
                    {
                      key: 'data',
                      label: 'Data de Competência',
                      csv: csvRow.competence_date,
                      existing: dup.existing_date,
                      format: (v) => fmtDate(v),
                      differs: csvRow.competence_date !== dup.existing_date,
                    },
                    {
                      key: 'valor',
                      label: 'Valor',
                      csv: csvRow.valor,
                      existing: dup.existing_valor,
                      format: (v) => fmtBRL(v),
                      differs: Math.abs(Number(csvRow.valor || 0)) !== Math.abs(Number(dup.existing_valor || 0)),
                    },
                    {
                      key: 'status',
                      label: 'Status',
                      csv: csvStatus,
                      existing: existStatus,
                      format: (v) => v === 'confirmado' ? '✓ Pago' : '⏳ Pendente',
                      differs: csvStatus !== existStatus,
                    },
                    {
                      key: 'contato',
                      label: 'Cliente / Fornecedor',
                      csv: csvRow.contato || '—',
                      existing: dup.existing_contato || '—',
                      differs: (csvRow.contato || '').trim().toLowerCase() !== (dup.existing_contato || '').trim().toLowerCase(),
                    },
                    {
                      key: 'categoria',
                      label: 'Categoria',
                      csv: csvRow.categoria || '—',
                      existing: '—',
                      differs: !!csvRow.categoria,
                    },
                  ]

                  const diffCount = fields.filter(f => f.differs).length

                  return (
                    <div className={styles.dupResolveBackdrop} onClick={() => setSelectedDupIdx(null)}>
                      <div className={styles.dupResolveModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.dupResolveHeader}>
                          <div>
                            <h2 className={styles.dupResolveTitle}>🔀 Conciliação de Lançamento</h2>
                            <div className={styles.dupResolveSubtitle}>
                              {diffCount === 0 ? '✓ Nenhuma divergência — provável duplicata exata' : `⚠ ${diffCount} campo${diffCount > 1 ? 's' : ''} divergente${diffCount > 1 ? 's' : ''} entre o CSV e o sistema`}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={styles.dupResolveCloseBtn}
                            onClick={() => setSelectedDupIdx(null)}
                          >
                            ✕
                          </button>
                        </div>

                        {/* Análise da IA */}
                        <div className={styles.dupResolveAiBox}>
                          <div className={styles.dupResolveAiHeader}>
                            <span className={styles.dupResolveAiBadge}>🤖 Análise da IA</span>
                            <span className={`${styles.importDupConfidence} ${styles[`importDupConfidence_${dup.confidence}`]}`}>
                              Confiança {dup.confidence === 'high' ? 'Alta' : dup.confidence === 'medium' ? 'Média' : 'Baixa'}
                            </span>
                          </div>
                          <div className={styles.dupResolveAiText}>{dup.reason}</div>
                          <div className={styles.dupResolveAiHint}>
                            💡 <strong>Recomendação:</strong> {dup.confidence === 'high'
                              ? 'É praticamente certo que é o mesmo lançamento. Combine para evitar duplicação.'
                              : 'Pode ser duplicata, mas há algumas diferenças. Revise os campos abaixo antes de decidir.'
                            }
                          </div>
                        </div>

                        {/* Tabela Split View Lado-a-Lado */}
                        <div className={styles.dupResolveCompareTable}>
                          <div className={styles.dupResolveCompareHeader}>
                            <div className={styles.dupResolveCompareCell}>📋 Campo</div>
                            <div className={`${styles.dupResolveCompareCell} ${styles.dupResolveCompareCellExisting}`}>
                              💾 Já cadastrado no sistema
                            </div>
                            <div className={`${styles.dupResolveCompareCell} ${styles.dupResolveCompareCellCsv}`}>
                              📥 Vindo do CSV
                            </div>
                            <div className={styles.dupResolveCompareCell}>✓ Manter</div>
                          </div>
                          {fields.map((field) => {
                            const csvVal = field.format ? field.format(field.csv) : String(field.csv ?? '—')
                            const exVal = field.format ? field.format(field.existing) : String(field.existing ?? '—')
                            const choice = choices[field.key] || (field.differs ? 'csv' : 'existing')
                            return (
                              <div key={field.key} className={`${styles.dupResolveCompareRow} ${field.differs ? styles.dupResolveCompareRowDiff : ''}`}>
                                <div className={styles.dupResolveCompareCell}>
                                  <strong>{field.label}</strong>
                                  {field.differs && <span className={styles.dupResolveDiffMark}>⚠ diferente</span>}
                                </div>
                                <div
                                  className={`${styles.dupResolveCompareCell} ${styles.dupResolveCompareCellExisting} ${choice === 'existing' ? styles.dupResolveCompareCellChosen : ''}`}
                                  onClick={() => {
                                    setDupResolveChoices(prev => ({
                                      ...prev,
                                      [dup.csv_index]: { ...(prev[dup.csv_index] || {}), [field.key]: 'existing' }
                                    }))
                                  }}
                                >
                                  {exVal}
                                </div>
                                <div
                                  className={`${styles.dupResolveCompareCell} ${styles.dupResolveCompareCellCsv} ${choice === 'csv' ? styles.dupResolveCompareCellChosen : ''}`}
                                  onClick={() => {
                                    setDupResolveChoices(prev => ({
                                      ...prev,
                                      [dup.csv_index]: { ...(prev[dup.csv_index] || {}), [field.key]: 'csv' }
                                    }))
                                  }}
                                >
                                  {csvVal}
                                </div>
                                <div className={styles.dupResolveCompareCell}>
                                  <span className={`${styles.dupResolveChoiceTag} ${choice === 'csv' ? styles.dupResolveChoiceTagCsv : styles.dupResolveChoiceTagExisting}`}>
                                    {choice === 'csv' ? '📥 CSV' : '💾 Sistema'}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Ações finais */}
                        <div className={styles.dupResolveActions}>
                          <button
                            type="button"
                            className={`${styles.dupResolveBtn} ${styles.dupResolveBtnCombine} ${dupState.action === 'combine' ? styles.dupResolveBtnActive : ''}`}
                            onClick={() => {
                              setImportDupActions(prev => {
                                const next = new Map(prev)
                                const finalStatus = (choices['status'] === 'csv' ? csvStatus : existStatus) as 'confirmado' | 'pendente'
                                next.set(dup.csv_index, { action: 'combine', chosenStatus: finalStatus })
                                return next
                              })
                              setSelectedDupIdx(null)
                            }}
                          >
                            🔗 Combinar com existente (atualizar campos escolhidos)
                          </button>
                          <button
                            type="button"
                            className={`${styles.dupResolveBtn} ${styles.dupResolveBtnImport} ${dupState.action === 'import' ? styles.dupResolveBtnActive : ''}`}
                            onClick={() => {
                              setImportDupActions(prev => {
                                const next = new Map(prev)
                                next.set(dup.csv_index, { action: 'import' })
                                return next
                              })
                              setSelectedDupIdx(null)
                            }}
                          >
                            ➕ Imputar mesmo assim (criar lançamento separado)
                          </button>
                          <button
                            type="button"
                            className={`${styles.dupResolveBtn} ${styles.dupResolveBtnIgnore}`}
                            onClick={() => {
                              setImportDupActions(prev => {
                                const next = new Map(prev)
                                next.set(dup.csv_index, { action: 'pending' })
                                return next
                              })
                              setSelectedDupIdx(null)
                            }}
                          >
                            ↩ Desfazer / Decidir depois
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className={`${styles.importPreviewBlock} ${styles.importPreviewTableBlock}`}>
                  <div className={styles.importPreviewBlockTitle}>
                    {activeImportAlert
                      ? `Conferência filtrada · ${importRowsToDisplay.length} linha${importRowsToDisplay.length !== 1 ? 's' : ''}`
                      : 'Conferência completa do arquivo'}
                  </div>
                  <div className={`${styles.tableWrap} ${styles.importPreviewTableWrap}`}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Competência</th><th>Descrição</th><th>Contato</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th>Status</th><th></th></tr>
                      </thead>
                      <tbody>
                      {importRowsToDisplay.map((row) => {
                        const index = importPreview.rows.indexOf(row)
                        const isEditing = editingImportRowIndex === index && editingImportRow
                        const draft = isEditing ? editingImportRow : null
                        const rowTipo = draft?.tipo || row.tipo
                        const dupMatch = importPreview.analysis?.potential_duplicates?.find(d => d.csv_index === index)
                        const dupState = importDupActions.get(index)
                        const isCombined = dupState?.action === 'combine'
                        return (
                        <tr
                          key={`${row.descricao}-${row.competence_date}-${index}`}
                          className={isCombined ? styles.importRowSkipped : ''}
                        >
                          <td className={styles.tdMuted}>
                            {isEditing ? (
                              <input
                                type="date"
                                className={styles.importCellInput}
                                value={draft?.competence_date || ''}
                                onChange={e => setEditingImportRow(prev => prev ? { ...prev, competence_date: e.target.value } : prev)}
                              />
                            ) : fmtDate(row.competence_date)}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="text"
                                className={styles.importCellInput}
                                value={draft?.descricao || ''}
                                onChange={e => setEditingImportRow(prev => prev ? { ...prev, descricao: e.target.value } : prev)}
                              />
                            ) : (
                              <div>
                                {row.descricao}
                                {dupMatch && (
                                  <div className={`${styles.importDupInlineBadge} ${styles[`importDupConfidence_${dupMatch.confidence}`]}`}>
                                    {dupState?.action === 'combine'
                                      ? `🔗 Será combinado com “${dupMatch.existing_descricao}”`
                                      : dupState?.action === 'import'
                                        ? `➕ Será importado como novo (duplicata de “${dupMatch.existing_descricao}”)`
                                        : `⚠ Provável duplicata de “${dupMatch.existing_descricao}” — resolva acima`
                                    }
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <div className={styles.importCellStack}>
                                <input
                                  list="financeiro-import-contatos"
                                  type="text"
                                  className={styles.importCellInput}
                                  value={draft?.contato || ''}
                                  onChange={e => setEditingImportRow(prev => prev ? { ...prev, contato: e.target.value } : prev)}
                                  placeholder="Contato"
                                />
                                <button
                                  type="button"
                                  className={styles.importInlineAction}
                                  onClick={() => openNovoContatoDaImportacao(index, rowTipo === 'transferencia' ? 'saida' : rowTipo)}
                                >
                                  Novo contato
                                </button>
                              </div>
                            ) : <span className={styles.tdMuted}>{row.contato || '—'}</span>}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                list={`financeiro-import-categorias-${rowTipo}`}
                                type="text"
                                className={styles.importCellInput}
                                value={draft?.categoria || ''}
                                onChange={e => setEditingImportRow(prev => prev ? { ...prev, categoria: e.target.value } : prev)}
                                placeholder="Categoria"
                              />
                            ) : <span className={styles.tdMuted}>{row.categoria || '—'}</span>}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                className={styles.importCellSelect}
                                value={draft?.tipo || row.tipo}
                                onChange={e => setEditingImportRow(prev => prev ? { ...prev, tipo: e.target.value as 'entrada' | 'saida' | 'transferencia', categoria: '' } : prev)}
                              >
                                <option value="entrada">Entrada</option>
                                <option value="saida">Saída</option>
                                <option value="transferencia">Transferência</option>
                              </select>
                            ) : (
                              <span className={`${styles.tipoBadge} ${row.tipo === 'entrada' ? styles.tipoEntrada : row.tipo === 'transferencia' ? styles.statusConfirmado : styles.tipoSaida}`}>
                                {row.tipo === 'entrada' ? 'Entrada' : row.tipo === 'transferencia' ? 'Transferência' : 'Saída'}
                              </span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className={styles.importCellInput}
                                value={String(draft?.valor ?? row.valor)}
                                onChange={e => setEditingImportRow(prev => prev ? { ...prev, valor: Number(e.target.value) } : prev)}
                              />
                            ) : (
                              <span className={row.tipo === 'entrada' ? styles.valorEntrada : styles.valorSaida}>{fmtBRL(row.valor)}</span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                className={styles.importCellSelect}
                                value={draft?.status || row.status}
                                onChange={e => setEditingImportRow(prev => prev ? {
                                  ...prev,
                                  status: e.target.value as 'confirmado' | 'pendente',
                                  payment_date: e.target.value === 'confirmado'
                                    ? (prev.payment_date || prev.competence_date)
                                    : null,
                                } : prev)}
                              >
                                <option value="confirmado">Confirmado</option>
                                <option value="pendente">Pendente</option>
                              </select>
                            ) : (
                              <span className={`${styles.statusBadge} ${row.status === 'confirmado' ? styles.statusConfirmado : styles.statusPendente}`}>
                                {row.status === 'confirmado' ? 'Confirmado' : 'Pendente'}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              {isEditing ? (
                                <>
                                  {activeImportAlert && (
                                    <div className={styles.importBulkApplyWrap}>
                                      <button
                                        type="button"
                                        className={styles.actionBtn}
                                        onClick={() => setShowBulkApplyPanel(current => !current)}
                                        title="Escolha quais campos aplicar para todas as linhas visíveis neste filtro"
                                      >
                                        Aplicar para filtradas
                                      </button>
                                      {showBulkApplyPanel && (
                                        <div className={styles.importBulkApplyPanel}>
                                          <div className={styles.importBulkApplyTitle}>Aplicar em lote</div>
                                          <label className={styles.importBulkApplyOption}>
                                            <input
                                              type="checkbox"
                                              checked={bulkApplyFields.contato}
                                              onChange={e => setBulkApplyFields(prev => ({ ...prev, contato: e.target.checked }))}
                                            />
                                            <span>Contato</span>
                                          </label>
                                          <label className={styles.importBulkApplyOption}>
                                            <input
                                              type="checkbox"
                                              checked={bulkApplyFields.categoria}
                                              onChange={e => setBulkApplyFields(prev => ({ ...prev, categoria: e.target.checked }))}
                                            />
                                            <span>Categoria</span>
                                          </label>
                                          <label className={styles.importBulkApplyOption}>
                                            <input
                                              type="checkbox"
                                              checked={bulkApplyFields.tipo}
                                              onChange={e => setBulkApplyFields(prev => ({ ...prev, tipo: e.target.checked }))}
                                            />
                                            <span>Tipo</span>
                                          </label>
                                          <label className={styles.importBulkApplyOption}>
                                            <input
                                              type="checkbox"
                                              checked={bulkApplyFields.status}
                                              onChange={e => setBulkApplyFields(prev => ({ ...prev, status: e.target.checked }))}
                                            />
                                            <span>Status</span>
                                          </label>
                                          <div className={styles.importBulkApplyActions}>
                                            <button type="button" className={styles.btnQuickCancel} onClick={() => setShowBulkApplyPanel(false)}>Fechar</button>
                                            <button type="button" className={styles.btnQuickSave} onClick={applyImportEditToFilteredRows}>Aplicar</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <button type="button" className={styles.actionBtn} onClick={saveImportRowEdit}>Salvar</button>
                                  <button type="button" className={`${styles.actionBtn} ${styles.actionBtnDel}`} onClick={cancelImportRowEdit}>Cancelar</button>
                                </>
                              ) : (
                                <button type="button" className={styles.actionBtn} onClick={() => startImportRowEdit(index)}>Editar</button>
                              )}
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                      </tbody>
                    </table>
                  </div>
                  <datalist id="financeiro-import-contatos">
                    {importContactOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </datalist>
                  <datalist id="financeiro-import-categorias-entrada">
                    {categorias.filter(categoria => categoria.tipo === 'entrada').map(categoria => (
                      <option key={categoria.id} value={categoria.nome}>{categoria.nome}</option>
                    ))}
                  </datalist>
                  <datalist id="financeiro-import-categorias-saida">
                    {categorias.filter(categoria => categoria.tipo === 'saida').map(categoria => (
                      <option key={categoria.id} value={categoria.nome}>{categoria.nome}</option>
                    ))}
                  </datalist>
                </div>
              </div>

              {importProgress && (
                <div className={styles.importProgressBar}>
                  <div
                    className={styles.importProgressFill}
                    style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                  />
                  <span className={styles.importProgressLabel}>
                    {importProgress.done} / {importProgress.total} lançamentos
                  </span>
                </div>
              )}

              <div className={styles.formActions}>
                <button type="button" className={styles.btnCancelForm} disabled={importPreviewLoading} onClick={() => setImportPreview(null)}>Cancelar</button>
                <button
                  type="button"
                  className={styles.btnSave}
                  disabled={(() => {
                    if (importPreviewLoading) return true
                    const hasPending = Array.from(importDupActions.values()).some(a => a.action === 'pending')
                    if (hasPending) return true
                    // Verifica se alguma combinação com status diferente não foi resolvida
                    for (const [idx, a] of importDupActions.entries()) {
                      if (a.action !== 'combine' || a.chosenStatus) continue
                      const dup = importPreview?.analysis?.potential_duplicates?.find(d => d.csv_index === idx)
                      const csvStatus = importPreview?.rows[idx]?.status || 'pendente'
                      if (dup && dup.existing_status !== csvStatus) return true
                    }
                    return false
                  })()}
                  onClick={() => void confirmImportPreview()}
                >
                  {importPreviewLoading
                    ? importProgress
                      ? `Importando lote ${Math.ceil(importProgress.done / 500)} de ${Math.ceil(importProgress.total / 500)}…`
                      : 'Preparando…'
                    : (() => {
                        const pending = Array.from(importDupActions.values()).filter(a => a.action === 'pending').length
                        const needsStatus = Array.from(importDupActions.entries()).filter(([idx, a]) => {
                          if (a.action !== 'combine' || a.chosenStatus) return false
                          const dup = importPreview?.analysis?.potential_duplicates?.find(d => d.csv_index === idx)
                          return dup && dup.existing_status !== importPreview?.rows[idx]?.status
                        }).length
                        if (pending > 0) return `Resolva ${pending} duplicata${pending > 1 ? 's' : ''} para importar`
                        if (needsStatus > 0) return `Escolha status de ${needsStatus} combinação${needsStatus > 1 ? 'ões' : ''}`
                        return 'Importar agora'
                      })()
                  }
                </button>
              </div>
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
