// ── api_cache.ts ─────────────────────────────────────────────────────────────
// Helper compartilhado de cache entre edge functions. Lê/escreve na tabela
// public.api_cache via service_role. Sem dependência externa.
//
// Uso típico em qualquer edge:
//   import { withCache, buildCacheKey } from '../_shared/api_cache.ts'
//   const data = await withCache(sb, {
//     key: buildCacheKey('meta-insights', { accountId, period }),
//     ttlSeconds: 30 * 60,
//     endpoint: 'meta-insights',
//     fetcher: async () => callMetaApi(...)
//   })
//
// Decisão: KISS — sem layers de abstração além do necessário. Falha do cache
// (rede, timeout) NUNCA bloqueia o request original; cai pro fetcher direto.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any

interface WithCacheOptions<T> {
  key: string
  ttlSeconds: number
  endpoint: string       // pra telemetria (ex: 'meta-insights', 'google-campaigns')
  fetcher: () => Promise<T>
  // Quando true, ignora cache e força refresh. Usado quando gestor clica "↻ Atualizar".
  bypass?: boolean
}

/**
 * Constrói chave determinística a partir do endpoint + params.
 * Mesma chave SEMPRE produz mesmo hash. Ordenação alfabética dos params garante
 * que {a:1, b:2} e {b:2, a:1} virem a mesma chave.
 */
export function buildCacheKey(endpoint: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params).sort()
  const parts = sorted.map((k) => {
    const v = params[k]
    return `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
  })
  // Limita a 256 chars pra caber na PK. Em casos extremos, hash do excesso.
  let key = `${endpoint}:${parts.join('&')}`
  if (key.length > 256) {
    // Hash simples (djb2) dos últimos chars que não cabem. Suficiente pra
    // unicidade prática — colisões só ocorrem se mesmo prefixo + sufixos
    // diferentes hasheiam igual, improbabilíssimo.
    const excess = key.slice(240)
    let hash = 5381
    for (let i = 0; i < excess.length; i++) hash = ((hash << 5) + hash + excess.charCodeAt(i)) & 0xffffffff
    key = key.slice(0, 240) + ':h' + (hash >>> 0).toString(36)
  }
  return key
}

/**
 * Lê do cache. Retorna null se não encontrado, expirado, ou erro.
 * NUNCA throw — cache é otimização, não fonte de verdade.
 */
async function readCache<T>(sb: SupabaseClient, key: string): Promise<T | null> {
  try {
    const { data, error } = await sb
      .from('api_cache')
      .select('payload, expires_at')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (error || !data) return null
    return data.payload as T
  } catch (e) {
    console.warn('[api_cache] readCache falhou (segue sem cache):', (e as Error).message)
    return null
  }
}

/**
 * Grava no cache. UPSERT com base no cache_key (PK). Atualiza payload + expires_at.
 * Falha silenciosa: erro de escrita não invalida o request original.
 */
async function writeCache<T>(sb: SupabaseClient, key: string, payload: T, ttlSeconds: number): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
    await sb.from('api_cache').upsert({
      cache_key: key,
      payload: payload as unknown as Record<string, unknown>,
      expires_at: expiresAt,
    })
  } catch (e) {
    console.warn('[api_cache] writeCache falhou:', (e as Error).message)
  }
}

/**
 * Registra hit/miss em cache_stats. Fire-and-forget (await opcional).
 */
async function recordStat(sb: SupabaseClient, endpoint: string, hit: boolean, payloadBytes?: number): Promise<void> {
  try {
    await sb.rpc('cache_stats_record', {
      p_endpoint: endpoint,
      p_hit: hit,
      p_payload_bytes: payloadBytes ?? null,
    })
  } catch {
    // ignora — stats não são críticos
  }
}

/**
 * Wrapper principal. Tenta ler do cache; se miss, chama fetcher e armazena.
 * Se cache falhar, vai direto pro fetcher (degradação graciosa).
 */
export async function withCache<T>(sb: SupabaseClient, opts: WithCacheOptions<T>): Promise<T> {
  const { key, ttlSeconds, endpoint, fetcher, bypass } = opts

  if (!bypass) {
    const cached = await readCache<T>(sb, key)
    if (cached !== null) {
      // Hit: registra e devolve
      recordStat(sb, endpoint, true).catch(() => {})
      return cached
    }
  }

  // Miss (ou bypass): chama fetcher
  const fresh = await fetcher()

  // Grava cache + stats em paralelo, sem aguardar (não atrasa response)
  const bytes = typeof fresh === 'string' ? fresh.length :
                fresh ? JSON.stringify(fresh).length : 0
  writeCache(sb, key, fresh, ttlSeconds).catch(() => {})
  recordStat(sb, endpoint, false, bytes).catch(() => {})

  return fresh
}

/**
 * Invalida entradas de cache por prefixo. Útil quando dado muda
 * (ex: gestor edita meta_account_id de um cliente → invalida tudo dele).
 */
export async function invalidateByPrefix(sb: SupabaseClient, keyPrefix: string): Promise<number> {
  try {
    const { data, error } = await sb
      .from('api_cache')
      .delete()
      .like('cache_key', keyPrefix + '%')
      .select('cache_key')
    if (error) {
      console.warn('[api_cache] invalidateByPrefix falhou:', error.message)
      return 0
    }
    return (data?.length || 0)
  } catch {
    return 0
  }
}

/**
 * Garbage collector — remove entradas expiradas há mais de 1h.
 * Idempotente. Chamado por pg_cron + oportunisticamente após operações de escrita.
 */
export async function gcExpired(sb: SupabaseClient, gracePeriodSeconds = 3600): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - gracePeriodSeconds * 1000).toISOString()
    const { data, error } = await sb
      .from('api_cache')
      .delete()
      .lt('expires_at', cutoff)
      .select('cache_key')
    if (error) return 0
    return (data?.length || 0)
  } catch {
    return 0
  }
}
