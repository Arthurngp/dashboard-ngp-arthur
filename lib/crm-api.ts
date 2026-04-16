import { efCall } from '@/lib/api'

export async function crmCall(fn: string, body: Record<string, unknown>): Promise<any> {
  return efCall(fn, body)
}

export interface CrmPipeline {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CrmStage {
  id: string
  pipeline_id: string
  name: string
  position: number
  color: string
  created_at: string
  updated_at: string
}

export interface CrmLead {
  id: string
  pipeline_id: string
  stage_id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  estimated_value: number
  status: string
  position: number
  notes: string | null
  source: string | null
  custom_data?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface CrmPipelineField {
  id: string
  pipeline_id: string
  name: string
  type: string
  options: string[]
  position: number
  created_at: string
}

// ─── Activity Timeline ────────────────────────────────────────────────────────

export interface CrmActivity {
  id: string
  lead_id: string
  activity_type: string
  title: string
  description: string | null
  metadata: Record<string, any>
  created_by: string | null
  created_by_name: string | null
  created_at: string
  duration_minutes: number | null
}

export const ACTIVITY_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  ligacao:              { label: 'Ligação',             icon: '📞', color: '#3b82f6' },
  email:               { label: 'E-mail',              icon: '✉️', color: '#8b5cf6' },
  reuniao:             { label: 'Reunião',             icon: '🤝', color: '#f59e0b' },
  whatsapp:            { label: 'WhatsApp',            icon: '💬', color: '#22c55e' },
  visita:              { label: 'Visita',              icon: '🏢', color: '#ec4899' },
  nota_interna:        { label: 'Nota Interna',        icon: '📝', color: '#64748b' },
  mudanca_etapa:       { label: 'Mudança de Etapa',    icon: '🔄', color: '#0ea5e9' },
  mudanca_responsavel: { label: 'Mudança de Dono',     icon: '👤', color: '#6366f1' },
  edicao_campo:        { label: 'Edição de Campo',     icon: '✏️', color: '#94a3b8' },
  criacao_lead:        { label: 'Lead Criado',         icon: '🆕', color: '#10b981' },
}

// ─── Tasks / Follow-ups ──────────────────────────────────────────────────────

export interface CrmTask {
  id: string
  lead_id: string
  title: string
  description: string | null
  task_type: string
  due_date: string
  due_time: string | null
  status: string
  completed_at: string | null
  assigned_to: string | null
  assigned_to_name: string | null
  created_by: string | null
  created_by_name: string | null
  priority: string
  created_at: string
  updated_at: string
  // Joined from lead (used in list_user / list_team)
  lead_company_name?: string
  lead_stage_id?: string
}

export const TASK_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  ligar:           { label: 'Ligar',             icon: '📞' },
  enviar_email:    { label: 'Enviar E-mail',     icon: '✉️' },
  enviar_whatsapp: { label: 'Enviar WhatsApp',   icon: '💬' },
  agendar_reuniao: { label: 'Agendar Reunião',   icon: '📅' },
  enviar_proposta: { label: 'Enviar Proposta',   icon: '📄' },
  follow_up:       { label: 'Follow-up',         icon: '🔁' },
  outro:           { label: 'Outro',             icon: '📌' },
}

export const TASK_PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  baixa:   { label: 'Baixa',   color: '#94a3b8' },
  normal:  { label: 'Normal',  color: '#3b82f6' },
  alta:    { label: 'Alta',    color: '#f59e0b' },
  urgente: { label: 'Urgente', color: '#ef4444' },
}
