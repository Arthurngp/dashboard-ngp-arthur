// Feedback API — endpoint público autenticado por API token (api_tokens / scopes).
//
// Pensado para um agente externo (ex.: OpenClaw) consultar bugs em aberto pela
// manhã e resolver autonomamente.
//
// Autenticação (escolha UM dos dois headers):
//   x-ngp-api-token: ngp_live_...
//   Authorization: Bearer ngp_live_...
//
// Escopos:
//   - feedback:read   → list / get
//   - feedback:update → update_status / answer
//
// Ações suportadas (campo "action" no body):
//   { action: "list",  status?: "novo"|"em_andamento"|"resolvido"|"descartado",
//     tipo?, prioridade?, limit? (≤200), since? (ISO date) }
//   { action: "get",   id: "<uuid>" }
//   { action: "update_status", id, status, resposta_admin? }
//   { action: "answer",        id, resposta_admin }
//
import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import {
  authenticateApiToken,
  AUTH_ERROR_MESSAGES,
  AUTH_ERROR_STATUS,
  hasScope,
} from "../_shared/api_tokens.ts"

const TIPOS       = new Set(['bug', 'erro', 'sugestao', 'duvida', 'outro'])
const PRIORIDADES = new Set(['baixa', 'media', 'alta', 'critica'])
const STATUSES    = new Set(['novo', 'em_andamento', 'resolvido', 'descartado'])

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as Record<string, unknown>
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e))
}

async function audit(
  sb: any,
  tokenId: string,
  req: Request,
  action: string,
  status: string,
  requestPayload: unknown,
  responsePayload: unknown,
) {
  const forwardedFor = req.headers.get('x-forwarded-for') || ''
  const { error } = await sb.from('api_token_audit_logs').insert({
    api_token_id: tokenId,
    action,
    status,
    request_payload: requestPayload ?? {},
    response_payload: responsePayload ?? {},
    ip_address: forwardedFor.split(',')[0]?.trim() || null,
    user_agent: req.headers.get('user-agent'),
  })
  if (error) throw error
}

async function safeAudit(
  sb: any,
  tokenId: string,
  req: Request,
  action: string,
  status: string,
  requestPayload: unknown,
  responsePayload: unknown,
) {
  try {
    await audit(sb, tokenId, req, action, status, requestPayload, responsePayload)
  } catch (e) {
    console.error('[feedback-api:audit]', e)
  }
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const SURL    = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb      = createClient(SURL, SERVICE)

    const auth = await authenticateApiToken(sb, req)
    if (!auth.ok) {
      const reason = auth.error!
      return json(req, { error: AUTH_ERROR_MESSAGES[reason], code: reason }, AUTH_ERROR_STATUS[reason])
    }
    const apiToken = auth.token!

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'list')

    // ─── leitura ──────────────────────────────────────────────────────────────
    if (action === 'list' || action === 'get') {
      if (!hasScope(apiToken, 'feedback:read')) {
        const response = { error: 'Token sem permissão feedback:read.' }
        await safeAudit(sb, apiToken.id, req, action, 'forbidden', body, response)
        return json(req, response, 403)
      }

      if (action === 'get') {
        const id = String(body?.id || '').trim()
        if (!id) {
          const response = { error: 'id é obrigatório.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 400)
        }
        const { data, error } = await sb
          .from('feedback')
          .select('id, created_at, updated_at, usuario_id, usuario_nome, usuario_role, usuario_foto, titulo, tipo, prioridade, mensagem, pagina_url, user_agent, screenshot_url, status, resposta_admin')
          .eq('id', id)
          .maybeSingle()
        if (error) {
          const response = { error: errMsg(error) }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 500)
        }
        if (!data) {
          const response = { error: 'Feedback não encontrado.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 404)
        }
        await safeAudit(sb, apiToken.id, req, action, 'success', body, { id })
        return json(req, { feedback: data })
      }

      // list
      const limitRaw = Number(body?.limit ?? 50)
      const limit    = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 200) : 50

      let query = sb
        .from('feedback')
        .select('id, created_at, updated_at, usuario_nome, usuario_role, titulo, tipo, prioridade, mensagem, pagina_url, screenshot_url, status, resposta_admin')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (body?.status && STATUSES.has(String(body.status))) {
        query = query.eq('status', String(body.status))
      }
      if (body?.tipo && TIPOS.has(String(body.tipo))) {
        query = query.eq('tipo', String(body.tipo))
      }
      if (body?.prioridade && PRIORIDADES.has(String(body.prioridade))) {
        query = query.eq('prioridade', String(body.prioridade))
      }
      if (typeof body?.since === 'string') {
        const d = new Date(body.since)
        if (!Number.isNaN(d.getTime())) query = query.gte('created_at', d.toISOString())
      }

      const { data, error } = await query
      if (error) {
        const response = { error: errMsg(error) }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }
      const count = data?.length ?? 0
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { count })
      return json(req, { feedbacks: data ?? [], count })
    }

    // ─── atualização ──────────────────────────────────────────────────────────
    if (action === 'update_status' || action === 'answer') {
      if (!hasScope(apiToken, 'feedback:update')) {
        const response = { error: 'Token sem permissão feedback:update.' }
        await safeAudit(sb, apiToken.id, req, action, 'forbidden', body, response)
        return json(req, response, 403)
      }

      const id = String(body?.id || '').trim()
      if (!id) {
        const response = { error: 'id é obrigatório.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 400)
      }

      const update: Record<string, unknown> = {}

      if (action === 'update_status') {
        const status = String(body?.status || '').trim()
        if (!STATUSES.has(status)) {
          const response = { error: 'status inválido.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 400)
        }
        update.status = status
        if (typeof body?.resposta_admin === 'string') update.resposta_admin = body.resposta_admin
      } else {
        // answer
        const resposta = String(body?.resposta_admin || '').trim()
        if (!resposta) {
          const response = { error: 'resposta_admin é obrigatória.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 400)
        }
        update.resposta_admin = resposta
      }

      // Snapshot do estado atual pra audit (before/after)
      const { data: before } = await sb
        .from('feedback')
        .select('id, status, resposta_admin, updated_at')
        .eq('id', id)
        .maybeSingle()

      const { data, error } = await sb
        .from('feedback')
        .update(update)
        .eq('id', id)
        .select('id, status, resposta_admin, updated_at')
        .maybeSingle()

      if (error) {
        const response = { error: errMsg(error) }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }
      if (!data) {
        const response = { error: 'Feedback não encontrado.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 404)
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { id, before, after: data })
      return json(req, { ok: true, feedback: data })
    }

    return json(req, { error: 'action inválida.' }, 400)
  } catch (e) {
    console.error('[feedback-api]', e)
    return json(req, { error: errMsg(e) }, 500)
  }
})
