import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { normalizeText } from "../_shared/financeiro.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, action, ...payload } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    if (action === 'listar') {
      const { tipo } = payload
      let q = sb.from('fin_categorias').select('*').eq('ativo', true).order('nome')
      if (tipo) q = q.eq('tipo', tipo)
      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao buscar categorias.' }, 500)
      return json(req, { categorias: data })
    }

    if (action === 'criar') {
      const { nome, tipo, cor } = payload
      const normalizedNome = normalizeText(nome)
      const normalizedTipo = normalizeText(tipo)
      if (!normalizedNome || !normalizedTipo) return json(req, { error: 'Nome e tipo são obrigatórios.' }, 400)
      const { data, error } = await sb.from('fin_categorias').insert({ nome: normalizedNome, tipo: normalizedTipo, cor: cor || '#6b7280' }).select().single()
      if (error) return json(req, { error: 'Erro ao criar categoria.' }, 500)
      return json(req, { categoria: data })
    }

    if (action === 'deletar') {
      const { id } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const { error } = await sb.from('fin_categorias').update({ ativo: false }).eq('id', id)
      if (error) return json(req, { error: 'Erro ao remover categoria.' }, 500)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[financeiro-categorias]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
