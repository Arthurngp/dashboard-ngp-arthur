import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { lastDayOfMonth, normalizeDateOnly, normalizeText, parseCurrencyInput } from "../_shared/financeiro.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action, ...payload } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    // ── LISTAR ──────────────────────────────────────────────────────────────
    if (action === 'listar') {
      const { tipo, mes, ano, view = 'competencia' } = payload
      // view='competencia' filtra por competence_date (visão DRE)
      // view='caixa' filtra por payment_date (visão fluxo de caixa)
      const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'

      let q = sb.from('fin_transacoes')
        .select([
          '*',
          'categoria:fin_categorias(id,nome,cor)',
          'cliente:fin_clientes(id,nome)',
          'fornecedor:fin_fornecedores(id,nome)',
          'account:fin_accounts(id,nome,tipo)',
          'cost_center:fin_cost_centers(id,nome)',
          'product:fin_products(id,nome,tipo)',
        ].join(','))
        .order(dateField, { ascending: false })

      if (tipo) q = q.eq('tipo', tipo)

      if (mes && ano) {
        const start = `${ano}-${String(mes).padStart(2, '0')}-01`
        const end = lastDayOfMonth(Number(ano), Number(mes))
        if (view === 'caixa') {
          q = q.not('payment_date', 'is', null)
            .eq('status', 'confirmado')
            .gte('payment_date', start).lte('payment_date', end)
        } else {
          q = q.gte('competence_date', start).lte('competence_date', end)
        }
      }

      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao buscar transações.' }, 500)
      return json(req, { transacoes: data })
    }

    // ── CRIAR ────────────────────────────────────────────────────────────────
    if (action === 'criar') {
      const {
        tipo, descricao, valor, competence_date, payment_date,
        categoria_id, cliente_id, fornecedor_id,
        account_id, cost_center_id, product_id,
        status, observacoes,
      } = payload

      const parsedValor = parseCurrencyInput(valor)
      const normalizedDescricao = normalizeText(descricao)
      const normalizedCompetenceDate = normalizeDateOnly(competence_date)
      const normalizedPaymentDate = normalizeDateOnly(payment_date)

      if (!tipo || !normalizedDescricao || parsedValor == null || parsedValor <= 0 || !normalizedCompetenceDate) {
        return json(req, { error: 'Campos obrigatórios: tipo, descricao, valor, competence_date.' }, 400)
      }

      // status confirmado sem payment_date => usa competence_date como fallback
      const resolvedPaymentDate = status === 'confirmado'
        ? (normalizedPaymentDate || normalizedCompetenceDate)
        : null

      const { data, error } = await sb.from('fin_transacoes').insert({
        tipo,
        descricao: normalizedDescricao,
        valor: parsedValor,
        data_transacao: normalizedCompetenceDate, // mantém campo legado preenchido
        competence_date: normalizedCompetenceDate,
        payment_date: resolvedPaymentDate,
        categoria_id: categoria_id || null,
        cliente_id: cliente_id || null,
        fornecedor_id: fornecedor_id || null,
        account_id: account_id || null,
        cost_center_id: cost_center_id || null,
        product_id: product_id || null,
        status: status || 'confirmado',
        observacoes: normalizeText(observacoes),
        created_by: user.usuario_id,
      }).select([
        '*',
        'categoria:fin_categorias(id,nome,cor)',
        'account:fin_accounts(id,nome)',
        'cost_center:fin_cost_centers(id,nome)',
        'product:fin_products(id,nome)',
      ].join(',')).single()

      if (error) return json(req, { error: 'Erro ao criar transação.' }, 500)
      return json(req, { transacao: data })
    }

    // ── ATUALIZAR ────────────────────────────────────────────────────────────
    if (action === 'atualizar') {
      const { id, ...fields } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)

      const currentResult = await sb.from('fin_transacoes')
        .select('competence_date, payment_date, status')
        .eq('id', id)
        .single()
      if (currentResult.error || !currentResult.data) {
        return json(req, { error: 'Transação não encontrada.' }, 404)
      }

      const allowed = [
        'tipo', 'descricao', 'valor',
        'competence_date', 'payment_date',
        'categoria_id', 'cliente_id', 'fornecedor_id',
        'account_id', 'cost_center_id', 'product_id',
        'status', 'observacoes',
      ]
      const update: Record<string, any> = { updated_at: new Date().toISOString() }
      for (const k of allowed) {
        if (fields[k] !== undefined) update[k] = fields[k]
      }

      if (update.valor !== undefined) {
        const parsedValor = parseCurrencyInput(update.valor)
        if (parsedValor == null || parsedValor <= 0) return json(req, { error: 'Valor inválido.' }, 400)
        update.valor = parsedValor
      }
      if (update.descricao !== undefined) {
        const normalizedDescricao = normalizeText(update.descricao)
        if (!normalizedDescricao) return json(req, { error: 'Descrição obrigatória.' }, 400)
        update.descricao = normalizedDescricao
      }
      if (update.competence_date !== undefined) {
        const normalizedCompetenceDate = normalizeDateOnly(update.competence_date)
        if (!normalizedCompetenceDate) return json(req, { error: 'Data de competência inválida.' }, 400)
        update.competence_date = normalizedCompetenceDate
      }
      if (update.payment_date !== undefined) {
        const normalizedPaymentDate = normalizeDateOnly(update.payment_date)
        if (update.payment_date !== null && !normalizedPaymentDate) {
          return json(req, { error: 'Data de pagamento inválida.' }, 400)
        }
        update.payment_date = normalizedPaymentDate
      }
      if (update.observacoes !== undefined) update.observacoes = normalizeText(update.observacoes)

      // Sincroniza data_transacao legado com competence_date se presente
      if (update.competence_date) update.data_transacao = update.competence_date

      // Limpa payment_date quando status volta para pendente
      if (update.status === 'pendente') update.payment_date = null
      if (update.status === 'confirmado' && !update.payment_date) {
        update.payment_date = currentResult.data.payment_date || update.competence_date || currentResult.data.competence_date
      }

      const { data, error } = await sb.from('fin_transacoes')
        .update(update).eq('id', id)
        .select([
          '*',
          'categoria:fin_categorias(id,nome,cor)',
          'account:fin_accounts(id,nome)',
          'cost_center:fin_cost_centers(id,nome)',
          'product:fin_products(id,nome)',
        ].join(',')).single()

      if (error) return json(req, { error: 'Erro ao atualizar transação.' }, 500)
      return json(req, { transacao: data })
    }

    // ── DELETAR ──────────────────────────────────────────────────────────────
    if (action === 'deletar') {
      const { id } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const { error } = await sb.from('fin_transacoes').delete().eq('id', id)
      if (error) return json(req, { error: 'Erro ao deletar transação.' }, 500)
      return json(req, { ok: true })
    }

    // ── RESUMO ───────────────────────────────────────────────────────────────
    if (action === 'resumo') {
      const { mes, ano, view = 'competencia' } = payload
      const start = `${ano}-${String(mes).padStart(2, '0')}-01`
      const end = lastDayOfMonth(Number(ano), Number(mes))

      let q = sb.from('fin_transacoes').select('tipo, valor, status, payment_date')

      if (view === 'caixa') {
        // Fluxo de caixa: só transações com pagamento confirmado no período
        q = q.not('payment_date', 'is', null)
          .gte('payment_date', start).lte('payment_date', end)
          .eq('status', 'confirmado')
      } else {
        // DRE/Competência: todas as transações do período (pagas ou não)
        q = q.gte('competence_date', start).lte('competence_date', end)
      }

      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao buscar resumo.' }, 500)

      const entradas = data
        .filter((t: any) => t.tipo === 'entrada')
        .reduce((s: number, t: any) => s + Number(t.valor), 0)
      const saidas = data
        .filter((t: any) => t.tipo === 'saida')
        .reduce((s: number, t: any) => s + Number(t.valor), 0)

      return json(req, { entradas, saidas, saldo: entradas - saidas, view })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[financeiro-transacoes]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
