// ── useApiCache ──────────────────────────────────────────────────────────────
// Hook React de cache em memória + localStorage. Sem dep externa (sem SWR/RQ).
//
// Por que próprio: SWR/React Query são ótimos mas trazem 30KB+ no bundle.
// Nosso uso é simples (cache key+fetcher+ttl, 1 hook por tela), então 50 linhas
// custom resolvem sem inflar build.
//
// Garantias:
//  - Cache em memória global (Map) sobrevive a unmount/remount do componente
//  - Persiste em localStorage opcional (sobrevive a F5)
//  - Refetch automático quando key muda (mudança de cliente/período)
//  - Refetch manual via .refresh()
//  - Deduplicação: 2 hooks com mesma key + sem cache → 1 só request
//
// Não-garantias:
//  - Não revalida em background (focus/visibility) — propositalmente
//    Você quer estabilidade durante navegação; revalidação automática gera tráfego
//    inútil. Refresh manual é o caminho.

import { useCallback, useEffect, useRef, useState } from 'react'

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

interface UseApiCacheOptions {
  ttlMs?: number              // default 30min
  persistInLocalStorage?: boolean  // default true pra dados que sobrevivem F5
  enabled?: boolean           // condicionalmente desabilita o fetch (default true)
}

interface UseApiCacheResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>   // bypass cache, força refetch
  isStale: boolean               // dado veio do cache (não fresh)
}

// Cache global em memória — Map sobrevive entre renders/instâncias do hook.
const memoryCache = new Map<string, CacheEntry<unknown>>()
// In-flight requests pra deduplicação (2 hooks com mesma key disparam 1 só fetch).
const inflight = new Map<string, Promise<unknown>>()

const DEFAULT_TTL_MS = 30 * 60 * 1000  // 30min

const LS_PREFIX = 'ngp_apicache_'

function readFromLocalStorage<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(LS_PREFIX + key)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeToLocalStorage<T>(key: string, entry: CacheEntry<T>): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Safari modo privado / quota cheia: ignora silenciosamente
  }
}

function isValid<T>(entry: CacheEntry<T> | undefined | null): entry is CacheEntry<T> {
  return !!entry && entry.expiresAt > Date.now()
}

/**
 * Hook principal. Aceita key string (ex: 'meta-overview:act_123:last_7d') e
 * fetcher. Faz cache em memória + localStorage. Refetch quando key muda.
 */
export function useApiCache<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseApiCacheOptions = {}
): UseApiCacheResult<T> {
  const { ttlMs = DEFAULT_TTL_MS, persistInLocalStorage = true, enabled = true } = options

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)
  const [isStale, setIsStale] = useState<boolean>(false)

  // Guarda fetcher mais recente em ref pra refresh() usar o atual sem
  // recriar callback (evita loops de useEffect).
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Lê do cache de forma síncrona quando possível (evita flash de loading)
  const tryReadCache = useCallback((k: string): T | null => {
    const mem = memoryCache.get(k)
    if (isValid(mem)) return mem.data as T
    if (persistInLocalStorage) {
      const ls = readFromLocalStorage<T>(k)
      if (isValid(ls)) {
        // Re-popula memória pra próximas leituras serem instantâneas
        memoryCache.set(k, ls)
        return ls.data
      }
    }
    return null
  }, [persistInLocalStorage])

  // Função interna de fetch. Resolve dedup via inflight Map.
  const doFetch = useCallback(async (k: string, bypass: boolean): Promise<void> => {
    if (!bypass) {
      const cached = tryReadCache(k)
      if (cached !== null) {
        setData(cached)
        setIsStale(true)
        setLoading(false)
        setError(null)
        return
      }
    }

    // Dedup: outro hook já está buscando esta key?
    const existing = inflight.get(k)
    if (existing && !bypass) {
      setLoading(true)
      try {
        const result = await existing as T
        setData(result)
        setIsStale(false)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(true)
    setError(null)

    const promise = fetcherRef.current()
    inflight.set(k, promise)

    try {
      const result = await promise
      const entry: CacheEntry<T> = { data: result, expiresAt: Date.now() + ttlMs }
      memoryCache.set(k, entry)
      if (persistInLocalStorage) writeToLocalStorage(k, entry)
      setData(result)
      setIsStale(false)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setLoading(false)
      inflight.delete(k)
    }
  }, [ttlMs, persistInLocalStorage, tryReadCache])

  // Trigger inicial e quando key muda
  useEffect(() => {
    if (!key || !enabled) return
    void doFetch(key, false)
  }, [key, enabled, doFetch])

  const refresh = useCallback(async () => {
    if (!key) return
    await doFetch(key, true)
  }, [key, doFetch])

  return { data, loading, error, refresh, isStale }
}

/**
 * Invalida entradas de cache no client. Útil quando o gestor faz uma ação
 * que sabidamente muda os dados (editar cliente, adicionar conta, etc).
 *
 * Aceita prefix → invalida tudo que começa com ele.
 */
export function invalidateCache(keyPrefix: string): void {
  for (const k of memoryCache.keys()) {
    if (k.startsWith(keyPrefix)) memoryCache.delete(k)
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    const lsPrefix = LS_PREFIX + keyPrefix
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(lsPrefix)) localStorage.removeItem(k)
    }
  }
}

/**
 * Limpa tudo (logout, troca de usuário). Memória + localStorage.
 */
export function clearAllCache(): void {
  memoryCache.clear()
  if (typeof window !== 'undefined' && window.localStorage) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k)
    }
  }
}
