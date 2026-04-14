// Tipos TypeScript para CRM NGP

export interface Lead {
  id: string
  created_at: string
  updated_at: string

  // Dados do lead
  nome: string
  email: string
  telefone?: string
  empresa?: string
  cargo?: string

  // Qualificação
  status: LeadStatus
  fonte?: string

  // Valor estimado
  valor_prospecto?: number
  moeda?: string

  // Etapas do pipeline
  pipeline_stage: PipelineStage
  next_action_date?: string
  next_action?: string

  // Observações
  notas?: string
  tags?: string[]

  // Responsável
  owner_id?: string

  // Metadados
  meta_account_id?: string
  source?: string
}

export type LeadStatus =
  | 'novo'
  | 'contato_realizado'
  | 'proposta'
  | 'negociacao'
  | 'vencido'
  | 'ganho'
  | 'perdido'

export type PipelineStage =
  | 'prospeccao'
  | 'qualificacao'
  | 'proposta'
  | 'negociacao'
  | 'fechado'
  | 'perdido'

export interface Activity {
  id: string
  created_at: string

  lead_id: string
  activity_type: ActivityType
  description?: string
  scheduled_at?: string
  completed_at?: string
  created_by?: string

  attachments?: any[]
}

export type ActivityType =
  | 'ligacao'
  | 'email'
  | 'reuniao'
  | 'proposta'
  | 'visita'
  | 'outro'

export interface FollowUp {
  id: string
  created_at: string

  lead_id: string
  follow_up_date: string
  description: string
  completed: boolean
  completed_at?: string
  created_by?: string
  priority: FollowUpPriority
}

export type FollowUpPriority = 'baixa' | 'normal' | 'alta'

// Pipeline stages com metadados para UI
export interface PipelineStageMeta {
  id: PipelineStage
  title: string
  color: string
  order: number
}

export const PIPELINE_STAGES: PipelineStageMeta[] = [
  { id: 'prospeccao', title: 'Prospecção', color: '#3b82f6', order: 1 },
  { id: 'qualificacao', title: 'Qualificação', color: '#8b5cf6', order: 2 },
  { id: 'proposta', title: 'Proposta', color: '#f59e0b', order: 3 },
  { id: 'negociacao', title: 'Negociação', color: '#ec4899', order: 4 },
  { id: 'fechado', title: 'Fechado', color: '#10b981', order: 5 },
  { id: 'perdido', title: 'Perdido', color: '#ef4444', order: 6 },
]

export const LEAD_STATUSES = {
  novo: { label: 'Novo', color: '#3b82f6' },
  contato_realizado: { label: 'Contato Realizado', color: '#8b5cf6' },
  proposta: { label: 'Proposta', color: '#f59e0b' },
  negociacao: { label: 'Negociação', color: '#ec4899' },
  vencido: { label: 'Vencido', color: '#ef4444' },
  ganho: { label: 'Ganho', color: '#10b981' },
  perdido: { label: 'Perdido', color: '#6b7280' },
}
