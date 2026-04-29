export function parseCurrencyInput(value: string | number | null | undefined): number | null {
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
