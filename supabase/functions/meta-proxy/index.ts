import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, endpoint, params = {}, account_id } = body

    if (!session_token || !endpoint) {
      return json(req, { error: 'Parâmetros inválidos.' }, 400)
    }

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    // 1. Validar sessão
    const { data: sessions } = await sb
      .from('sessions')
      .select('usuario_id, expires_at')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .limit(1)

    if (!sessions?.length) {
      return json(req, { error: 'Sessão inválida ou expirada.' }, 401)
    }

    // 2. Buscar usuário
    const { data: usuario } = await sb
      .from('usuarios')
      .select('role, meta_account_id, ativo')
      .eq('id', sessions[0].usuario_id)
      .single()

    if (!usuario || !usuario.ativo) {
      return json(req, { error: 'Usuário inativo.' }, 403)
    }

    // 3. Determinar account_id autorizado
    let accountId = account_id || usuario.meta_account_id
    if (!accountId) {
      return json(req, { error: 'Conta de anúncio não configurada.' }, 400)
    }

    accountId = String(accountId).replace(/^act_/, '')

    // 4. Buscar meta_token — cadeia de fallback:
    //    1) Token do próprio usuário logado
    //    2) Variável de ambiente META_ACCESS_TOKEN
    //    3) Token de qualquer usuário NGP ativo (Business Manager)
    const { data: tokenUser } = await sb
      .from('usuarios')
      .select('meta_token')
      .eq('id', sessions[0].usuario_id)
      .single()

    let metaToken = tokenUser?.meta_token || Deno.env.get('META_ACCESS_TOKEN')

    // Fallback: buscar token de um NGP ativo (o Business Manager central)
    if (!metaToken) {
      const { data: ngpFallback } = await sb
        .from('usuarios')
        .select('meta_token')
        .eq('role', 'ngp')
        .eq('ativo', true)
        .not('meta_token', 'is', null)
        .limit(1)
        .single()
      metaToken = ngpFallback?.meta_token
    }

    if (!metaToken) {
      return json(req, { error: 'Meta token não configurado. Peça ao gestor para configurar.' }, 503)
    }

    // 5. Construir URL
    const normalizedEndpoint = endpoint.replace(/^\{account_id\}\//, '')
    let url = `https://graph.facebook.com/v19.0/${normalizedEndpoint}`

    if (!normalizedEndpoint.includes('/')) {
      url = `https://graph.facebook.com/v19.0/act_${accountId}/${normalizedEndpoint}`
    }

    // 6. Adicionar parâmetros
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' || typeof value === 'number') {
        searchParams.set(key, String(value))
      }
    }
    searchParams.set('access_token', metaToken)

    url += '?' + searchParams.toString()

    console.log('[meta-proxy] Calling:', url.replace(metaToken, 'TOKEN'))

    // 7. Chamar Meta API
    const metaRes = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const metaData = await metaRes.json()

    if (metaData?.error) {
      const metaErr = metaData.error
      console.error('[meta-proxy] Meta error:', JSON.stringify(metaErr))
      // Retorna detalhes do erro Meta para diagnóstico
      const code = metaErr.code || 0
      const subcode = metaErr.error_subcode || 0
      let userMsg = 'Erro ao consultar Meta API.'
      if (code === 190) userMsg = 'Token Meta expirado ou inválido. Peça ao gestor para atualizar.'
      else if (code === 10 || code === 200 || code === 270) userMsg = `Sem permissão para acessar esta conta (act_${accountId}). Verifique no Business Manager.`
      else if (code === 17 || code === 4) userMsg = 'Limite de requisições da Meta API atingido. Aguarde alguns minutos.'
      else if (metaErr.message) userMsg = `Meta API: ${metaErr.message}`
      return json(req, {
        error: userMsg,
        meta_error: { code, subcode, type: metaErr.type, account_id: accountId },
      }, 502)
    }

    return json(req, metaData)

  } catch (e) {
    console.error('[meta-proxy] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
