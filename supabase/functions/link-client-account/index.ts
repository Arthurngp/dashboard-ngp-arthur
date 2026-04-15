import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const { session_token, cliente_id, meta_account_id } = await req.json()

    if (!session_token || !cliente_id || !meta_account_id) {
      return json(req, { error: 'Parâmetros inválidos.' }, 400)
    }

    // Validar formato do meta_account_id
    const cleanId = String(meta_account_id).replace(/^act_/, '')
    if (!/^\d+$/.test(cleanId)) {
      return json(req, { error: 'Meta Account ID inválido. Use formato: act_123456789' }, 400)
    }

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    // Validar sessão e verificar se é NGP
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) {
      return json(req, { error: 'Sessão expirada.' }, 401)
    }

    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single()

    if (!usuario || (usuario.role !== 'ngp' && usuario.role !== 'admin')) {
      return json(req, { error: 'Acesso negado.' }, 403)
    }

    // Atualizar meta_account_id do cliente
    const { error } = await sb
      .from('usuarios')
      .update({ meta_account_id: cleanId })
      .eq('id', cliente_id)
      .eq('role', 'cliente')

    if (error) {
      console.error('[link-client-account] Update error:', error)
      return json(req, { error: 'Erro ao vincular conta.' }, 500)
    }

    return json(req, { ok: true })

  } catch (e) {
    console.error('[link-client-account] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
