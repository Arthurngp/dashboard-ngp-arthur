import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { hasScope, validateApiToken } from "../_shared/api_tokens.ts"
import { normalizeText, parseCurrencyInput } from "../_shared/financeiro.ts"

type Tipo = 'entrada' | 'saida'
type Status = 'confirmado' | 'pendente'

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function weekRange(reference = new Date()) {
  const date = new Date(Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()))
  const day = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - day)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

async function findAccountByName(sb: any, name: string) {
  const normalized = normalizeText(name)
  if (!normalized) return null
  const { data } = await sb
    .from('fin_accounts')
    .select('id,nome,tipo')
    .or('ativo.is.null,ativo.eq.true')
    .ilike('nome', normalized)
    .maybeSingle()
  return data || null
}

async function ensureCategoria(sb: any, nome: string | null, tipo: Tipo) {
  const normalized = normalizeText(nome)
  if (!normalized) return null

  const { data: existing, error: existingError } = await sb
    .from('fin_categorias')
    .select('id,nome,tipo')
    .eq('ativo', true)
    .eq('tipo', tipo)
    .ilike('nome', normalized)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) return existing

  const { data, error } = await sb
    .from('fin_categorias')
    .insert({ nome: normalized, tipo, cor: tipo === 'entrada' ? '#059669' : '#dc2626' })
    .select('id,nome,tipo')
    .single()

  if (error) throw error
  return data
}

async function audit(sb: any, tokenId: string, req: Request, action: string, status: string, requestPayload: unknown, responsePayload: unknown) {
  const forwardedFor = req.headers.get('x-forwarded-for') || ''
  const { error } = await sb.from('api_token_audit_logs').insert({
    api_token_id: tokenId,
    action,
    status,
    request_payload: requestPayload ?? {},
    response_payload: responsePayload ?? {},
    ip_address: forwardedFor.split(',')[0]?.trim() || null,
    user_agent: req.headers.get('user-agent'),
  })
  if (error) throw error
}

async function safeAudit(sb: any, tokenId: string, req: Request, action: string, status: string, requestPayload: unknown, responsePayload: unknown) {
  try {
    await audit(sb, tokenId, req, action, status, requestPayload, responsePayload)
  } catch (error) {
    console.error('[financeiro-openclaw:audit]', error)
  }
}

