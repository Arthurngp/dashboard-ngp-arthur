// Feedback API — endpoint público autenticado por API token (api_tokens / scopes).
//
// Pensado para um agente externo (ex.: OpenClaw) consultar bugs em aberto pela
// manhã e resolver autonomamente.
//
// Autenticação: header Authorization: Bearer ngp_live_... ou X-NGP-Api-Token.
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { hasScope, validateApiToken } from '../_shared/api_tokens.ts'

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

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const SURL    = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb      = createClient(SURL, SERVICE)

    const apiToken = await validateApiToken(sb, req)
    if (!apiToken) return json(req, { error: 'Token inválido ou expirado.' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'list')

    // ─── leitura ──────────────────────────────────────────────────────────────
    if (action === 'list' || action === 'get') {
      if (!hasScope(apiToken, 'feedback:read')) {
        return json(req, { error: 'Token sem permissão feedback:read.' }, 403)
      }

      if (action === 'get') {
        const id = String(body?.id || '').trim()
        if (!id) return json(req, { error: 'id é obrigatório.' }, 400)
        const { data, error } = await sb
          .from('feedback')
          .select('id, created_at, updated_at, usuario_id, usuario_nome, usuario_role, usuario_foto, titulo, tipo, prioridade, mensagem, pagina_url, user_agent, screenshot_url, status, resposta_admin')
          .eq('id', id)
          .maybeSingle()
        if (error) return json(req, { error: errMsg(error) }, 500)
        if (!data)  return json(req, { error: 'Feedback não encontrado.' }, 404)
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
      if (error) return json(req, { error: errMsg(error) }, 500)
      return json(req, { feedbacks: data ?? [], count: data?.length ?? 0 })
    }

    // ─── atualização ──────────────────────────────────────────────────────────
    if (action === 'update_status' || action === 'answer') {
      if (!hasScope(apiToken, 'feedback:update')) {
        return json(req, { error: 'Token sem permissão feedback:update.' }, 403)
      }

      const id = String(body?.id || '').trim()
      if (!id) return json(req, { error: 'id é obrigatório.' }, 400)

      const update: Record<string, unknown> = {}

      if (action === 'update_status') {
        const status = String(body?.status || '').trim()
        if (!STATUSES.has(status)) return json(req, { error: 'status inválido.' }, 400)
        update.status = status
        if (typeof body?.resposta_admin === 'string') update.resposta_admin = body.resposta_admin
      } else {
        // answer
        const resposta = String(body?.resposta_admin || '').trim()
        if (!resposta) return json(req, { error: 'resposta_admin é obrigatória.' }, 400)
        update.resposta_admin = resposta
      }

      const { data, error } = await sb
        .from('feedback')
        .update(update)
        .eq('id', id)
        .select('id, status, resposta_admin, updated_at')
        .maybeSingle()

      if (error) return json(req, { error: errMsg(error) }, 500)
      if (!data)  return json(req, { error: 'Feedback não encontrado.' }, 404)
      return json(req, { ok: true, feedback: data })
    }

    return json(req, { error: 'action inválida.' }, 400)
  } catch (e) {
    console.error('[feedback-api]', e)
    return json(req, { error: errMsg(e) }, 500)
  }
})
