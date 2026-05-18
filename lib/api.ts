/**
 * Helper centralizado para chamadas às Supabase Edge Functions.
 * Garante que os headers `apikey` e `Authorization` estejam SEMPRE presentes.
 *
 * Uso:
 *   import { efCall, efHeaders } from '@/lib/api'
 *
 *   // Forma simples (com session_token automático):
 *   const data = await efCall('login', { username, password, role })
 *
 *   // Se precisar dos headers pra montar a request manualmente:
 *   fetch(url, { method: 'POST', headers: efHeaders(), body: ... })
 */
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'

/** Headers padrão para qualquer chamada a Edge Functions */
export function efHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': ANON,
    'Authorization': `Bearer ${ANON}`,
  }
}

/**
 * Chama uma Supabase Edge Function pelo nome.
 * Adiciona session_token automaticamente se o usuário estiver logado.
 *
 * @param fn - Nome da Edge Function (ex: 'login', 'crm-manage-pipeline')
 * @param body - Payload da request (session_token é adicionado automaticamente se existir)
 * @param options - { skipSession: true } para NÃO incluir session_token (ex: login)
 */
export async function efCall(
  fn: string,
  body: Record<string, unknown> = {},
  options?: { skipSession?: boolean; silent?: boolean }
): Promise<Record<string, unknown>> {
  const payload = { ...body }

  if (!options?.skipSession) {
    const session = getSession()
    if (session?.session && !payload.session_token) {
      payload.session_token = session.session
    }
  }

  try {
    const res = await fetch(`${SURL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify(payload),
    })
    return await res.json()
  } catch (e) {
    if (!options?.silent) {
      console.error(`[efCall:${fn}]`, e)
    }
    return { error: 'Erro de conexão.' }
  }
}

// ── efCallCached ─────────────────────────────────────────────────────────────
// Versão cacheada de efCall. Adiciona cache em memória + localStorage com TTL.
// Usar para reads idempotentes (history, snapshots, list, etc).
// NÃO usar para writes/mutações (delete, update, save, etc).
//
// Cache key: 'ef:{fn}:{stable_json(body)}'. session_token NÃO entra na key
// porque é injetado depois — chave estável entre sessões diferentes do mesmo
// usuário evitaria misses em F5. Em troca, gestor A vê cache de gestor B se
// abrirem o mesmo dashboard. ACEITÁVEL pra dados de cliente compartilhados.

interface EfCacheEntry {
  data: Record<string, unknown>
  expiresAt: number
}

const EF_CACHE_TTL_MS = 30 * 60 * 1000
const EF_CACHE_PREFIX = 'ngp_ef_'
const efMemCache = new Map<string, EfCacheEntry>()
const efInflight = new Map<string, Promise<Record<string, unknown>>>()

function efBuildKey(fn: string, body: Record<string, unknown>): string {
  // Remove session_token da chave (varia por usuário, mesma resposta).
  const stable = { ...body }
  delete stable.session_token
  // Ordena keys pra produzir hash estável.
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(stable).sort()) sorted[k] = stable[k]
  return `ef:${fn}:${JSON.stringify(sorted)}`
}

function efReadLS(key: string): EfCacheEntry | null {
  try {
    const raw = localStorage.getItem(EF_CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as EfCacheEntry
    if (!parsed || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(EF_CACHE_PREFIX + key)
      return null
    }
    return parsed
  } catch { return null }
}

function efWriteLS(key: string, entry: EfCacheEntry): void {
  try { localStorage.setItem(EF_CACHE_PREFIX + key, JSON.stringify(entry)) } catch { /* quota */ }
}

export async function efCallCached(
  fn: string,
  body: Record<string, unknown> = {},
  options?: {
    skipSession?: boolean
    silent?: boolean
    ttlMs?: number
    bypass?: boolean
    persist?: boolean
  }
): Promise<Record<string, unknown>> {
  const { ttlMs = EF_CACHE_TTL_MS, bypass = false, persist = true } = options || {}
  const key = efBuildKey(fn, body)

  if (!bypass) {
    const mem = efMemCache.get(key)
    if (mem && mem.expiresAt > Date.now()) return mem.data
    if (persist && typeof window !== 'undefined') {
      const ls = efReadLS(key)
      if (ls && ls.expiresAt > Date.now()) {
        efMemCache.set(key, ls)
        return ls.data
      }
    }
    const inFlight = efInflight.get(key)
    if (inFlight) return inFlight
  }

  const promise = efCall(fn, body, options)
  efInflight.set(key, promise)
  try {
    const data = await promise
    // Não cacheia erro
    if (!data || data.error) return data
    const entry: EfCacheEntry = { data, expiresAt: Date.now() + ttlMs }
    efMemCache.set(key, entry)
    if (persist && typeof window !== 'undefined') efWriteLS(key, entry)
    return data
  } finally {
    efInflight.delete(key)
  }
}

/**
 * Invalida cache do efCall por prefix de fn (ex: invalidateEfCache('ai-generate-analysis')).
 */
export function invalidateEfCache(fnPrefix?: string): void {
  const prefix = fnPrefix ? `ef:${fnPrefix}` : 'ef:'
  for (const k of efMemCache.keys()) {
    if (k.startsWith(prefix)) efMemCache.delete(k)
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    const lsPrefix = EF_CACHE_PREFIX + prefix
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(EF_CACHE_PREFIX) && k.includes(prefix)) {
        localStorage.removeItem(k)
      }
    }
  }
}
