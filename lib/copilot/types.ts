export type CopilotMessageRole = 'user' | 'agent' | 'system'

export type CopilotMessageKind =
  | 'text'
  | 'text_file'
  | 'file'
  | 'agent_proposal'
  | 'agent_analysis'
  | 'agent_alert'
  | 'agent_checklist'
  | 'memory_update'

export interface CopilotConversation {
  id: string
  client_id: string
  titulo: string
  arquivado_em: string | null
  created_at: string
  updated_at: string
}

export interface CopilotMessage {
  id: string
  conversation_id: string
  client_id: string
  role: CopilotMessageRole
  kind: CopilotMessageKind
  texto: string | null
  payload_json: Record<string, unknown> | null
  autor_usuario_id: string | null
  autor_nome?: string | null
  agent_model: string | null
  agent_run_id: string | null
  client_generated_id: string | null
  reply_to_message_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ClientMemoryProfile {
  id: string
  client_id: string
  executive_summary: string | null
  service_scope: string | null
  business_context: string | null
  offer_context: string | null
  icp_context: string | null
  channel_notes: Record<string, string | null>
  operational_rules: string | null
  risks: string | null
  // Campos expandidos (2026-05-15)
  brand_positioning: string | null
  creative_learnings: string | null
  content_strategy: string | null
  wins: string | null
  losses: string | null
  competition_notes: string | null
  team_and_process: string | null
  key_metrics: string | null
  last_compacted_at: string | null
  last_compacted_by: string | null
  created_at: string
  updated_at: string
}

export interface ClientTimelineEvent {
  id: string
  client_id: string
  event_type: string
  title: string
  description: string | null
  motivador: string | null
  resultado_esperado: string | null
  resultado_observado: string | null
  hypothesis_status: 'open' | 'confirmed' | 'rejected' | 'partial' | 'na'
  observed_at: string | null
  reference_table: string | null
  reference_id: string | null
  event_at: string
  created_by_usuario_id: string | null
  created_by_agent: boolean
  created_at: string
}

export interface AgentPlan {
  id: string
  client_id: string
  conversation_id: string | null
  source_message_id: string | null
  plan_type:
    | 'memory_update'
    | 'timeline_event'
    | 'playbook_change'
    | 'campaign_create'
    | 'campaign_change'
    | 'analysis_finding'
  impact_scope: 'soft' | 'hard'
  title: string
  reasoning_summary: string
  context_references: unknown[]
  proposal_json: { before?: unknown; after: Record<string, unknown>; source?: string }
  confidence: number
  needs_escalation: boolean
  escalation_reason: string | null
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'applied' | 'failed' | 'auto_applied'
  decision_note: string | null
  decided_by: string | null
  decided_at: string | null
  applied_at: string | null
  applied_error: string | null
  agent_model: string | null
  agent_run_id: string | null
  created_at: string
  updated_at: string
}

export interface DailyLearningDocument {
  id: string
  client_id: string
  document_date: string
  title: string
  summary_markdown: string
  status: 'generated' | 'reviewed' | 'archived'
  generated_by_model: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  is_editable: boolean
  stats_json: Record<string, number>
  created_at: string
  updated_at: string
}

export interface CopilotChatResponse {
  conversation_id: string
  message_id: string | null
  reply: string
  reply_kind: CopilotMessageKind
  memory_plan_id: string | null
  memory_auto_applied: boolean
  timeline_event_id: string | null
  attached_asset_id?: string | null
}

export interface PendingAsset {
  text: string
  asset_type?: 'transcript_reuniao' | 'planejamento_html' | 'planejamento_pdf' | 'outro'
  label?: string
}
