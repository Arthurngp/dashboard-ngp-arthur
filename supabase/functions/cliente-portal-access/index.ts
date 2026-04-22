import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession } from "../_shared/roles.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, cliente_id } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const actor = await validateSession(sb, session_token)
    if (!actor) return json(req, { error: 'Sessão expirada.' }, 401)

    const targetClienteId = actor.role === 'cliente' ? actor.usuario_id : (cliente_id || null)

    if (!targetClienteId) {
      return json(req, {
        access: {
          analytics_enabled: false,
          reports_enabled: false,
          crm_enabled: false,
        },
      })
    }

    const [{ data: cliente }, { data: access }] = await Promise.all([
      sb
        .from('usuarios')
        .select('id, nome, username, role, meta_account_id')
        .eq('id', targetClienteId)
        .single(),
      sb
        .from('cliente_portal_acessos')
        .select('analytics_enabled, reports_enabled, crm_enabled')
        .eq('usuario_id', targetClienteId)
        .maybeSingle(),
    ])

    if (!cliente || cliente.role !== 'cliente') {
      return json(req, { error: 'Cliente não encontrado.' }, 404)
    }

    return json(req, {
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        username: cliente.username,
        meta_account_id: cliente.meta_account_id,
      },
      access: {
        analytics_enabled: access?.analytics_enabled ?? true,
        reports_enabled: access?.reports_enabled ?? true,
        crm_enabled: access?.crm_enabled ?? false,
      },
    })
  } catch (e) {
    console.error('[cliente-portal-access] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
