export type ApiTokenRecord = {
  id: string
  name: string
  scopes: string[]
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
  return token.slice(0, 16)
}

export function hasScope(token: ApiTokenRecord, scope: string): boolean {
  return token.scopes.includes(scope) || token.scopes.includes('*')
}

export async function validateApiToken(sb: any, req: Request): Promise<ApiTokenRecord | null> {
  const token = getApiTokenFromRequest(req)
  if (!token) return null

  const prefix = tokenPrefix(token)
  const hash = await sha256Hex(token)
  const { data, error } = await sb
    .from('api_tokens')
    .select('id,name,scopes,expires_at')
    .eq('token_prefix', prefix)
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .maybeSingle()

  if (error || !data?.id) return null
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null

  const now = new Date().toISOString()
  const forwardedFor = req.headers.get('x-forwarded-for') || ''
  const ip = forwardedFor.split(',')[0]?.trim() || null
  await sb
    .from('api_tokens')
    .update({ last_used_at: now, last_used_ip: ip })
    .eq('id', data.id)

  return {
    id: data.id,
    name: data.name,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
  }
}
