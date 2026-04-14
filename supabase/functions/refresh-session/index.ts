import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000 // 2 horas

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token } = await req.json()
    if (!session_token) return json(req, { error: 'Token inválido.' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const now = new Date()

    // Busca a sessão (ainda não expirada pelo expires_at)
    const { data: sessao } = await sb
      .from('sessions')
      .select('id, usuario_id, expires_at, last_activity')
      .eq('token', session_token)
      .gt('expires_at', now.toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    // Verifica inatividade: se last_activity > 2h atrás → desloga
    const lastActivity = sessao.last_activity
      ? new Date(sessao.last_activity).getTime()
      : new Date(sessao.expires_at).getTime() - 7 * 86400000 // fallback

    const inactiveMs = now.getTime() - lastActivity

    if (inactiveMs > INACTIVITY_LIMIT_MS) {
      // Invalida a sessão por inatividade
      await sb.from('sessions').delete().eq('id', sessao.id)
      return json(req, { error: 'Sessão expirada por inatividade.' }, 401)
    }

    // Ainda ativo: atualiza last_activity e renova expires_at por mais 7 dias
    const newExpires = new Date(now.getTime() + 7 * 86400000).toISOString()

    await sb
      .from('sessions')
      .update({ last_activity: now.toISOString(), expires_at: newExpires })
      .eq('id', sessao.id)

    return json(req, { ok: true, expires_at: newExpires })

  } catch (e) {
    console.error('[refresh-session] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
