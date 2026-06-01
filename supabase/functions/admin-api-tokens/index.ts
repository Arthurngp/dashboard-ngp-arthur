import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { isAdmin, validateSession } from "../_shared/roles.ts"
import { sha256Hex, tokenPrefix } from "../_shared/api_tokens.ts"
import { ALL_SCOPES } from "../_shared/api_scopes.ts"

const ALLOWED_EXPIRATION_DAYS = new Set([5, 15, 30, 60, 90, 180, 365])

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const secret = Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  return `ngp_live_${secret}`
}

function normalizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const scopes = value
    .map(scope => String(scope || '').trim())
    .filter(scope => ALL_SCOPES.includes(scope))
  return Array.from(new Set(scopes))
}

function resolveExpiresAt(value: unknown): string | null {
  if (value == null || value === '' || value === 'never') return null

  const days = Number(value)
  if (!Number.isInteger(days) || !ALLOWED_EXPIRATION_DAYS.has(days)) return '__invalid__'

  const expiresAt = new Date()
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days)
  return expiresAt.toISOString()
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action = 'listar', ...payload } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Acesso negado.' }, 403)

    if (action === 'listar') {
      const { data, error } = await sb
        .from('api_tokens')
        .select('id,name,token_prefix,scopes,created_at,last_used_at,last_used_ip,revoked_at,expires_at')
        .order('created_at', { ascending: false })

      if (error) return json(req, { error: 'Erro ao listar tokens.' }, 500)
      return json(req, { tokens: data ?? [], available_scopes: ALL_SCOPES })
    }

    if (action === 'criar') {
      const name = String(payload.name || '').trim()
      const scopes = normalizeScopes(payload.scopes)
      const expires_at = resolveExpiresAt(payload.expires_in_days)
      if (!name) return json(req, { error: 'Nome do token é obrigatório.' }, 400)
      if (!scopes.length) return json(req, { error: 'Selecione pelo menos uma permissão.' }, 400)
      if (expires_at === '__invalid__') return json(req, { error: 'Prazo de expiração inválido.' }, 400)

      const token = randomToken()
      const token_hash = await sha256Hex(token)
      const { data, error } = await sb
        .from('api_tokens')
        .insert({
          name,
          token_prefix: tokenPrefix(token),
          token_hash,
          scopes,
          expires_at,
          created_by: user.usuario_id,
        })
        .select('id,name,token_prefix,scopes,created_at,last_used_at,last_used_ip,revoked_at,expires_at')
        .single()

      if (error) {
        console.error('[admin-api-tokens:create]', error)
        return json(req, { error: `Erro ao criar token: ${error.message}` }, 500)
      }
      return json(req, { token, record: data })
    }

    if (action === 'revogar') {
      const id = String(payload.id || '').trim()
      if (!id) return json(req, { error: 'ID do token é obrigatório.' }, 400)

      const { error } = await sb
        .from('api_tokens')
        .update({ revoked_at: new Date().toISOString(), revoked_by: user.usuario_id })
        .eq('id', id)
        .is('revoked_at', null)

      if (error) return json(req, { error: 'Erro ao revogar token.' }, 500)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação inválida.' }, 400)
  } catch (e) {
    console.error('[admin-api-tokens]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
