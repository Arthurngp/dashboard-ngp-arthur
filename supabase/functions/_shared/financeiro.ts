export function parseCurrencyInput(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value == null) return null

  const raw = String(value).trim()
  if (!raw) return null

  const cleaned = raw
    .replace(/\s+/g, '')
    .replace(/^R\$/i, '')
    .replace(/[^\d,.-]/g, '')

  if (!cleaned) return null

  let normalized = cleaned
  const hasComma = normalized.includes(',')
  const hasDot = normalized.includes('.')

  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    normalized = normalized.replace(',', '.')
  } else {
    const dotMatches = normalized.match(/\./g)
    if (dotMatches && dotMatches.length > 1) normalized = normalized.replace(/\./g, '')
  }

  normalized = normalized.replace(/(?!^)-/g, '')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function lastDayOfMonth(ano: number, mes: number): string {
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10)
}

export function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

export function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}
