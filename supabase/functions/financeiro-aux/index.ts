import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { normalizeText, parseCurrencyInput } from "../_shared/financeiro.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, entity, action = 'listar', ...payload } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    // ── fin_accounts ─────────────────────────────────────────────────────────
    if (entity === 'accounts') {
      if (action === 'listar') {
        const { show_archived = false } = payload
        let q = sb
          .from('fin_accounts')
          .select('id, nome, tipo, saldo_inicial')
          .order('nome')

        q = show_archived
          ? q.eq('ativo', false)
          : q.or('ativo.is.null,ativo.eq.true')

        const { data, error } = await q
        if (error) return json(req, { error: 'Erro ao buscar contas.' }, 500)

        // Saldo real: saldo_inicial + todas as transações confirmadas (sem filtro de data)
        const { data: txs } = await sb
          .from('fin_transacoes')
          .select('account_id, tipo, valor')
          .eq('status', 'confirmado')
          .not('account_id', 'is', null)

        const saldos: Record<string, number> = {}
        for (const t of (txs ?? [])) {
          if (!saldos[t.account_id]) saldos[t.account_id] = 0
          saldos[t.account_id] += t.tipo === 'entrada' ? Number(t.valor) : -Number(t.valor)
        }

        const accounts = (data ?? []).map((a: any) => ({
          ...a,
          saldo_atual: Number(a.saldo_inicial) + (saldos[a.id] ?? 0),
        }))

        return json(req, { accounts })
      }

      if (action === 'criar') {
        const { nome, tipo, saldo_inicial } = payload
        const normalizedNome = normalizeText(nome)
        const normalizedTipo = normalizeText(tipo)
        const parsedSaldoInicial = parseCurrencyInput(saldo_inicial ?? 0)
        if (!normalizedNome || !normalizedTipo) return json(req, { error: 'nome e tipo são obrigatórios.' }, 400)
        if (parsedSaldoInicial == null) return json(req, { error: 'Saldo inicial inválido.' }, 400)
        const { data, error } = await sb.from('fin_accounts').insert({
          nome: normalizedNome, tipo: normalizedTipo, saldo_inicial: parsedSaldoInicial, ativo: true,
        }).select().single()
        if (error) return json(req, { error: 'Erro ao criar conta.' }, 500)
        return json(req, { account: data })
      }

      if (action === 'atualizar') {
        const { id, nome, tipo, saldo_inicial } = payload
        const normalizedNome = normalizeText(nome)
        const normalizedTipo = normalizeText(tipo)
        const parsedSaldoInicial = parseCurrencyInput(saldo_inicial ?? 0)
        if (!id) return json(req, { error: 'ID da conta é obrigatório.' }, 400)
        if (!normalizedNome || !normalizedTipo) return json(req, { error: 'nome e tipo são obrigatórios.' }, 400)
        if (parsedSaldoInicial == null) return json(req, { error: 'Saldo inicial inválido.' }, 400)

        const { data, error } = await sb.from('fin_accounts')
          .update({
            nome: normalizedNome,
            tipo: normalizedTipo,
            saldo_inicial: parsedSaldoInicial,
          })
          .eq('id', id)
          .select()
          .single()
        if (error) return json(req, { error: 'Erro ao atualizar conta.' }, 500)
        return json(req, { account: data })
      }

      if (action === 'deletar') {
        const { id } = payload
        if (!id) return json(req, { error: 'ID da conta é obrigatório.' }, 400)

        const { error } = await sb.from('fin_accounts')
          .update({ ativo: false })
          .eq('id', id)
        if (error) return json(req, { error: `Erro ao arquivar conta: ${error.message}` }, 500)
        return json(req, { ok: true })
      }

      if (action === 'restaurar') {
        const { id } = payload
        if (!id) return json(req, { error: 'ID da conta é obrigatório.' }, 400)

        const { error } = await sb.from('fin_accounts')
          .update({ ativo: true })
          .eq('id', id)
        if (error) return json(req, { error: `Erro ao restaurar conta: ${error.message}` }, 500)
        return json(req, { ok: true })
      }
    }

    // ── fin_cost_centers ─────────────────────────────────────────────────────
    if (entity === 'cost_centers') {
      if (action === 'listar') {
        const { data, error } = await sb
          .from('fin_cost_centers')
          .select('id, nome, descricao')
          .eq('ativo', true)
          .order('nome')
        if (error) return json(req, { error: 'Erro ao buscar centros de custo.' }, 500)
        return json(req, { cost_centers: data })
      }

      if (action === 'criar') {
        const { nome, descricao } = payload
        const normalizedNome = normalizeText(nome)
        if (!normalizedNome) return json(req, { error: 'Nome do centro de custo é obrigatório.' }, 400)
        const { data, error } = await sb.from('fin_cost_centers').insert({
          nome: normalizedNome,
          descricao: normalizeText(descricao),
        }).select().single()
        if (error) return json(req, { error: 'Erro ao criar centro de custo.' }, 500)
        return json(req, { cost_center: data })
      }
    }

    // ── fin_products ─────────────────────────────────────────────────────────
    if (entity === 'products') {
      if (action === 'listar') {
        const { data, error } = await sb
          .from('fin_products')
          .select('id, nome, tipo, valor_padrao')
          .eq('ativo', true)
          .order('nome')
        if (error) return json(req, { error: 'Erro ao buscar produtos.' }, 500)
        return json(req, { products: data })
      }

      if (action === 'criar') {
        const { nome, tipo, valor_padrao } = payload
        const normalizedNome = normalizeText(nome)
        const normalizedTipo = normalizeText(tipo)
        const parsedValorPadrao = valor_padrao == null ? null : parseCurrencyInput(valor_padrao)
        if (!normalizedNome || !normalizedTipo) return json(req, { error: 'nome e tipo são obrigatórios.' }, 400)
        if (valor_padrao != null && parsedValorPadrao == null) return json(req, { error: 'Valor padrão inválido.' }, 400)
        const { data, error } = await sb.from('fin_products').insert({
          nome: normalizedNome, tipo: normalizedTipo, valor_padrao: parsedValorPadrao,
        }).select().single()
        if (error) return json(req, { error: 'Erro ao criar produto.' }, 500)
        return json(req, { product: data })
      }
    }

    return json(req, { error: 'Entidade ou ação inválida.' }, 400)

  } catch (e) {
    console.error('[financeiro-aux]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
