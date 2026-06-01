// @ts-nocheck
// ============================================================================
// NGP Copilot — aplicar um agent_plan aprovado
//
// Entrada: { session_token, plan_id, decision_note? }
//
// Pra memory_update: marca approved + chama RPC copilot_apply_memory_update.
// Pra outros tipos (timeline_event, playbook_change, etc): só marca approved
// e deixa pra UI / outras funções resolverem (não implementado no MVP).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'
import { corsHeaders } from '../_shared/cors.ts'

function handleCors(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  return null
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  try {
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
    const body = await req.json().catch(() => ({}))
    const { session_token, plan_id, decision_note } = body || {}
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!plan_id) return json(req, { error: 'plan_id obrigatório.' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (user.role !== 'admin' && user.role !== 'ngp') return json(req, { error: 'Apenas equipe NGP.' }, 403)

    const { data: plan, error: planErr } = await sb.from('agent_plans').select('*').eq('id', plan_id).single()
    if (planErr || !plan) return json(req, { error: 'Plan não encontrado.' }, 404)
    if (plan.status === 'applied' || plan.status === 'auto_applied') {
      return json(req, { status: 'already_applied', plan_id })
    }
    if (plan.status === 'rejected' || plan.status === 'failed') {
      return json(req, { error: `Plan está ${plan.status}, não pode aplicar.` }, 409)
    }

    // Marca approved + decided_by primeiro
    const { error: updErr } = await sb.from('agent_plans').update({
      status: 'approved',
      decision_note: decision_note ?? null,
      decided_by: user.usuario_id,
      decided_at: new Date().toISOString(),
    }).eq('id', plan_id)
    if (updErr) return json(req, { error: `Falha ao aprovar: ${updErr.message}` }, 500)

    // Pra memory_update, chama o RPC que aplica de fato
    if (plan.plan_type === 'memory_update') {
      const { data: eventId, error: rpcErr } = await sb.rpc('copilot_apply_memory_update', { plan_id })
      if (rpcErr) {
        // Marca failed pra deixar rastro
        await sb.from('agent_plans').update({
          status: 'failed',
          applied_error: rpcErr.message,
        }).eq('id', plan_id)
        return json(req, { error: `Falha ao aplicar: ${rpcErr.message}` }, 500)
      }
      return json(req, { status: 'applied', plan_id, event_id: eventId })
    }

    // Outros tipos: só marcamos approved no MVP
    return json(req, { status: 'approved', plan_id, note: 'Tipo não tem aplicação automática no MVP.' })
  } catch (e) {
    console.error('[copilot-apply-plan]', e?.message || e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
