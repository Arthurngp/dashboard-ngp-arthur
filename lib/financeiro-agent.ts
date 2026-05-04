export type FinanceiroAgentIntent =
  | 'briefing'
  | 'risks'
  | 'forecast'
  | 'cashflow'
  | 'categorization'
  | 'unknown'

export interface FinanceiroAgentPeriod {
  start: string
  end: string
  label: string
}

export interface FinanceiroAgentTotals {
  entradas: number
  saidas: number
  saldo: number
  pendenteEntrada: number
  pendenteSaida: number
}

export function detectFinanceiroAgentIntent(message: string | null | undefined): FinanceiroAgentIntent {
  const normalized = normalizeText(message)
  if (!normalized) return 'briefing'

  if (containsAny(normalized, ['risco', 'alerta', 'atraso', 'vencid', 'inadimpl', 'problema'])) {
    return 'risks'
  }
  if (containsAny(normalized, ['previs', 'projec', 'forecast', 'tendencia', 'tendencia'])) {
    return 'forecast'
  }
  if (containsAny(normalized, ['caixa', 'saldo', 'fluxo', 'cashflow', 'cash flow'])) {
    return 'cashflow'
  }
  if (containsAny(normalized, ['categoria', 'categorizar', 'classifica', 'centro de custo'])) {
    return 'categorization'
  }
  if (containsAny(normalized, ['briefing', 'resumo', 'painel', 'diagnostico', 'diagnostico'])) {
    return 'briefing'
  }

  return 'unknown'
}

export function buildFinanceiroAgentPeriod(
  now: Date,
  input?: { start?: string | null; end?: string | null; label?: string | null } | null,
): FinanceiroAgentPeriod {
  const inputStart = normalizeDateOnly(input?.start)
  const inputEnd = normalizeDateOnly(input?.end)
  if (inputStart && inputEnd && inputStart <= inputEnd) {
    return {
      start: inputStart,
      end: inputEnd,
      label: input?.label?.trim() || `${inputStart} a ${inputEnd}`,
    }
  }

  const year = now.getFullYear()
  const month = now.getMonth()
  const start = formatDateOnly(new Date(Date.UTC(year, month, 1)))
  const end = formatDateOnly(new Date(Date.UTC(year, month + 1, 0)))
  return { start, end, label: 'Mês atual' }
}

export function summarizeFinanceiroAgentTotals(rows: Array<{
  tipo?: string | null
  valor?: number | string | null
  status?: string | null
}>): FinanceiroAgentTotals {
  return rows.reduce<FinanceiroAgentTotals>((acc, row) => {
    const value = Math.abs(Number(row.valor || 0))
    if (!Number.isFinite(value)) return acc

    if (row.tipo === 'entrada') {
      if (row.status === 'pendente') acc.pendenteEntrada += value
      else acc.entradas += value
    } else if (row.tipo === 'saida') {
      if (row.status === 'pendente') acc.pendenteSaida += value
      else acc.saidas += value
    }

    acc.saldo = acc.entradas - acc.saidas
    return acc
  }, { entradas: 0, saidas: 0, saldo: 0, pendenteEntrada: 0, pendenteSaida: 0 })
}

export function buildFinanceiroAgentFallback(totals: FinanceiroAgentTotals): string[] {
  const actions: string[] = []

  if (totals.pendenteEntrada > 0) {
    actions.push('Revisar entradas pendentes e priorizar cobranças com maior valor.')
  }
  if (totals.pendenteSaida > 0) {
    actions.push('Conferir despesas pendentes antes de comprometer o saldo projetado.')
  }
  if (totals.saldo < 0) {
    actions.push('Montar plano de contenção para o período, porque o realizado está negativo.')
  }
  if (actions.length === 0) {
    actions.push('Acompanhar lançamentos novos e manter categorias, contatos e contas conciliados.')
  }

  return actions
}

function containsAny(value: string, terms: string[]) {
  return terms.some(term => value.includes(term))
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}
