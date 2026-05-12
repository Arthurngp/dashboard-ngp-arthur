import { parseCurrencyInput } from './financeiro'

export interface ImportedCsvRow {
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
  // Quando tipo='transferencia', conta destino do par (origem é a conta da
  // importação). Preenchido na UI antes do commit; backend cria par.
  transfer_destination_account_id?: string | null
}

export interface AiDuplicateMatch {
  csv_index: number
  existing_id: string
  existing_descricao: string
  existing_tipo: string
  existing_valor: number
  existing_date: string
  existing_status: string
  existing_contato: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type DupAction = 'pending' | 'combine' | 'import' | 'transfer'

export interface DupActionState {
  action: DupAction
  chosenStatus?: 'confirmado' | 'pendente'
}

export interface ImportAnalysis {
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
}

export interface ImportPreviewData {
  accountId: string | null
  accountName: string
  fileName: string
  rows: ImportedCsvRow[]
  analysis?: ImportAnalysis | null
}

export type ImportAlertKey = 'duplicados' | 'transferencias' | 'sem-categoria' | 'sem-contato'

export function normalizeContactKey(value?: string | null) {
  return (value || '').trim().toLowerCase()
}

export function parseCsvLine(line: string, delimiter = ',') {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else current += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === delimiter) { out.push(current.trim()); current = '' }
      else current += ch
    }
  }
  out.push(current.trim())
  return out
}

export function parsePtBrDateToIso(value: string): string | null {
  const raw = (value || '').trim()
  if (!raw) return null
  const matchBr = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (matchBr) {
    const day = matchBr[1].padStart(2, '0')
    const month = matchBr[2].padStart(2, '0')
    let year = matchBr[3]
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }
  const matchIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (matchIso) return `${matchIso[1]}-${matchIso[2]}-${matchIso[3]}`
  const matchDash = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (matchDash) return `${matchDash[3]}-${matchDash[2]}-${matchDash[1]}`
  return null
}

export function parseImportCsvContent(content: string): ImportedCsvRow[] {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim())
  if (lines.length <= 1) return []

  const sampleLine = lines.find(l => l.includes(';') || l.includes(',')) ?? lines[0]
  const countComma = (sampleLine.match(/,/g) || []).length
  const countSemi = (sampleLine.match(/;/g) || []).length
  const delimiter = countSemi > countComma ? ';' : ','

  const headerKeywords = ['data', 'date', 'valor', 'value', 'descrição', 'descricao', 'historico', 'histórico', 'transacao', 'transação']
  const headerLineIdx = lines.findIndex(line => {
    const cols = parseCsvLine(line, delimiter).map(h => normalizeContactKey(h))
    return cols.some(h => headerKeywords.some(k => h.includes(k)))
  })
  if (headerLineIdx < 0) return []

  const headers = parseCsvLine(lines[headerLineIdx], delimiter).map(h => normalizeContactKey(h))
  const rows: ImportedCsvRow[] = []

  const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)))

  const idxDate = findIdx(['data', 'date', 'competência', 'competencia'])
  const idxDue = findIdx(['vencimento', 'venc'])
  const idxPayment = findIdx(['pagamento', 'pago em', 'baixa'])
  const idxDesc = findIdx(['descrição', 'descricao', 'histórico', 'historico'])
  const idxValor = findIdx(['valor', 'total', 'montante', 'preço', 'débito', 'crédito', 'debito', 'credito'])
  const idxStatus = findIdx(['status', 'situação', 'situacao', 'pago'])
  const idxCat = findIdx(['categoria', 'plano'])
  const idxCont = findIdx(['contato', 'cliente', 'fornecedor', 'favorecido', 'pessoa'])
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

    let status: 'confirmado' | 'pendente' = 'pendente'
    const statusVal = idxStatus >= 0 ? normalizeContactKey(cols[idxStatus]) : ''
    const paymentDate = idxPayment >= 0 ? parsePtBrDateToIso(cols[idxPayment]) : null
    if (paymentDate || statusVal.includes('pago') || statusVal.includes('confirmado') || statusVal.includes('liquidado')) {
      status = 'confirmado'
    }
    if (idxStatus < 0 && idxPayment < 0) {
      status = 'confirmado'
    }

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

export function summarizeImportRows(rows: ImportedCsvRow[]) {
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

export function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
