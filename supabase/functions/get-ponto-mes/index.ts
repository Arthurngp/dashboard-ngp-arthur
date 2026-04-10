import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, mes, ano } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!mes || !ano)   return json(req, { error: 'Mês e ano são obrigatórios.' }, 400)

    const mesNum = Number(mes)
    const anoNum = Number(ano)

    if (mesNum < 1 || mesNum > 12 || anoNum < 2020 || anoNum > 2100) {
      return json(req, { error: 'Período inválido.' }, 400)
    }

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

    // Intervalo do mês em UTC (meia-noite Brasília = 03:00 UTC)
    // Ex: Abril 2026 → de 2026-04-01T03:00:00Z até 2026-05-01T03:00:00Z
    const mesPad   = mesNum.toString().padStart(2, '0')
    const startUtc = `${anoNum}-${mesPad}-01T03:00:00.000Z`

    let nextMes = mesNum + 1
    let nextAno = anoNum
    if (nextMes > 12) { nextMes = 1; nextAno++ }
    const nextMesPad = nextMes.toString().padStart(2, '0')
    const endUtc     = `${nextAno}-${nextMesPad}-01T03:00:00.000Z`

    const { data: records, error: fetchError } = await sb
      .from('ponto_registros')
      .select('id, tipo_registro, created_at')
      .eq('usuario_id', sessao.usuario_id)
      .is('deleted_at', null)
      .gte('created_at', startUtc)
      .lt('created_at', endUtc)
      .order('created_at', { ascending: true })

    if (fetchError) {
      console.error('[get-ponto-mes] Fetch error:', fetchError)
      return json(req, { error: 'Erro ao buscar registros.' }, 500)
    }

    return json(req, { records: records || [] })

  } catch (e) {
    console.error('[get-ponto-mes] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
