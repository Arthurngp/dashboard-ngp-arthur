import { efCall } from '@/lib/api'
import { getCopilotClient } from './client'
import type {
  CopilotConversation,
  CopilotMessage,
  ClientMemoryProfile,
  ClientTimelineEvent,
  AgentPlan,
  DailyLearningDocument,
  CopilotChatResponse,
  PendingAsset,
} from './types'

// ============================================================================
// RESOLUÇÃO DE IDs
// O front trabalha com `usuarios.id` (vem de get-ngp-data, role='cliente').
// As tabelas do Copilot referenciam `clientes.id`. Esta helper traduz.
// Cacheado em memória pra evitar query a cada render.
// ============================================================================
const clienteIdCache = new Map<string, string>()

export async function resolveClienteId(idFromFront: string): Promise<string | null> {
  if (!idFromFront) return null
  const cached = clienteIdCache.get(idFromFront)
  if (cached) return cached

  const sb = getCopilotClient()
  const { data, error } = await sb.rpc('resolve_cliente_id', { p_input: idFromFront })
  if (error) return null
  if (typeof data === 'string' && data) {
    clienteIdCache.set(idFromFront, data)
    return data
  }
  return null
}

// ============================================================================
// CHAT (via edge function copilot-chat)
// ============================================================================

export async function sendCopilotMessage(params: {
  client_id: string
  message: string
  client_generated_id?: string
  model?: string
  pending_asset?: PendingAsset
}): Promise<CopilotChatResponse> {
  const res = await efCall('copilot-chat', params) as unknown as CopilotChatResponse & { error?: string }
  if ('error' in res && res.error) throw new Error(res.error)
  return res
}

// ============================================================================
// LEITURA DIRETA (via Supabase JS + RLS)
// ============================================================================

export async function getConversationByClient(clientId: string): Promise<CopilotConversation | null> {
  const sb = getCopilotClient()
  const { data, error } = await sb
    .from('copilot_conversations')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function listMessages(conversationId: string, limit = 100): Promise<CopilotMessage[]> {
  const sb = getCopilotClient()
  const { data, error } = await sb
    .from('copilot_messages')
    .select('*, autor:autor_usuario_id(nome, foto_url)')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data || []).map((m: { autor?: { nome?: string } } & CopilotMessage) => ({
    ...m,
    autor_nome: m.autor?.nome ?? null,
  })) as CopilotMessage[]
}

export async function getProfile(clientId: string): Promise<ClientMemoryProfile | null> {
  const sb = getCopilotClient()
  const { data, error } = await sb
    .from('client_memory_profiles')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function updateProfile(
  clientId: string,
  patch: Partial<Omit<ClientMemoryProfile, 'id' | 'client_id' | 'created_at' | 'updated_at'>>,
  options?: { motivador?: string }
): Promise<ClientMemoryProfile> {
  const sb = getCopilotClient()
  const before = await getProfile(clientId)
  let result: ClientMemoryProfile
  if (before) {
    const { data, error } = await sb
      .from('client_memory_profiles').update(patch).eq('client_id', clientId).select('*').single()
    if (error) throw new Error(error.message)
    result = data
  } else {
    const { data, error } = await sb
      .from('client_memory_profiles').insert({ client_id: clientId, ...patch }).select('*').single()
    if (error) throw new Error(error.message)
    result = data
  }

  // Log de edição manual na timeline (audit trail — PRD 8.6.1)
  // Captura diff: apenas campos que de fato mudaram
  const beforeRec = before as unknown as Record<string, unknown> | null
  const patchRec = patch as unknown as Record<string, unknown>
  const changedFields = Object.keys(patch).filter((k) => {
    const beforeVal = beforeRec ? beforeRec[k] : undefined
    const afterVal = patchRec[k]
    return JSON.stringify(beforeVal) !== JSON.stringify(afterVal)
  })

  if (changedFields.length > 0) {
    await sb.from('client_timeline_events').insert({
      client_id: clientId,
      event_type: 'manual_profile_edit',
      title: `Edição manual: ${changedFields.join(', ')}`,
      description: options?.motivador || null,
      motivador: options?.motivador || null,
      reference_table: 'client_memory_profiles',
      reference_id: result.id,
      created_by_agent: false,
    })
  }

  return result
}

export async function listTimeline(clientId: string, limit = 50): Promise<ClientTimelineEvent[]> {
  const sb = getCopilotClient()
  const { data, error } = await sb
    .from('client_timeline_events')
    .select('*')
    .eq('client_id', clientId)
    .order('event_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

export async function listPendingPlans(clientId?: string, limit = 50): Promise<AgentPlan[]> {
  const sb = getCopilotClient()
  let q = sb
    .from('agent_plans')
    .select('*')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function decidePlan(
  planId: string,
  decision: 'approved' | 'rejected',
  note?: string
): Promise<void> {
  const sb = getCopilotClient()
  const { error } = await sb
    .from('agent_plans')
    .update({ status: decision, decision_note: note ?? null, decided_at: new Date().toISOString() })
    .eq('id', planId)
  if (error) throw new Error(error.message)
}

export async function applyMemoryPlan(planId: string): Promise<string | null> {
  // Esse RPC só pode ser chamado por service_role, então passamos via edge function.
  // Por ora, depois de aprovar manualmente, criamos uma edge function de apply.
  // MVP: usuário aprova e edge function de apply roda. Caminho temporário:
  // chamamos copilot-apply-plan que é uma function thin que valida sessão e chama o RPC.
  const res = await efCall('copilot-apply-plan', { plan_id: planId }) as { event_id?: string; error?: string }
  if (res.error) throw new Error(res.error)
  return res.event_id ?? null
}

export async function listDailyDocuments(clientId: string, limit = 30): Promise<DailyLearningDocument[]> {
  const sb = getCopilotClient()
  const { data, error } = await sb
    .from('daily_learning_documents')
    .select('*')
    .eq('client_id', clientId)
    .order('document_date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

// ============================================================================
// CRON DISPARÁVEIS (chamadas manuais via edge function)
// ============================================================================

export async function generateDailySummary(clientId: string, date?: string) {
  return efCall('copilot-daily-summarizer', { client_id: clientId, document_date: date })
}

export async function compactProfile(clientId: string, windowDays = 14) {
  return efCall('copilot-profile-compactor', { client_id: clientId, window_days: windowDays })
}

export async function ingestAsset(assetId: string) {
  return efCall('copilot-asset-ingest', { asset_id: assetId })
}
