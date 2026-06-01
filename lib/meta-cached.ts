// ── meta-cached.ts ───────────────────────────────────────────────────────────
// Wrapper de cache sobre metaCall(). Mesma interface, mas:
//   1. Lê do cache em memória + localStorage antes do fetch
//   2. Dedup: 2 chamadas idênticas em paralelo → 1 só request real
//   3. TTL configurável (default 30min)
//   4. bypass=true pra forçar refresh (botão "↻ Atualizar")
//
// Uso típico:
//   import { metaCallCached } from '@/lib/meta-cached'
//   const data = await metaCallCached('insights', { ... }, accountId)
//   // Próxima chamada idêntica em <30min retorna do cache (instantâneo)
//
// Quando NÃO usar cache:
//   - Mutações (write): metaCall direto, sem cache
//   - Dados que mudam em tempo real (saldo de conta, status pause/active): bypass=true sempre

import { metaCall } from './meta'

interface CacheEntry<T> {
  data: T
  cachedAt: number
  expiresAt: number
}

const memCache = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

// Decisão registrada em [[01-Arquitetura/ADR-001-cache-ttl-metricas-operacionais]]:
// TTL de métricas operacionais reduzido de 30min → 5min em 2026-05-23. Combinado
// com componente <MetricsFreshness> (timestamp + refresh visível) pra dar
// transparência ao usuário sobre frescura do dado.
const DEFAULT_TTL_MS = 5 * 60 * 1000
const LS_PREFIX = 'ngp_meta_'

function buildKey(endpoint: string, params: Record<string, string>, accountId?: string | null): string {
  const sortedParams = Object.keys(params || {})
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return `${accountId || 'noacct'}:${endpoint}:${sortedParams}`
}

function readLS<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(LS_PREFIX + key)
      return null
    }
    // Entradas antigas (anteriores ao ADR-001) podem não ter cachedAt — preenche
    // com expiresAt - TTL pra evitar NaN em consumidores.
    if (typeof parsed.cachedAt !== 'number') {
      parsed.cachedAt = parsed.expiresAt - DEFAULT_TTL_MS
    }
    return parsed
  } catch { return null }
}

function writeLS<T>(key: string, entry: CacheEntry<T>): void {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry)) } catch { /* quota cheia, ignora */ }
}

interface CallOptions {
  ttlMs?: number
  bypass?: boolean
  persist?: boolean   // default true
}

export async function metaCallCached(
  endpoint: string,
  params: Record<string, string> = {},
  accountId?: string | null,
  options: CallOptions = {}
): Promise<unknown> {
  const { ttlMs = DEFAULT_TTL_MS, bypass = false, persist = true } = options
  const key = buildKey(endpoint, params, accountId)

  if (!bypass) {
    // Memória
    const mem = memCache.get(key)
    if (mem && mem.expiresAt > Date.now()) return mem.data
    // LocalStorage
    if (persist && typeof window !== 'undefined') {
      const ls = readLS(key)
      if (ls && ls.expiresAt > Date.now()) {
        memCache.set(key, ls)
        return ls.data
      }
    }
    // Dedup: alguém já está buscando essa key?
    const existing = inflight.get(key)
    if (existing) return existing
  }

  // Miss (ou bypass): chama API real
  const promise = metaCall(endpoint, params, accountId)
  inflight.set(key, promise)

  try {
    const data = await promise
    const now = Date.now()
    const entry: CacheEntry<unknown> = { data, cachedAt: now, expiresAt: now + ttlMs }
    memCache.set(key, entry)
    if (persist && typeof window !== 'undefined') writeLS(key, entry)
    return data
  } finally {
    inflight.delete(key)
  }
}

/**
 * Invalida cache do Meta por accountId. Útil quando o gestor edita meta_account_id
 * ou atualiza algo do cliente.
 */
export function invalidateMetaCache(accountId?: string): void {
  const prefix = accountId ? `${accountId}:` : ''
  // Memória
  for (const k of memCache.keys()) {
    if (!accountId || k.startsWith(prefix)) memCache.delete(k)
  }
  // localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    const lsPrefix = LS_PREFIX + prefix
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LS_PREFIX) && (!accountId || k.startsWith(lsPrefix))) {
        localStorage.removeItem(k)
      }
    }
  }
}

/**
 * Limpa tudo. Usar em logout/troca de usuário.
 */
export function clearMetaCache(): void {
  memCache.clear()
  if (typeof window !== 'undefined' && window.localStorage) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k)
    }
  }
}
