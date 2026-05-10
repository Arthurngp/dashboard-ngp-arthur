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

// ─── Soft delete: filtro inline ─────────────────────────────────────────────
// Em queries de leitura de fin_transacoes que computam saldo, relatórios,
// dashboard, DRE, etc., adicione SEMPRE `.is('deleted_at', null)`:
//
//   const { data } = await sb
//     .from('fin_transacoes')
//     .select('account_id, tipo, valor')
//     .eq('status', 'confirmado')
//     .is('deleted_at', null)         // ← filtro de soft delete
//     ...
//
// NÃO use em INSERT/UPDATE/DELETE de fin_transacoes (esses são writes por id).
//
// Motivação: a tabela fin_transacoes tem soft delete via coluna deleted_at.
// A view fin_transacoes_ativas existe mas PostgREST/supabase-js não resolve
// embedded resources em views (account:fin_accounts(nome) etc), então usamos
// a tabela base + filtro inline. Helper foi tentado mas se interferia com
// outros filtros do builder do supabase-js — ficar com chamada inline garante
// previsibilidade.
