import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb   = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)

    if (!user)              return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Acesso negado.' }, 403)

    const { data: records, error: fetchError } = await sb
      .from('ponto_registros')
      .select('id, tipo_registro, created_at, deleted_at, deleted_by, usuario_id')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    if (fetchError) {
      console.error('[admin-ponto-lixeira] Fetch error:', fetchError)
      return json(req, { error: 'Erro ao buscar lixeira.' }, 500)
    }

    const registros = records || []
    if (registros.length === 0) return json(req, { records: [] })

    const userIds = [...new Set([
      ...registros.map((r: any) => r.usuario_id),
      ...registros.map((r: any) => r.deleted_by).filter(Boolean),
    ])]

    const { data: usuarios } = await sb
      .from('usuarios')
      .select('id, nome, username')
      .in('id', userIds)

    const userMap: Record<string, { nome: string; username: string }> = {}
    for (const u of (usuarios || [])) userMap[u.id] = { nome: u.nome, username: u.username }

    const enriched = registros.map((r: any) => ({
      ...r,
      usuario_nome:      userMap[r.usuario_id]?.nome     || r.usuario_id,
      usuario_username:  userMap[r.usuario_id]?.username || '',
      deletado_por_nome: r.deleted_by ? (userMap[r.deleted_by]?.nome || r.deleted_by) : null,
    }))

    return json(req, { records: enriched })

  } catch (e) {
    console.error('[admin-ponto-lixeira] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