function summarizeTransactions(rows: any[]) {
  return rows.reduce((acc, tx) => {
    const value = Math.abs(Number(tx.valor || 0))
    if (tx.tipo === 'entrada') acc.entradas += value
    if (tx.tipo === 'saida') acc.saidas += value
    if (tx.status === 'pendente' && tx.tipo === 'entrada') acc.a_receber += value
    if (tx.status === 'pendente' && tx.tipo === 'saida') acc.a_pagar += value
    acc.saldo = acc.entradas - acc.saidas
    return acc
  }, { entradas: 0, saidas: 0, saldo: 0, a_receber: 0, a_pagar: 0 })
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let apiToken = null
  let body: any = {}
  try {
    apiToken = await validateApiToken(sb, req)
    if (!apiToken) return json(req, { error: 'API token inválido.' }, 401)

    body = await req.json()
    const { action, ...payload } = body
    if (!action) return json(req, { error: 'Ação obrigatória.' }, 400)

    if (action === 'listar_contas') {
      if (!hasScope(apiToken, 'financeiro:read')) return json(req, { error: 'Permissão insuficiente.' }, 403)
      const { data, error } = await sb.from('fin_accounts').select('id,nome,tipo,saldo_inicial').or('ativo.is.null,ativo.eq.true').order('nome')
      if (error) return json(req, { error: 'Erro ao listar contas.' }, 500)
      const response = { accounts: data ?? [] }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, response)
      return json(req, response)
    }

    if (action === 'listar_categorias') {
      if (!hasScope(apiToken, 'financeiro:read')) return json(req, { error: 'Permissão insuficiente.' }, 403)
      const { tipo } = payload
      let q = sb.from('fin_categorias').select('id,nome,tipo,cor').eq('ativo', true).order('nome')
      if (tipo === 'entrada' || tipo === 'saida') q = q.eq('tipo', tipo)
      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao listar categorias.' }, 500)
      const response = { categorias: data ?? [] }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, response)
      return json(req, response)
    }

    if (action === 'criar_lancamento') {
      if (!hasScope(apiToken, 'financeiro:create')) return json(req, { error: 'Permissão insuficiente.' }, 403)

      const tipo: Tipo = payload.tipo === 'entrada' ? 'entrada' : 'saida'
      const status: Status = payload.status === 'pendente' ? 'pendente' : 'confirmado'
      const descricao = normalizeText(payload.descricao)
      const valor = parseCurrencyInput(payload.valor)
      const date = normalizeDateOnly(payload.data) || normalizeDateOnly(payload.competence_date) || todayISO()
      const paymentDate = status === 'confirmado'
        ? (normalizeDateOnly(payload.payment_date) || date)
        : null

      if (!descricao) return json(req, { error: 'Descrição obrigatória.' }, 400)
      if (valor == null || valor <= 0) return json(req, { error: 'Valor inválido.' }, 400)
      if (!payload.conta_nome && !payload.account_id) return json(req, { error: 'Informe conta_nome ou account_id.' }, 400)

      let accountId = payload.account_id || null
      let account = null
      if (!accountId) {
        account = await findAccountByName(sb, payload.conta_nome)
        if (!account?.id) {
          const response = {
            error: 'Conta não encontrada.',
            code: 'account_not_found',
            conta_nome: payload.conta_nome,
          }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 404)
        }
        accountId = account.id
      }

      const categoria = await ensureCategoria(sb, payload.categoria_sugerida || payload.categoria, tipo)
      const sourceTag = normalizeText(payload.source_tag) || 'API / OpenClaw'
      const sourceMessage = normalizeText(payload.mensagem_original)
      const observacoes = normalizeText([
        payload.observacoes,
        payload.origem ? `Origem: ${payload.origem}` : 'Origem: OpenClaw',
        sourceTag ? `Tag: ${sourceTag}` : '',
        sourceMessage ? `Mensagem original: ${sourceMessage}` : '',
      ].filter(Boolean).join('\n'))

      const { data, error } = await sb.from('fin_transacoes').insert({
        tipo,
        descricao,
        valor,
        data_transacao: date,
        competence_date: date,
        payment_date: paymentDate,
        status,
        account_id: accountId,
        categoria_id: categoria?.id || null,
        observacoes,
        source_type: 'api',
        source_tag: sourceTag,
        source_message: sourceMessage,
        api_token_id: apiToken.id,
        created_by: null,
      }).select([
        'id,tipo,descricao,valor,status,competence_date,payment_date,source_type,source_tag,source_message',
        'account:fin_accounts(id,nome)',
        'categoria:fin_categorias(id,nome,tipo)',
      ].join(',')).single()

      if (error) {
        const response = { error: 'Erro ao criar lançamento.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const response = {
        ok: true,
        transacao: data,
        message: `Lançamento criado: ${tipo} de R$ ${Number(valor).toFixed(2)} em ${data.account?.nome || payload.conta_nome}.`,
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, response)
      return json(req, response)
    }

    if (action === 'briefing_diario' || action === 'resumo_semanal') {
      if (!hasScope(apiToken, 'financeiro:reports')) return json(req, { error: 'Permissão insuficiente.' }, 403)
      const range = action === 'briefing_diario'
        ? { start: normalizeDateOnly(payload.data) || todayISO(), end: normalizeDateOnly(payload.data) || todayISO() }
        : weekRange(payload.reference_date ? new Date(`${payload.reference_date}T00:00:00Z`) : new Date())

      let q = sb.from('fin_transacoes')
        .select([
          'id,tipo,descricao,valor,status,competence_date,payment_date',
          'account:fin_accounts!inner(id,nome,ativo)',
          'categoria:fin_categorias(id,nome,tipo)',
        ].join(','))
        .gte('competence_date', range.start)
        .lte('competence_date', range.end)
        .eq('account.ativo', true)
        .order('competence_date', { ascending: true })

      if (payload.account_id) q = q.eq('account_id', payload.account_id)
      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao buscar lançamentos.' }, 500)

      const transacoes = data ?? []
      const resumo = summarizeTransactions(transacoes)
      const response = {
        period: range,
        resumo,
        a_pagar: transacoes.filter((tx: any) => tx.status === 'pendente' && tx.tipo === 'saida'),
        a_receber: transacoes.filter((tx: any) => tx.status === 'pendente' && tx.tipo === 'entrada'),
        realizado: transacoes.filter((tx: any) => tx.status === 'confirmado'),
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, response)
      return json(req, response)
    }

    return json(req, { error: 'Ação inválida.' }, 400)
  } catch (e) {
    console.error('[financeiro-openclaw]', e)
    if (apiToken?.id) {
      await safeAudit(sb, apiToken.id, req, body?.action || 'unknown', 'error', body, { error: String(e?.message || e) })
    }
    return json(req, { error: `Erro interno: ${String(e?.message || e)}` }, 500)
  }
})
