import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession } from "../_shared/roles.ts"

const MASTER_USERNAMES = ['arthur', 'arthur.oliveira@sejangp.com.br']

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, usuario_id, setores } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!usuario_id)    return json(req, { error: 'usuario_id obrigatório.' }, 400)
    if (!setores || typeof setores !== 'object') return json(req, { error: 'setores obrigatório.' }, 400)

    const sb   = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)

    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!MASTER_USERNAMES.includes(user.username)) {
      return json(req, { error: 'Acesso negado. Apenas o ADM Master pode gerenciar setores.' }, 403)
    }

    const allowed = ['acesso_financeiro']
    const update: Record<string, boolean> = {}
    for (const key of allowed) {
      if (key in setores) update[key] = Boolean(setores[key])
    }

    if (Object.keys(update).length === 0) return json(req, { error: 'Nenhum setor válido informado.' }, 400)

    const { data, error } = await sb
      .from('usuarios')
      .update(update)
      .eq('id', usuario_id)
      .in('role', ['admin', 'ngp'])
      .select('id, nome, username, acesso_financeiro')
      .single()

    if (error) return json(req, { error: 'Erro ao atualizar acessos.' }, 500)

    return json(req, { usuario: data })

  } catch (e) {
    console.error('[admin-update-setores]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
