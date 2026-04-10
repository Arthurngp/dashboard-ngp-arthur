import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

// Brasília = UTC-3 (sem horário de verão desde 2019)
const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000

function toBrasiliaDateStr(utcDate: Date): string {
  const ms = utcDate.getTime() + BRASILIA_OFFSET_MS
  return new Date(ms).toISOString().split('T')[0] // YYYY-MM-DD
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const SURL    = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb      = createClient(SURL, SERVICE)

    // Valida sessão
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    const serverNow = new Date()
    const todayStr  = toBrasiliaDateStr(serverNow)

    // Início e fim do dia de hoje em UTC (meia-noite Brasília = 03:00 UTC)
    const startOfToday = `${todayStr}T03:00:00.000Z`
    const nextDay      = new Date(serverNow.getTime() + BRASILIA_OFFSET_MS + 24 * 60 * 60 * 1000)
    const tomorrowStr  = nextDay.toISOString().split('T')[0]
    const endOfToday   = `${tomorrowStr}T03:00:00.000Z`

    // Registros de hoje (excluindo soft-deletados)
    const { data: todayRecords } = await sb
      .from('ponto_registros')
      .select('id, tipo_registro, created_at')
      .eq('usuario_id', sessao.usuario_id)
      .is('deleted_at', null)
      .gte('created_at', startOfToday)
      .lt('created_at', endOfToday)
      .order('created_at', { ascending: true })

    return json(req, {
      server_now:    serverNow.toISOString(),
      today_records: todayRecords || [],
    })

  } catch (e) {
    console.error('[get-ponto-now] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
