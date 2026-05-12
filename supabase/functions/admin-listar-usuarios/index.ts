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

    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Acesso negado.' }, 403)

    const { data: usuarios, error } = await sb
      .from('usuarios')
      .select('id, nome, username, role, ativo, created_at, foto_url, acesso_financeiro')
      .order('created_at', { ascending: false })

    if (error) return json(req, { error: 'Erro ao buscar usuários.' }, 500)

    return json(req, { usuarios })

  } catch (e) {
    console.error('[admin-listar-usuarios] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
