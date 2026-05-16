// ─── Dashboard Types ──────────────────────────────────────────────────────────
// Extraído de page.tsx para reduzir o tamanho do arquivo principal.

import { Cliente, DateParam } from '@/types'

export type Screen = 'select' | 'dashboard'
export type Tab = 'resumo' | 'campanhas' | 'graficos' | 'relatorios' | 'plataformas' | 'notificacoes' | 'copilot'

export interface BudgetAlert {
  clientId: string
  clientName: string
  clientFoto?: string
  accountId: string
  balance: number
  amountSpent: number
  spendCap: number
  currency: string
  accountStatus: number
  disableReason: number
  issue: 'no_balance' | 'low_balance' | 'card_declined' | 'account_disabled' | 'unsettled' | 'no_account' | 'no_spend_cap'
  issueLabel: string
  severity: 'critical' | 'warning' | 'info'
}

export interface Viewing {
  account: string
  name: string
  username: string
  id: string
}

export interface OverviewMetrics {
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  cpm: number
  reach: number
  leads: number
  conversations: number
  purchases: number
  roas: number
  revenue: number
  frequency: number
  results: number
  resultLabel: string
  costPerLead: number
  costPerResult: number
}

export interface OverviewRow {
  client: Cliente
  current: OverviewMetrics | null
  previous: OverviewMetrics | null
  status: 'ok' | 'no_account' | 'error'
  error?: string
}

export interface WorkspaceNavItem {
  id: string
  label: string
  meta?: string
  badge?: string
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  onClick?: () => void
}

export interface WorkspaceNavSection {
  label: string
  items: WorkspaceNavItem[]
}

export const OVERVIEW_COLUMNS = [
  { id: 'spend', label: 'Investido' },
  { id: 'results', label: 'Resultados' },
  { id: 'ctr', label: 'CTR' },
  { id: 'cpc', label: 'CPC' },
  { id: 'cpl', label: 'CPL' },
  { id: 'roas', label: 'ROAS' },
  { id: 'reach', label: 'Alcance' },
]

export const BG_COLORS = [
  'linear-gradient(135deg,#3b82f6,#7c3aed)',
  'linear-gradient(135deg,#059669,#14b8a6)',
  'linear-gradient(135deg,#dc2626,#f97316)',
  'linear-gradient(135deg,#7c3aed,#ec4899)',
  'linear-gradient(135deg,#0891b2,#3b82f6)',
  'linear-gradient(135deg,#16a34a,#65a30d)',
  'linear-gradient(135deg,#ea580c,#f59e0b)',
  'linear-gradient(135deg,#be185d,#7c3aed)',
]
