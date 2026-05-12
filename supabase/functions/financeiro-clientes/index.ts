import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { normalizeDateOnly, normalizeText, parseCurrencyInput } from "../_shared/financeiro.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

function currentMonthReference(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

async function ensureSubscriptionTransaction(
  sb: any,
  clientId: string,
  clientName: string,
  userId: string,
  recurring: {
    mensalidade_valor: number | null
    mensalidade_descricao: string | null
    assinatura_ativa: boolean
  },
) {
  if (!recurring.assinatura_ativa || recurring.mensalidade_valor == null || recurring.mensalidade_valor <= 0) return

  const reference = currentMonthReference()
  const descricao = recurring.mensalidade_descricao || `Mensalidade ${clientName}`

  const existingResult = await sb.from('fin_transacoes')
    .select('id, status')
    .eq('assinatura_cliente_id', clientId)
    .eq('assinatura_referencia', reference)
    .maybeSingle()

  if (existingResult.error) throw existingResult.error

  if (!existingResult.data) {
    const insertResult = await sb.from('fin_transacoes').insert({
      tipo: 'entrada',
      descricao,
      valor: recurring.mensalidade_valor,
      data_transacao: reference,
      competence_date: reference,
      payment_date: null,
      status: 'pendente',
      cliente_id: clientId,
      assinatura_cliente_id: clientId,
      assinatura_referencia: reference,
      observacoes: 'Gerado automaticamente pela assinatura mensal do cliente.',
      created_by: userId,
    })
    if (insertResult.error) throw insertResult.error
    return
  }

  if (existingResult.data.status === 'pendente') {
    const updateResult = await sb.from('fin_transacoes')
      .update({
        descricao,
        valor: recurring.mensalidade_valor,
        cliente_id: clientId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingResult.data.id)

    if (updateResult.error) throw updateResult.error
  }
}

async function createPendingReceivableTransaction(
  sb: any,
  clientId: string,
  clientName: string,
  userId: string,
  receivable: {
    criar_recebimento_pendente: boolean
    recebimento_valor: number | null
    recebimento_descricao: string | null
    recebimento_competencia: string | null
  },
) {
  if (!receivable.criar_recebimento_pendente || receivable.recebimento_valor == null || receivable.recebimento_valor <= 0 || !receivable.recebimento_competencia) {
    return
  }

  const descricao = receivable.recebimento_descricao || `Recebimento pendente ${clientName}`

  const insertResult = await sb.from('fin_transacoes').insert({
    tipo: 'entrada',
    descricao,
    valor: receivable.recebimento_valor,
    data_transacao: receivable.recebimento_competencia,
    competence_date: receivable.recebimento_competencia,
    payment_date: null,
    status: 'pendente',
    cliente_id: clientId,
    observacoes: 'Gerado a partir do cadastro/edição do cliente.',
    created_by: userId,
  }).select('id').single()

  if (insertResult.error) throw insertResult.error
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
      const { data, error } = await sb.from('fin_clientes').select('*').eq('ativo', true).order('nome')
      if (error) return json(req, { error: 'Erro ao buscar clientes.' }, 500)
      return json(req, { clientes: data })
    }

    if (action === 'criar') {
      const {
        nome, documento, telefone, email, observacoes,
        mensalidade_valor, mensalidade_descricao, dia_cobranca, assinatura_ativa,
        criar_recebimento_pendente, recebimento_valor, recebimento_descricao, recebimento_competencia,
      } = payload
      const normalizedNome = normalizeText(nome)
      if (!normalizedNome) return json(req, { error: 'Nome é obrigatório.' }, 400)
      const recurring = parseRecurringPayload({ mensalidade_valor, mensalidade_descricao, dia_cobranca, assinatura_ativa })
      if (recurring.error) return json(req, { error: recurring.error }, 400)
      const receivable = parseReceivablePayload({ criar_recebimento_pendente, recebimento_valor, recebimento_descricao, recebimento_competencia })
      if (receivable.error) return json(req, { error: receivable.error }, 400)
      const { data, error } = await sb.from('fin_clientes').insert({
        nome: normalizedNome,
        documento: normalizeText(documento),
        telefone: normalizeText(telefone),
        email: normalizeText(email),
        observacoes: normalizeText(observacoes),
        ...recurring.values,
        created_by: user.usuario_id,
      }).select().single()
      if (error) return json(req, { error: 'Erro ao criar cliente.' }, 500)
      await ensureSubscriptionTransaction(sb, data.id, normalizedNome, user.usuario_id, recurring.values)
      await createPendingReceivableTransaction(sb, data.id, normalizedNome, user.usuario_id, receivable.values)
      return json(req, { cliente: data })
    }

    if (action === 'atualizar') {
      const {
        id, nome, documento, telefone, email, observacoes,
        mensalidade_valor, mensalidade_descricao, dia_cobranca, assinatura_ativa,
        criar_recebimento_pendente, recebimento_valor, recebimento_descricao, recebimento_competencia,
      } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const normalizedNome = normalizeText(nome)
      if (!normalizedNome) return json(req, { error: 'Nome é obrigatório.' }, 400)
      const recurring = parseRecurringPayload({ mensalidade_valor, mensalidade_descricao, dia_cobranca, assinatura_ativa })
      if (recurring.error) return json(req, { error: recurring.error }, 400)
      const receivable = parseReceivablePayload({ criar_recebimento_pendente, recebimento_valor, recebimento_descricao, recebimento_competencia })
      if (receivable.error) return json(req, { error: receivable.error }, 400)
      const { data, error } = await sb.from('fin_clientes').update({
        nome: normalizedNome,
        documento: normalizeText(documento),
        telefone: normalizeText(telefone),
        email: normalizeText(email),
        observacoes: normalizeText(observacoes),
        ...recurring.values,
      }).eq('id', id).select().single()
      if (error) return json(req, { error: 'Erro ao atualizar cliente.' }, 500)
      await ensureSubscriptionTransaction(sb, id, normalizedNome, user.usuario_id, recurring.values)
      await createPendingReceivableTransaction(sb, id, normalizedNome, user.usuario_id, receivable.values)
      return json(req, { cliente: data })
    }

    if (action === 'deletar') {
      const { id } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const { error } = await sb.from('fin_clientes').update({ ativo: false }).eq('id', id)
      if (error) return json(req, { error: 'Erro ao remover cliente.' }, 500)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[financeiro-clientes]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})

function parseRecurringPayload(payload: Record<string, unknown>) {
  const hasMensalidadeValor = payload.mensalidade_valor !== undefined && payload.mensalidade_valor !== null && payload.mensalidade_valor !== ''
  const mensalidadeValor = hasMensalidadeValor ? parseCurrencyInput(payload.mensalidade_valor) : null
  if (hasMensalidadeValor && (mensalidadeValor == null || mensalidadeValor <= 0)) {
    return { error: 'Valor da assinatura inválido.' }
  }

  const assinaturaAtiva = payload.assinatura_ativa === true
    || payload.assinatura_ativa === 'true'
    || payload.assinatura_ativa === 1

  const diaCobrancaRaw = payload.dia_cobranca
  const diaCobranca = diaCobrancaRaw == null || diaCobrancaRaw === ''
    ? null
    : Number(diaCobrancaRaw)

  if (diaCobranca != null && (!Number.isInteger(diaCobranca) || diaCobranca < 1 || diaCobranca > 31)) {
    return { error: 'Dia de cobrança inválido. Use um valor entre 1 e 31.' }
  }

  if (assinaturaAtiva && (mensalidadeValor == null || mensalidadeValor <= 0)) {
    return { error: 'Defina um valor mensal maior que zero para ativar a assinatura.' }
  }

  return {
    values: {
      mensalidade_valor: mensalidadeValor,
      mensalidade_descricao: normalizeText(payload.mensalidade_descricao),
      dia_cobranca: diaCobranca,
      assinatura_ativa: assinaturaAtiva,
    },
  }
}

function parseReceivablePayload(payload: Record<string, unknown>) {
  const criarRecebimentoPendente = payload.criar_recebimento_pendente === true
    || payload.criar_recebimento_pendente === 'true'
    || payload.criar_recebimento_pendente === 1

  const hasRecebimentoValor = payload.recebimento_valor !== undefined && payload.recebimento_valor !== null && payload.recebimento_valor !== ''
  const recebimentoValor = hasRecebimentoValor ? parseCurrencyInput(payload.recebimento_valor) : null
  if (hasRecebimentoValor && (recebimentoValor == null || recebimentoValor <= 0)) {
    return { error: 'Valor do recebimento pendente inválido.' }
  }

  const recebimentoCompetencia = payload.recebimento_competencia == null || payload.recebimento_competencia === ''
    ? null
    : normalizeDateOnly(payload.recebimento_competencia)
  if (criarRecebimentoPendente && (recebimentoValor == null || recebimentoValor <= 0)) {
    return { error: 'Defina um valor maior que zero para criar o recebimento pendente.' }
  }
  if (criarRecebimentoPendente && !recebimentoCompetencia) {
    return { error: 'Defina a data de competência do recebimento pendente.' }
  }

  return {
    values: {
      criar_recebimento_pendente: criarRecebimentoPendente,
      recebimento_valor: recebimentoValor,
      recebimento_descricao: normalizeText(payload.recebimento_descricao),
      recebimento_competencia: recebimentoCompetencia,
    },
  }
}
