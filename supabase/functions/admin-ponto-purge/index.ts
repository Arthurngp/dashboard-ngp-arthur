import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, record_ids } = await req.json()

    if (!session_token)                                        return json(req, { error: 'Sessão inválida.' }, 401)
    if (!Array.isArray(record_ids) || record_ids.length === 0) return json(req, { error: 'IDs inválidos.' }, 400)

    const sb   = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)

    if (!user)              return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Acesso negado.' }, 403)

    // Exclusão permanente — só permite registros já na lixeira
    const { error } = await sb
      .from('ponto_registros')
      .delete()
      .in('id', record_ids)
      .not('deleted_at', 'is', null)

    if (error) {
      console.error('[admin-ponto-purge] Error:', error)
      return json(req, { error: 'Erro ao excluir permanentemente.' }, 500)
    }

    return json(req, { ok: true })

  } catch (e) {
    console.error('[admin-ponto-purge] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
