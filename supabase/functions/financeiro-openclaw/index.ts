import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { hasScope, sha256Hex, validateApiToken } from "../_shared/api_tokens.ts"
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

// PostgREST limita a 1000 rows por request — paginar todas as transações confirmadas
// para somar saldos sem truncar.
async function fetchAllConfirmedTx(sb: any): Promise<Array<{ account_id: string; tipo: string; valor: number }>> {
  const out: Array<{ account_id: string; tipo: string; valor: number }> = []
  let off = 0
  while (true) {
    const { data, error } = await sb
      .from('fin_transacoes')
      .select('account_id, tipo, valor')
      .eq('status', 'confirmado')
      .not('account_id', 'is', null)
      .range(off, off + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    off += 1000
  }
  return out
}

function clampLimit(value: unknown, def = 100, max = 500): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(Math.floor(n), max)
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
      const { data: rawAccounts, error } = await sb
        .from('fin_accounts')
        .select('id,nome,tipo,saldo_inicial,incluir_no_saldo')
        .or('ativo.is.null,ativo.eq.true')
        .order('nome')
      if (error) return json(req, { error: 'Erro ao listar contas.' }, 500)

      // Saldo real: saldo_inicial + soma de todas as transações confirmadas
      let txs: Array<{ account_id: string; tipo: string; valor: number }> = []
      try { txs = await fetchAllConfirmedTx(sb) }
      catch (_) { return json(req, { error: 'Erro ao calcular saldos.' }, 500) }

      const saldoByAccount: Record<string, number> = {}
      for (const t of txs) {
        if (!saldoByAccount[t.account_id]) saldoByAccount[t.account_id] = 0
        saldoByAccount[t.account_id] += t.tipo === 'entrada' ? Number(t.valor) : -Number(t.valor)
      }

      const accounts = (rawAccounts ?? []).map((a: any) => ({
        id: a.id,
        nome: a.nome,
        tipo: a.tipo,
        saldo_inicial: Number(a.saldo_inicial),
        saldo_atual: Number(a.saldo_inicial) + (saldoByAccount[a.id] ?? 0),
        incluir_no_saldo: a.incluir_no_saldo !== false,
      }))

      // Totais agregados (mesma fórmula do Dashboard / financeiro-aux)
      const isContaCorrente = (t: string) => t === 'conta_corrente' || t === 'banco'
      const saldo_total = accounts
        .filter((a: any) => a.incluir_no_saldo && isContaCorrente(a.tipo))
        .reduce((s: number, a: any) => s + a.saldo_atual, 0)
      const saldo_investimentos = accounts
        .filter((a: any) => a.incluir_no_saldo && a.tipo === 'investimento')
        .reduce((s: number, a: any) => s + a.saldo_atual, 0)
      const saldo_poupanca = accounts
        .filter((a: any) => a.incluir_no_saldo && a.tipo === 'poupanca')
        .reduce((s: number, a: any) => s + a.saldo_atual, 0)

      const response = {
        accounts,
        saldo_total,
        saldo_investimentos,
        saldo_poupanca,
      }
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

    // ─── listar_lancamentos ──────────────────────────────────────────────────
    // Filtros: start, end (YYYY-MM-DD), tipo, status, account_id, categoria_id,
    //          cliente_id, fornecedor_id, view ('caixa'|'competencia'),
    //          limit (default 100, max 500), offset (paginação manual).
    if (action === 'listar_lancamentos') {
      if (!hasScope(apiToken, 'financeiro:read')) return json(req, { error: 'Permissão insuficiente.' }, 403)

      const view: 'caixa' | 'competencia' = payload.view === 'caixa' ? 'caixa' : 'competencia'
      const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'
      const start = normalizeDateOnly(payload.start)
      const end = normalizeDateOnly(payload.end)
      const limit = clampLimit(payload.limit, 100, 500)
      const offset = Number.isFinite(Number(payload.offset)) && Number(payload.offset) >= 0 ? Math.floor(Number(payload.offset)) : 0

      let q = sb.from('fin_transacoes')
        .select([
          'id,tipo,descricao,valor,status,competence_date,payment_date,observacoes,source_type,source_tag',
          'account:fin_accounts(id,nome,tipo)',
          'categoria:fin_categorias(id,nome,tipo)',
          'cliente:fin_clientes(id,nome)',
          'fornecedor:fin_fornecedores(id,nome)',
        ].join(','), { count: 'exact' })
        .order(dateField, { ascending: false })
        .range(offset, offset + limit - 1)

      if (start) q = q.gte(dateField, start)
      if (end) q = q.lte(dateField, end)
      if (payload.tipo === 'entrada' || payload.tipo === 'saida') q = q.eq('tipo', payload.tipo)
      if (payload.status === 'confirmado' || payload.status === 'pendente') q = q.eq('status', payload.status)
      if (payload.account_id) q = q.eq('account_id', payload.account_id)
      if (payload.categoria_id) q = q.eq('categoria_id', payload.categoria_id)
      if (payload.cliente_id) q = q.eq('cliente_id', payload.cliente_id)
      if (payload.fornecedor_id) q = q.eq('fornecedor_id', payload.fornecedor_id)

      const { data, error, count } = await q
      if (error) {
        const response = { error: 'Erro ao listar lançamentos.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const lancamentos = data ?? []
      const resumo = summarizeTransactions(lancamentos)
      const response = {
        period: start || end ? { start, end } : null,
        view,
        total: count ?? lancamentos.length,
        limit,
        offset,
        has_more: (count ?? 0) > offset + lancamentos.length,
        lancamentos,
        resumo,
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { ...response, lancamentos: `[${lancamentos.length} items]` })
      return json(req, response)
    }

    // ─── listar_clientes ─────────────────────────────────────────────────────
    // Retorna clientes ativos com saldo_a_receber (soma de pendentes de entrada).
    if (action === 'listar_clientes') {
      if (!hasScope(apiToken, 'financeiro:read')) return json(req, { error: 'Permissão insuficiente.' }, 403)

      const limit = clampLimit(payload.limit, 200, 500)
      const { data: clientes, error: cErr } = await sb
        .from('fin_clientes')
        .select('id, nome, documento, telefone, email, mensalidade_valor, mensalidade_descricao, dia_cobranca, assinatura_ativa')
        .or('ativo.is.null,ativo.eq.true')
        .order('nome')
        .limit(limit)
      if (cErr) {
        const response = { error: 'Erro ao listar clientes.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      // Soma a_receber por cliente_id (pendentes de entrada)
      const { data: pendentes, error: pErr } = await sb
        .from('fin_transacoes')
        .select('cliente_id, valor')
        .eq('status', 'pendente')
        .eq('tipo', 'entrada')
        .not('cliente_id', 'is', null)
      if (pErr) {
        const response = { error: 'Erro ao calcular saldo a receber.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const aReceberByCliente: Record<string, number> = {}
      for (const t of (pendentes ?? [])) {
        const k = t.cliente_id
        aReceberByCliente[k] = (aReceberByCliente[k] || 0) + Number(t.valor || 0)
      }

      const result = (clientes ?? []).map((c: any) => ({
        ...c,
        saldo_a_receber: Number((aReceberByCliente[c.id] ?? 0).toFixed(2)),
      }))

      const response = { clientes: result, total: result.length }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { total: result.length })
      return json(req, response)
    }

    // ─── listar_fornecedores ─────────────────────────────────────────────────
    // Retorna fornecedores ativos com saldo_a_pagar (soma de pendentes de saída).
    if (action === 'listar_fornecedores') {
      if (!hasScope(apiToken, 'financeiro:read')) return json(req, { error: 'Permissão insuficiente.' }, 403)

      const limit = clampLimit(payload.limit, 200, 500)
      const { data: fornecedores, error: fErr } = await sb
        .from('fin_fornecedores')
        .select('id, nome, documento, telefone, email')
        .or('ativo.is.null,ativo.eq.true')
        .order('nome')
        .limit(limit)
      if (fErr) {
        const response = { error: 'Erro ao listar fornecedores.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const { data: pendentes, error: pErr } = await sb
        .from('fin_transacoes')
        .select('fornecedor_id, valor')
        .eq('status', 'pendente')
        .eq('tipo', 'saida')
        .not('fornecedor_id', 'is', null)
      if (pErr) {
        const response = { error: 'Erro ao calcular saldo a pagar.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const aPagarByFornecedor: Record<string, number> = {}
      for (const t of (pendentes ?? [])) {
        const k = t.fornecedor_id
        aPagarByFornecedor[k] = (aPagarByFornecedor[k] || 0) + Number(t.valor || 0)
      }

      const result = (fornecedores ?? []).map((f: any) => ({
        ...f,
        saldo_a_pagar: Number((aPagarByFornecedor[f.id] ?? 0).toFixed(2)),
      }))

      const response = { fornecedores: result, total: result.length }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { total: result.length })
      return json(req, response)
    }

    // ─── resumo_periodo ──────────────────────────────────────────────────────
    // Generaliza briefing_diario / resumo_semanal aceitando start/end arbitrários.
    // Pagina internamente para suportar períodos longos.
    if (action === 'resumo_periodo') {
      if (!hasScope(apiToken, 'financeiro:reports')) return json(req, { error: 'Permissão insuficiente.' }, 403)

      const start = normalizeDateOnly(payload.start)
      const end = normalizeDateOnly(payload.end)
      if (!start || !end) return json(req, { error: 'Informe start e end (YYYY-MM-DD).' }, 400)
      if (start > end) return json(req, { error: 'start deve ser menor ou igual a end.' }, 400)

      const view: 'caixa' | 'competencia' = payload.view === 'caixa' ? 'caixa' : 'competencia'
      const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'

      // Pagina para suportar períodos longos (>1000 transações)
      const transacoes: any[] = []
      let off = 0
      while (true) {
        let q = sb.from('fin_transacoes')
          .select([
            'id,tipo,descricao,valor,status,competence_date,payment_date',
            'account:fin_accounts!inner(id,nome,ativo)',
            'categoria:fin_categorias(id,nome,tipo)',
          ].join(','))
          .gte(dateField, start)
          .lte(dateField, end)
          .eq('account.ativo', true)
          .order(dateField, { ascending: true })
          .range(off, off + 999)
        if (payload.account_id) q = q.eq('account_id', payload.account_id)
        const { data, error } = await q
        if (error) {
          const response = { error: 'Erro ao buscar lançamentos.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 500)
        }
        if (!data || data.length === 0) break
        transacoes.push(...data)
        if (data.length < 1000) break
        off += 1000
      }

      const resumo = summarizeTransactions(transacoes)
      const response = {
        period: { start, end },
        view,
        total: transacoes.length,
        resumo,
        a_pagar: transacoes.filter((tx: any) => tx.status === 'pendente' && tx.tipo === 'saida'),
        a_receber: transacoes.filter((tx: any) => tx.status === 'pendente' && tx.tipo === 'entrada'),
        realizado: transacoes.filter((tx: any) => tx.status === 'confirmado'),
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { period: response.period, total: response.total, resumo })
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

    // ─── deletar_lancamento ──────────────────────────────────────────────────
    // Soft delete (deleted_at = now). Fluxo em 2 etapas anti-bait-and-switch:
    //  1) dry_run: true  → retorna { would_delete[], count, total_value, confirmation_token }
    //                       confirmation_token = uuid de fin_delete_confirmations + hash dos ids
    //  2) dry_run: false → exige confirmation_token, valida hash, faz soft delete
    //
    // Filtros aceitos (mesmos do listar_lancamentos):
    //   ids[]  (deletar específicos por id, ignora outros filtros)
    //   start, end, tipo, status, account_id, categoria_id, cliente_id, fornecedor_id, view
    //
    // Limite: 50 items por chamada.
    // Source: por default só apaga source_type='api'. Token precisa ainda
    //         de scope financeiro:delete + opt-in `permitir_origem_externa: true`
    //         para apagar lançamentos manuais ou de import_csv.
    // Transferências: se filtro pegar uma ponta de transferência, a contraparte
    //                 é incluída automaticamente (saldos das contas não divergem).
    if (action === 'deletar_lancamento') {
      if (!hasScope(apiToken, 'financeiro:delete')) return json(req, { error: 'Permissão insuficiente. Token precisa de scope financeiro:delete.' }, 403)

      const dryRun = payload.dry_run !== false  // default true (segurança)
      const permitirExterno = payload.permitir_origem_externa === true
      const MAX_ITEMS = 50

      // ── Modo COMMIT: validar confirmation_token ANTES de qualquer trabalho ──
      let confirmationToken: string | null = null
      if (!dryRun) {
        confirmationToken = typeof payload.confirmation_token === 'string' ? payload.confirmation_token : null
        if (!confirmationToken) {
          const response = { error: 'confirmation_token obrigatório quando dry_run=false. Faça primeiro um dry_run.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 400)
        }
      }

      // ── Construir query de seleção (mesmos filtros do listar_lancamentos) ──
      const view: 'caixa' | 'competencia' = payload.view === 'caixa' ? 'caixa' : 'competencia'
      const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'
      const start = normalizeDateOnly(payload.start)
      const end = normalizeDateOnly(payload.end)

      const idsExplicitos: string[] = Array.isArray(payload.ids)
        ? payload.ids.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        : []

      let q = sb.from('fin_transacoes')
        .select('id, tipo, valor, descricao, status, competence_date, payment_date, account_id, source_type')
        .is('deleted_at', null)  // não tenta apagar o que já foi soft-deleted
        .order('id', { ascending: true })
        .limit(MAX_ITEMS + 1)  // +1 para detectar overflow

      if (idsExplicitos.length > 0) {
        if (idsExplicitos.length > MAX_ITEMS) {
          const response = { error: `Máximo ${MAX_ITEMS} ids por chamada. Recebidos: ${idsExplicitos.length}.` }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 400)
        }
        q = q.in('id', idsExplicitos)
      } else {
        // Sem ids explícitos → aplica filtros de busca
        if (start) q = q.gte(dateField, start)
        if (end) q = q.lte(dateField, end)
        if (payload.tipo === 'entrada' || payload.tipo === 'saida' || payload.tipo === 'transferencia') q = q.eq('tipo', payload.tipo)
        if (payload.status === 'confirmado' || payload.status === 'pendente') q = q.eq('status', payload.status)
        if (payload.account_id) q = q.eq('account_id', payload.account_id)
        if (payload.categoria_id) q = q.eq('categoria_id', payload.categoria_id)
        if (payload.cliente_id) q = q.eq('cliente_id', payload.cliente_id)
        if (payload.fornecedor_id) q = q.eq('fornecedor_id', payload.fornecedor_id)
        if (!permitirExterno) q = q.eq('source_type', 'api')
      }

      const { data: candidatos, error: selErr } = await q
      if (selErr) {
        const response = { error: 'Erro ao buscar lançamentos.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const matched = candidatos ?? []
      if (matched.length > MAX_ITEMS) {
        const response = {
          error: `Filtro retornou mais de ${MAX_ITEMS} itens. Refine os filtros ou use ids explícitos.`,
          count_estimado: matched.length,
        }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 400)
      }

      // ── Detecção de transferência em par ────────────────────────────────────
      // Se algum item for tipo='transferencia', busca a contraparte (mesmo
      // descricao + valor + data de competência, account_id diferente, ainda
      // não na lista) e adiciona à lista de delete.
      const transferenciasNaoCasadas: Array<typeof matched[0]> = []
      for (const t of matched) {
        if (t.tipo === 'transferencia') {
          // Verifica se contraparte já está na lista
          const temPar = matched.some((other) =>
            other.id !== t.id &&
            other.tipo === 'transferencia' &&
            other.descricao === t.descricao &&
            Number(other.valor) === Number(t.valor) &&
            other.competence_date === t.competence_date &&
            other.account_id !== t.account_id
          )
          if (!temPar) transferenciasNaoCasadas.push(t)
        }
      }

      const idsExtrasParesTransferencia: string[] = []
      if (transferenciasNaoCasadas.length > 0) {
        for (const t of transferenciasNaoCasadas) {
          const { data: par } = await sb.from('fin_transacoes')
            .select('id, tipo, valor, descricao, status, competence_date, payment_date, account_id, source_type')
            .is('deleted_at', null)
            .eq('tipo', 'transferencia')
            .eq('descricao', t.descricao)
            .eq('valor', t.valor)
            .eq('competence_date', t.competence_date)
            .neq('account_id', t.account_id)
            .neq('id', t.id)
            .limit(1)
            .maybeSingle()
          if (par && !matched.some((m) => m.id === par.id)) {
            matched.push(par)
            idsExtrasParesTransferencia.push(par.id)
          }
        }
      }

      // Ordena ids para hash determinístico
      const idsOrdenados = matched.map((m) => m.id).sort()
      const targetHash = await sha256Hex(idsOrdenados.join(','))
      const totalValue = matched.reduce((s, t) => s + Number(t.valor || 0), 0)

      // ── DRY-RUN: cria token de confirmação e retorna preview ───────────────
      if (dryRun) {
        if (matched.length === 0) {
          const response = { dry_run: true, count: 0, total_value: 0, would_delete: [], confirmation_token: null, expires_at: null, message: 'Nenhum lançamento encontrado com esses filtros.' }
          await safeAudit(sb, apiToken.id, req, action, 'success', body, { count: 0 })
          return json(req, response)
        }

        const filtrosSnapshot = {
          ids: idsExplicitos.length > 0 ? idsExplicitos : null,
          start, end,
          tipo: payload.tipo ?? null,
          status: payload.status ?? null,
          account_id: payload.account_id ?? null,
          categoria_id: payload.categoria_id ?? null,
          cliente_id: payload.cliente_id ?? null,
          fornecedor_id: payload.fornecedor_id ?? null,
          view,
          permitir_origem_externa: permitirExterno,
        }

        const insertConfirm = await sb.from('fin_delete_confirmations').insert({
          api_token_id: apiToken.id,
          target_ids: idsOrdenados,
          target_hash: targetHash,
          filtros_snapshot: filtrosSnapshot,
          total_value: totalValue,
        }).select('id, expires_at').single()

        if (insertConfirm.error || !insertConfirm.data) {
          const response = { error: 'Erro ao gerar token de confirmação.' }
          await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
          return json(req, response, 500)
        }

        const response = {
          dry_run: true,
          count: matched.length,
          total_value: totalValue,
          would_delete: matched.map((m) => ({
            id: m.id,
            tipo: m.tipo,
            descricao: m.descricao,
            valor: Number(m.valor),
            status: m.status,
            competence_date: m.competence_date,
            payment_date: m.payment_date,
            source_type: m.source_type,
          })),
          confirmation_token: insertConfirm.data.id,
          expires_at: insertConfirm.data.expires_at,
          transferencia_pares_inclusos: idsExtrasParesTransferencia,
          message: `${matched.length} lançamento(s) seriam apagados (R$ ${totalValue.toFixed(2)}). Para confirmar, chame de novo com dry_run:false e o confirmation_token retornado.`,
        }
        await safeAudit(sb, apiToken.id, req, action, 'success', body, { dry_run: true, count: matched.length, total_value: totalValue, confirmation_token: insertConfirm.data.id })
        return json(req, response)
      }

      // ── COMMIT: valida confirmation_token e aplica soft delete ─────────────
      const { data: confirmRow, error: confirmErr } = await sb
        .from('fin_delete_confirmations')
        .select('id, target_ids, target_hash, expires_at, consumed_at, api_token_id')
        .eq('id', confirmationToken!)
        .maybeSingle()

      if (confirmErr || !confirmRow) {
        const response = { error: 'confirmation_token inválido ou não encontrado.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 400)
      }
      if (confirmRow.api_token_id !== apiToken.id) {
        const response = { error: 'confirmation_token pertence a outro API token.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 403)
      }
      if (confirmRow.consumed_at) {
        const response = { error: 'confirmation_token já foi usado. Faça um novo dry_run.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 409)
      }
      if (new Date(confirmRow.expires_at).getTime() < Date.now()) {
        const response = { error: 'confirmation_token expirado. Faça um novo dry_run.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 410)
      }

      // Anti-bait-and-switch: re-aplicou filtros agora, gerou novo hash, compara com o gravado.
      if (targetHash !== confirmRow.target_hash) {
        const response = {
          error: 'Conjunto de IDs mudou desde o dry_run. Os filtros enviados agora retornam um conjunto diferente. Faça um novo dry_run para confirmar.',
          dry_run_target_hash: confirmRow.target_hash,
          current_target_hash: targetHash,
        }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 409)
      }

      // ── Soft delete + marcar confirmation como consumed ────────────────────
      const nowIso = new Date().toISOString()
      const { error: updErr } = await sb
        .from('fin_transacoes')
        .update({ deleted_at: nowIso, deleted_by_token_id: apiToken.id })
        .in('id', idsOrdenados)
      if (updErr) {
        const response = { error: 'Erro ao executar soft delete.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      // Marca confirmação como consumida (idempotência: não pode reusar)
      await sb.from('fin_delete_confirmations').update({ consumed_at: nowIso }).eq('id', confirmationToken!)

      const response = {
        dry_run: false,
        deleted_count: idsOrdenados.length,
        total_value: totalValue,
        deleted_ids: idsOrdenados,
        deleted_at: nowIso,
        message: `${idsOrdenados.length} lançamento(s) marcados como apagados (R$ ${totalValue.toFixed(2)}). Use restaurar_lancamento dentro de 30 dias para reverter.`,
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, { dry_run: false, deleted_count: idsOrdenados.length, total_value: totalValue, deleted_ids: idsOrdenados })
      return json(req, response)
    }

    // ─── restaurar_lancamento ────────────────────────────────────────────────
    // Reverte soft delete: deleted_at = NULL, deleted_by_token_id = NULL.
    // Aceita ids[] (no máximo MAX_ITEMS).
    // NÃO requer dry-run / confirmation_token (ação restauradora, não destrutiva).
    if (action === 'restaurar_lancamento') {
      if (!hasScope(apiToken, 'financeiro:delete')) return json(req, { error: 'Permissão insuficiente. Token precisa de scope financeiro:delete.' }, 403)

      const MAX_ITEMS = 50
      const ids: string[] = Array.isArray(payload.ids)
        ? payload.ids.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        : []
      if (ids.length === 0) {
        const response = { error: 'Informe ids: [<uuid>, ...] (lançamentos a restaurar).' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 400)
      }
      if (ids.length > MAX_ITEMS) {
        const response = { error: `Máximo ${MAX_ITEMS} ids por chamada.` }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 400)
      }

      // Só restaura o que está realmente soft-deleted
      const { data: alvo, error: selErr } = await sb
        .from('fin_transacoes')
        .select('id, descricao, valor, deleted_at')
        .in('id', ids)
        .not('deleted_at', 'is', null)
      if (selErr) {
        const response = { error: 'Erro ao buscar lançamentos.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const idsParaRestaurar = (alvo ?? []).map((a: any) => a.id)
      if (idsParaRestaurar.length === 0) {
        const response = {
          restored_count: 0,
          message: 'Nenhum dos ids informados está em estado deletado (já ativos ou não encontrados).',
        }
        await safeAudit(sb, apiToken.id, req, action, 'success', body, { restored_count: 0 })
        return json(req, response)
      }

      const { error: updErr } = await sb
        .from('fin_transacoes')
        .update({ deleted_at: null, deleted_by_token_id: null })
        .in('id', idsParaRestaurar)
      if (updErr) {
        const response = { error: 'Erro ao restaurar lançamentos.' }
        await safeAudit(sb, apiToken.id, req, action, 'error', body, response)
        return json(req, response, 500)
      }

      const totalValue = (alvo ?? []).reduce((s: number, a: any) => s + Number(a.valor || 0), 0)
      const response = {
        restored_count: idsParaRestaurar.length,
        restored_ids: idsParaRestaurar,
        total_value: totalValue,
        message: `${idsParaRestaurar.length} lançamento(s) restaurados (R$ ${totalValue.toFixed(2)}).`,
      }
      await safeAudit(sb, apiToken.id, req, action, 'success', body, response)
      return json(req, response)
    }

    return json(req, { error: 'Ação inválida.' }, 400)
  } catch (e: any) {
    console.error('[financeiro-openclaw]', e)
    if (apiToken?.id) {
      await safeAudit(sb, apiToken.id, req, body?.action || 'unknown', 'error', body, { error: String(e?.message || e) })
    }
    return json(req, { error: `Erro interno: ${String(e?.message || e)}` }, 500)
  }
})
