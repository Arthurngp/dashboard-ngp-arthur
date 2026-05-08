import {
  normalizeContactKey,
  type ImportAlertKey,
  type ImportedCsvRow,
} from '@/lib/financeiro-import'
import type {
  PeriodoTipo,
  ReceitaCnpjData,
  Transacao,
} from './types'

export const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
export const MESES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export function normalizeSearchText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

export function isInternalTransferTransaction(transaction: Pick<Transacao, 'descricao' | 'observacoes' | 'categoria'>) {
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

export function todayISO() {
  return new Date().toISOString().split('T')[0]
}

export function monthStartISO() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
}

export function calcPeriodo(
  tipo: PeriodoTipo,
  mesEspecifico?: string,
  customStart?: string,
  customEnd?: string,
): { start: string | null; end: string | null; label: string } {
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

export function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

export function formatCnpj(value: string) {
  const d = digitsOnly(value).slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export function formatPhoneBR(value?: string | null) {
  const d = digitsOnly(value || '')
  if (!d) return ''
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return value || ''
}

export function getReceitaSnapshot(data: ReceitaCnpjData) {
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

export function buildObservacoesFromCnpj(data: ReceitaCnpjData) {
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

export function getContactGroupKey(item: { nome?: string; documento?: string; email?: string; telefone?: string }) {
  const documento = digitsOnly(item.documento || '')
  if (documento) return `doc:${documento}`
  const email = normalizeContactKey(item.email)
  if (email) return `email:${email}`
  const phone = digitsOnly(item.telefone || '')
  if (phone) return `phone:${phone}`
  return `nome:${normalizeContactKey(item.nome)}`
}

export function escapeCsvValue(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

export function buildImportWarnings(rows: ImportedCsvRow[]) {
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

export function getImportAlertRows(rows: ImportedCsvRow[], key: ImportAlertKey) {
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

export function buildImportAlerts(rows: ImportedCsvRow[]) {
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
