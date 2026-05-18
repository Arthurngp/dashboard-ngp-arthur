// ── admin-cache-stats ────────────────────────────────────────────────────────
// Endpoint admin pra observar saúde do cache:
//  - hit rate global e por endpoint
//  - top N keys (mais acessadas)
//  - quantidade de entries vencidas (candidatas a GC)
//  - tamanho médio do payload
//
// Acesso: somente role=admin. Cliente NUNCA chama.
// Side effect opcional: ?gc=1 dispara limpeza imediata de entries expiradas.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { gcExpired } from '../_shared/api_cache.ts'

// deno-lint-ignore no-explicit-any
async function validateAdminSession(sb: any, token: string): Promise<boolean> {
  if (!token) return false
  const { data: sessions } = await sb
    .from('sessions')
    .select('usuario_id, expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  if (!sessions?.length) return false
  const userId = sessions[0].usuario_id
  const { data: usuario } = await sb
    .from('usuarios')
    .select('role, ativo')
    .eq('id', userId)
    .single()
  return !!(usuario && usuario.ativo && usuario.role === 'admin')
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, gc } = await req.json().catch(() => ({}))

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    const isAdmin = await validateAdminSession(sb, session_token)
    if (!isAdmin) return json(req, { error: 'Acesso restrito a admin.' }, 403)

    // GC sob demanda (admin clicou "Limpar expirados")
    let gcRemoved = 0
    if (gc) {
      gcRemoved = await gcExpired(sb, 0)  // sem grace — apaga tudo expirado
    }

    // Stats por endpoint
    const { data: stats } = await sb
      .from('cache_stats')
      .select('*')
      .order('hits', { ascending: false })

    // Contadores agregados
    const totalHits = (stats || []).reduce((s: number, r: { hits: number }) => s + (r.hits || 0), 0)
    const totalMisses = (stats || []).reduce((s: number, r: { misses: number }) => s + (r.misses || 0), 0)
    const totalReq = totalHits + totalMisses
    const hitRate = totalReq > 0 ? totalHits / totalReq : 0

    // Entries atualmente válidas vs expiradas
    const nowIso = new Date().toISOString()
    const { count: activeEntries } = await sb
      .from('api_cache')
      .select('*', { count: 'exact', head: true })
      .gt('expires_at', nowIso)
    const { count: expiredEntries } = await sb
      .from('api_cache')
      .select('*', { count: 'exact', head: true })
      .lt('expires_at', nowIso)

    // Top 10 keys mais acessadas pelo expires_at recente (proxy de uso)
    const { data: topKeys } = await sb
      .from('api_cache')
      .select('cache_key, expires_at, created_at')
      .gt('expires_at', nowIso)
      .order('expires_at', { ascending: false })
      .limit(10)

    return json(req, {
      ok: true,
      gc_removed: gcRemoved,
      summary: {
        total_hits: totalHits,
        total_misses: totalMisses,
        hit_rate: hitRate,
        active_entries: activeEntries || 0,
        expired_entries: expiredEntries || 0,
      },
      by_endpoint: stats || [],
      top_keys: (topKeys || []).map((k: { cache_key: string; expires_at: string; created_at: string }) => ({
        key: k.cache_key.slice(0, 120),  // trunca pra não vazar payloads sensíveis
        expires_in_seconds: Math.max(0, Math.round((new Date(k.expires_at).getTime() - Date.now()) / 1000)),
        age_seconds: Math.max(0, Math.round((Date.now() - new Date(k.created_at).getTime()) / 1000)),
      })),
    })
  } catch (e) {
    console.error('[admin-cache-stats]', e)
    return json(req, { error: e instanceof Error ? e.message : 'Erro interno' }, 500)
  }
})
