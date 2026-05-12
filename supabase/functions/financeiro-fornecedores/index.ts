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
      const { data, error } = await sb.from('fin_fornecedores').select('*').eq('ativo', true).order('nome')
      if (error) return json(req, { error: 'Erro ao buscar fornecedores.' }, 500)
      return json(req, { fornecedores: data })
    }

    if (action === 'criar') {
      const { nome, documento, telefone, email, observacoes } = payload
      const normalizedNome = normalizeText(nome)
      if (!normalizedNome) return json(req, { error: 'Nome é obrigatório.' }, 400)
      const { data, error } = await sb.from('fin_fornecedores').insert({ nome: normalizedNome, documento: normalizeText(documento), telefone: normalizeText(telefone), email: normalizeText(email), observacoes: normalizeText(observacoes), created_by: user.usuario_id }).select().single()
      if (error) return json(req, { error: 'Erro ao criar fornecedor.' }, 500)
      return json(req, { fornecedor: data })
    }

    if (action === 'atualizar') {
      const { id, nome, documento, telefone, email, observacoes } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const normalizedNome = normalizeText(nome)
      if (!normalizedNome) return json(req, { error: 'Nome é obrigatório.' }, 400)
      const { data, error } = await sb.from('fin_fornecedores').update({ nome: normalizedNome, documento: normalizeText(documento), telefone: normalizeText(telefone), email: normalizeText(email), observacoes: normalizeText(observacoes) }).eq('id', id).select().single()
      if (error) return json(req, { error: 'Erro ao atualizar fornecedor.' }, 500)
      return json(req, { fornecedor: data })
    }

    if (action === 'deletar') {
      const { id } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const { error } = await sb.from('fin_fornecedores').update({ ativo: false }).eq('id', id)
      if (error) return json(req, { error: 'Erro ao remover fornecedor.' }, 500)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[financeiro-fornecedores]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
