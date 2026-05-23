// ─── Validação de API tokens (api_tokens / scopes) ────────────────────────────
// Tokens vêm no header `x-ngp-api-token` (preferido) ou `Authorization: Bearer`.
// Hash do token (SHA-256) é gravado em api_tokens.token_hash. Texto plano nunca
// é armazenado.

export const TOKEN_PREFIX_LENGTH = 16

export type ApiTokenRecord = {
  id: string
  name: string
  scopes: string[]
}

export type ApiAuthError =
  | 'missing_token'
  | 'invalid_token'
  | 'expired_token'
  | 'auth_db_error'

export interface ApiAuthResult {
  ok: boolean
  token?: ApiTokenRecord
  error?: ApiAuthError
}

export const AUTH_ERROR_MESSAGES: Record<ApiAuthError, string> = {
  missing_token: 'Header de autenticação ausente. Use x-ngp-api-token: ngp_live_... ou Authorization: Bearer ngp_live_...',
  invalid_token: 'API token inválido ou revogado.',
  expired_token: 'API token expirado.',
  auth_db_error: 'Erro ao validar token (banco).',
}

export const AUTH_ERROR_STATUS: Record<ApiAuthError, number> = {
  missing_token: 401,
  invalid_token: 401,
  expired_token: 401,
  auth_db_error: 500,
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function getApiTokenFromRequest(req: Request): string | null {
  const customHeader = req.headers.get('x-ngp-api-token')?.trim()
  if (customHeader) return customHeader

  const authorization = req.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH)
}

export function hasScope(token: ApiTokenRecord, scope: string): boolean {
  return token.scopes.includes(scope) || token.scopes.includes('*')
}

/**
 * Valida um API token presente no request. Retorna `ApiAuthResult` discriminado
 * para que o caller possa devolver mensagem e status apropriados a cada cenário
 * (header ausente, token desconhecido, expirado, falha de banco).
 *
 * Side effect: em caso de sucesso, dispara UPDATE fire-and-forget de
 * `last_used_at`/`last_used_ip`. Não bloqueia a request — em alto volume o
 * UPDATE síncrono seria gargalo no Postgres.
 */
export async function authenticateApiToken(sb: any, req: Request): Promise<ApiAuthResult> {
  const token = getApiTokenFromRequest(req)
  if (!token) return { ok: false, error: 'missing_token' }

  const prefix = tokenPrefix(token)
  const hash = await sha256Hex(token)
  const { data, error } = await sb
    .from('api_tokens')
    .select('id,name,scopes,expires_at')
    .eq('token_prefix', prefix)
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    console.error('[api_tokens:auth_db_error]', error)
    return { ok: false, error: 'auth_db_error' }
  }
  if (!data?.id) return { ok: false, error: 'invalid_token' }
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'expired_token' }
  }

  // Fire-and-forget — atualizar last_used_at não bloqueia a request.
  const now = new Date().toISOString()
  const forwardedFor = req.headers.get('x-forwarded-for') || ''
  const ip = forwardedFor.split(',')[0]?.trim() || null
  sb.from('api_tokens')
    .update({ last_used_at: now, last_used_ip: ip })
    .eq('id', data.id)
    .then((res: { error?: { message: string } }) => {
      if (res.error) console.warn('[api_tokens:last_used_update]', res.error.message)
    })
    .catch((e: unknown) => console.warn('[api_tokens:last_used_update]', e))

  return {
    ok: true,
    token: {
      id: data.id,
      name: data.name,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
    },
  }
}

/**
 * Wrapper legado para retrocompatibilidade. Novos endpoints devem usar
 * `authenticateApiToken` diretamente para diferenciar os tipos de erro.
 *
 * @deprecated use authenticateApiToken
 */
export async function validateApiToken(sb: any, req: Request): Promise<ApiTokenRecord | null> {
  const result = await authenticateApiToken(sb, req)
  return result.ok ? result.token! : null
}
