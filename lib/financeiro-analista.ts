// Tipos e parsers para a aba IA Analista do financeiro.
// Frontend: app/financeiro/analista/page.tsx
// Backend: supabase/functions/financeiro-agent (actions analista_*)

export type Confidence = 'high' | 'medium' | 'low'
export type SaudeStatus = 'healthy' | 'warning' | 'critical'

export interface MonthlyForecast {
  month_label: string
  projected_revenue: number
  projected_expense: number
  projected_net: number
  confidence: Confidence
}

export interface PrevisaoResult {
  headline: string
  diagnosis: string
  projected_3m_total: number
  monthly_breakdown: MonthlyForecast[]
  drivers: string[]
  risks: string[]
  next_actions: string[]
  data_gaps: string[]
  confidence: Confidence
}

export interface PadroesResult {
  headline: string
  diagnosis: string
  trends: string[]
  hotspots: string[]
  anomalies: string[]
  next_actions: string[]
  confidence: Confidence
}

export interface SaudeResult {
  headline: string
  diagnosis: string
  status: SaudeStatus
  runway_months: number | null
  monthly_burn: number
  monthly_revenue: number
  margin_pct: number
  strengths: string[]
  weaknesses: string[]
  next_actions: string[]
  confidence: Confidence
}

// Lacunas é gerado direto pelo front a partir de query SQL — não usa OpenAI.
export interface LacunasResult {
  total_transacoes: number
  sem_categoria: number
  entrada_sem_cliente: number
  saida_sem_fornecedor: number
  sem_centro_custo: number
  data_muito_futura: number  // competence_date > hoje + 3 anos (provisões loucas)
  data_muito_antiga: number  // competence_date < 5 anos atrás
  valor_zero: number
  contas_orfas: { nome: string; qtd: number }[]
  // Avaliação textual gerada localmente
  impact_summary: string
  computed_at: string  // ISO
}

export interface AnalistaRunMeta {
  run_id: string | null
  created_at: string | null
  status: 'completed' | 'fallback' | 'error'
}

export type AnalistaAction = 'analista_previsao' | 'analista_padroes' | 'analista_saude'

export interface AnalistaApiResponse<T> {
  run_id: string | null
  created_at: string | null
  status: 'completed' | 'fallback' | 'error'
  action: AnalistaAction
  snapshot: unknown
  response: T | null
  error?: string
}

export interface AnalistaUltimaResponse {
  latest: {
    analista_previsao: { id: string; snapshot: unknown; response: PrevisaoResult | null; status: string; model: string | null; created_at: string } | null
    analista_padroes: { id: string; snapshot: unknown; response: PadroesResult | null; status: string; model: string | null; created_at: string } | null
    analista_saude: { id: string; snapshot: unknown; response: SaudeResult | null; status: string; model: string | null; created_at: string } | null
  }
  error?: string
}

// ─── Parsers defensivos ───────────────────────────────────────────────────────
// Garantem que nada que vem da edge/IA quebre o front por shape inesperado.

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => asString(x).trim()).filter(Boolean)
}

function asConfidence(v: unknown): Confidence {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium'
}

function asSaudeStatus(v: unknown): SaudeStatus {
  return v === 'healthy' || v === 'warning' || v === 'critical' ? v : 'warning'
}

export function parsePrevisao(value: unknown): PrevisaoResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const headline = asString(v.headline).trim()
  const diagnosis = asString(v.diagnosis).trim()
  if (!headline || !diagnosis) return null

  const monthly = Array.isArray(v.monthly_breakdown)
    ? v.monthly_breakdown
        .map((m) => {
          if (!m || typeof m !== 'object') return null
          const mr = m as Record<string, unknown>
          return {
            month_label: asString(mr.month_label).trim(),
            projected_revenue: asNumber(mr.projected_revenue),
            projected_expense: asNumber(mr.projected_expense),
            projected_net: asNumber(mr.projected_net),
            confidence: asConfidence(mr.confidence),
          }
        })
        .filter((x): x is MonthlyForecast => x !== null && x.month_label !== '')
    : []

  return {
    headline,
    diagnosis,
    projected_3m_total: asNumber(v.projected_3m_total),
    monthly_breakdown: monthly,
    drivers: asStringArray(v.drivers),
    risks: asStringArray(v.risks),
    next_actions: asStringArray(v.next_actions),
    data_gaps: asStringArray(v.data_gaps),
    confidence: asConfidence(v.confidence),
  }
}

export function parsePadroes(value: unknown): PadroesResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const headline = asString(v.headline).trim()
  const diagnosis = asString(v.diagnosis).trim()
  if (!headline || !diagnosis) return null
  return {
    headline,
    diagnosis,
    trends: asStringArray(v.trends),
    hotspots: asStringArray(v.hotspots),
    anomalies: asStringArray(v.anomalies),
    next_actions: asStringArray(v.next_actions),
    confidence: asConfidence(v.confidence),
  }
}

export function parseSaude(value: unknown): SaudeResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const headline = asString(v.headline).trim()
  const diagnosis = asString(v.diagnosis).trim()
  if (!headline || !diagnosis) return null
  return {
    headline,
    diagnosis,
    status: asSaudeStatus(v.status),
    runway_months: asNumberOrNull(v.runway_months),
    monthly_burn: asNumber(v.monthly_burn),
    monthly_revenue: asNumber(v.monthly_revenue),
    margin_pct: asNumber(v.margin_pct),
    strengths: asStringArray(v.strengths),
    weaknesses: asStringArray(v.weaknesses),
    next_actions: asStringArray(v.next_actions),
    confidence: asConfidence(v.confidence),
  }
}

// Cor/ícone ajudam o card a renderizar feedback visual.
export function confidenceLabel(c: Confidence): string {
  return c === 'high' ? 'Alta' : c === 'medium' ? 'Média' : 'Baixa'
}

export function saudeStatusLabel(s: SaudeStatus): string {
  return s === 'healthy' ? 'Saudável' : s === 'warning' ? 'Atenção' : 'Crítico'
}

export function fmtBRLCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`
  return `R$ ${v.toFixed(0)}`
}

export function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}
