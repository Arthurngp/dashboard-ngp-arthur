import { getTeamChatClient } from './client'

let cached: { token: string; usuarioId: string } | null = null

/**
 * Resolve o UUID do usuário atual via RPC no Postgres.
 * `session.user` no localStorage guarda o nome, não o UUID, então não dá pra
 * usar direto. A RPC `current_ngp_user_id()` já existe (criada em migration
 * anterior) e lê do header `x-session-token` que o client envia.
 *
 * Resultado é cacheado em memória por token de sessão.
 */
export async function resolveCurrentUsuarioId(sessionToken: string | null): Promise<string | null> {
  if (!sessionToken) return null
  if (cached && cached.token === sessionToken) return cached.usuarioId

  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('current_ngp_user_id')
  if (error || !data) return null

  cached = { token: sessionToken, usuarioId: data as string }
  return cached.usuarioId
}

export function clearCachedUsuarioId(): void {
  cached = null
}

let cachedAdminFlag: { token: string; isAdmin: boolean } | null = null

/** Retorna true se o usuário da sessão atual é admin do chat (`role='admin'` + @sejangp). */
export async function isCurrentUserAdmin(sessionToken: string | null): Promise<boolean> {
  if (!sessionToken) return false
  if (cachedAdminFlag && cachedAdminFlag.token === sessionToken) return cachedAdminFlag.isAdmin
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_is_admin')
  if (error) return false
  cachedAdminFlag = { token: sessionToken, isAdmin: !!data }
  return cachedAdminFlag.isAdmin
}
