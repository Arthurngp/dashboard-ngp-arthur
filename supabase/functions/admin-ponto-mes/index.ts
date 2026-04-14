import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

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

    const sb   = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)

    if (!user)          return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Acesso negado.' }, 403)

    // Intervalo do mês em UTC (meia-noite Brasília = 03:00 UTC)
    const mesPad   = mesNum.toString().padStart(2, '0')
    const startUtc = `${anoNum}-${mesPad}-01T03:00:00.000Z`

    let nextMes = mesNum + 1
    let nextAno = anoNum
    if (nextMes > 12) { nextMes = 1; nextAno++ }
    const nextMesPad = nextMes.toString().padStart(2, '00')
    const endUtc     = `${nextAno}-${nextMesPad}-01T03:00:00.000Z`

    // Busca todos os registros do mês
    const { data: records, error: recError } = await sb
      .from('ponto_registros')
      .select('id, tipo_registro, created_at, usuario_id')
      .is('deleted_at', null)
      .gte('created_at', startUtc)
      .lt('created_at', endUtc)
      .order('created_at', { ascending: true })

    if (recError) {
      console.error('[admin-ponto-mes] records error:', recError)
      return json(req, { error: 'Erro ao buscar registros.' }, 500)
    }

    // Busca nomes de todos os usuários
    const { data: usuarios, error: usrError } = await sb
      .from('usuarios')
      .select('id, nome, username')

    if (usrError) {
      console.error('[admin-ponto-mes] usuarios error:', usrError)
      return json(req, { error: 'Erro ao buscar usuários.' }, 500)
    }

    // Monta mapa id → nome
    // deno-lint-ignore no-explicit-any
    const userMap: Record<string, string> = {}
    for (const u of (usuarios || [])) {
      userMap[u.id] = u.nome || u.username || u.id
    }

    // Adiciona nome a cada registro
    // deno-lint-ignore no-explicit-any
    const enriched = (records || []).map((r: any) => ({
      ...r,
      usuario_nome: userMap[r.usuario_id] || r.usuario_id,
    }))

    return json(req, { records: enriched })

  } catch (e) {
    console.error('[admin-ponto-mes] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
