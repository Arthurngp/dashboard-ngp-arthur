import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession } from "../_shared/roles.ts"

type Intent = 'briefing' | 'risks' | 'forecast' | 'cashflow' | 'categorization' | 'unknown'
type Period = { start: string; end: string; label: string }
type Totals = {
  entradas: number
  saidas: number
  saldo: number
  pendenteEntrada: number
  pendenteSaida: number
}

const MODEL = Deno.env.get('FINANCEIRO_AGENT_MODEL') || 'gpt-4o-mini'

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function detectIntent(message: unknown): Intent {
  const text = normalizeText(message)
  if (!text) return 'briefing'
  if (['risco', 'alerta', 'atraso', 'vencid', 'inadimpl', 'problema'].some(t => text.includes(t))) return 'risks'
  if (['previs', 'projec', 'forecast', 'tendencia'].some(t => text.includes(t))) return 'forecast'
  if (['caixa', 'saldo', 'fluxo', 'cashflow', 'cash flow'].some(t => text.includes(t))) return 'cashflow'
  if (['categoria', 'categorizar', 'classifica', 'centro de custo'].some(t => text.includes(t))) return 'categorization'
  if (['briefing', 'resumo', 'painel', 'diagnostico'].some(t => text.includes(t))) return 'briefing'
  return 'unknown'
}

function buildPeriod(input: any): Period {
  const inputStart = normalizeDateOnly(input?.start)
  const inputEnd = normalizeDateOnly(input?.end)
  if (inputStart && inputEnd && inputStart <= inputEnd) {
    return { start: inputStart, end: inputEnd, label: input?.label?.trim() || `${inputStart} a ${inputEnd}` }
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
    label: 'Mês atual',
  }
}

function summarizeTotals(rows: any[]): Totals {
  return rows.reduce<Totals>((acc, row) => {
    const value = Math.abs(Number(row.valor || 0))
    if (!Number.isFinite(value)) return acc
    if (row.tipo === 'entrada') {
      if (row.status === 'pendente') acc.pendenteEntrada += value
      else acc.entradas += value
    } else if (row.tipo === 'saida') {
      if (row.status === 'pendente') acc.pendenteSaida += value
      else acc.saidas += value
    }
    acc.saldo = acc.entradas - acc.saidas
    return acc
  }, { entradas: 0, saidas: 0, saldo: 0, pendenteEntrada: 0, pendenteSaida: 0 })
}

function groupTopCategories(rows: any[], tipo: 'entrada' | 'saida') {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (row.tipo !== tipo) continue
    const name = row.categoria?.nome || (tipo === 'entrada' ? 'Receitas sem categoria' : 'Despesas sem categoria')
    totals.set(name, (totals.get(name) || 0) + Math.abs(Number(row.valor || 0)))
  }
  return Array.from(totals.entries())
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
}

function fallbackResponse(snapshot: any, intent: Intent) {
  const actions: string[] = []
  if (snapshot.totals.pendenteEntrada > 0) actions.push('Revisar entradas pendentes e priorizar cobranças de maior valor.')
  if (snapshot.totals.pendenteSaida > 0) actions.push('Conferir despesas pendentes antes de comprometer o saldo projetado.')
  if (snapshot.totals.saldo < 0) actions.push('Montar um plano de contenção para o período, porque o realizado está negativo.')
  if (!actions.length) actions.push('Manter rotina de conciliação e revisar novos lançamentos do período.')

  return {
    headline: 'Briefing financeiro preparado',
    resumo: `No período ${snapshot.period.label}, o realizado soma entradas de R$ ${snapshot.totals.entradas.toFixed(2)} e saídas de R$ ${snapshot.totals.saidas.toFixed(2)}.`,
    riscos: snapshot.overdue.length ? ['Há lançamentos pendentes vencidos no recorte analisado.'] : [],
    oportunidades: actions,
    proximas_acoes: actions,
    draft_actions: [],
    confidence: intent === 'unknown' ? 'medium' : 'high',
  }
}

function extractOpenAiText(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text
  const parts: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) parts.push(content.text)
      if (typeof content?.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

async function runAgent(snapshot: any, message: string, intent: Intent) {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return fallbackResponse(snapshot, intent)

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      resumo: { type: 'string' },
      riscos: { type: 'array', items: { type: 'string' } },
      oportunidades: { type: 'array', items: { type: 'string' } },
      proximas_acoes: { type: 'array', items: { type: 'string' } },
      draft_actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['review_transactions', 'categorize_transactions', 'collect_receivables', 'schedule_payables', 'create_report'] },
            title: { type: 'string' },
            rationale: { type: 'string' },
            payload: {
              type: 'object',
              additionalProperties: false,
              properties: {
                transaction_ids: { type: 'array', items: { type: 'string' } },
                account_id: { type: ['string', 'null'] },
                date_start: { type: ['string', 'null'] },
                date_end: { type: ['string', 'null'] },
                notes: { type: 'string' },
              },
              required: ['transaction_ids', 'account_id', 'date_start', 'date_end', 'notes'],
            },
            requires_human_approval: { type: 'boolean' },
          },
          required: ['type', 'title', 'rationale', 'payload', 'requires_human_approval'],
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['headline', 'resumo', 'riscos', 'oportunidades', 'proximas_acoes', 'draft_actions', 'confidence'],
  }

  const aiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: 'system',
          content: [{
            type: 'text',
            text: [
              'Você é o agente financeiro interno do NGP Space.',
              'Use apenas o snapshot financeiro fornecido. Não invente dados.',
              'Seja conservador: destaque riscos, inconsistências e próximos passos verificáveis.',
              'Nunca afirme que uma ação financeira foi executada. Use draft_actions apenas como propostas para aprovação humana.',
              'Responda em português do Brasil, com linguagem objetiva e operacional.',
            ].join(' '),
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'text',
            text: JSON.stringify({ intent, message, snapshot }),
          }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'financeiro_agent_response',
          schema,
          strict: true,
        },
      },
      max_output_tokens: 1000,
    }),
  })

  if (!aiRes.ok) return fallbackResponse(snapshot, intent)
  const raw = extractOpenAiText(await aiRes.json())
  if (!raw) return fallbackResponse(snapshot, intent)

  try {
    return JSON.parse(raw)
  } catch {
    return fallbackResponse(snapshot, intent)
  }
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, message = '', period: periodInput, account_id } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    const intent = detectIntent(message)
    const period = buildPeriod(periodInput)

    let txQuery = sb.from('fin_transacoes')
      .select([
        'id,tipo,descricao,valor,status,competence_date,payment_date,observacoes,account_id',
        'categoria:fin_categorias(id,nome,tipo)',
        'cliente:fin_clientes(id,nome)',
        'fornecedor:fin_fornecedores(id,nome)',
        'account:fin_accounts!inner(id,nome,tipo,ativo)',
        'cost_center:fin_cost_centers(id,nome)',
      ].join(','))
      .gte('competence_date', period.start)
      .lte('competence_date', period.end)
      .order('competence_date', { ascending: false })
      .limit(500)

    if (account_id) txQuery = txQuery.eq('account_id', account_id)
    else txQuery = txQuery.eq('account.ativo', true)

    const { data: transacoes, error: txError } = await txQuery
    if (txError) return json(req, { error: 'Erro ao buscar dados financeiros para o agente.' }, 500)

    let accountsQuery = sb.from('fin_accounts').select('id,nome,tipo,saldo_inicial').eq('ativo', true).order('nome')
    if (account_id) accountsQuery = accountsQuery.eq('id', account_id)
    const { data: accounts } = await accountsQuery

    const totals = summarizeTotals(transacoes ?? [])
    const today = new Date().toISOString().slice(0, 10)
    const overdue = (transacoes ?? [])
      .filter((tx: any) => tx.status === 'pendente' && (tx.payment_date || tx.competence_date) < today)
      .slice(0, 25)
      .map((tx: any) => ({
        id: tx.id,
        tipo: tx.tipo,
        descricao: tx.descricao,
        valor: Number(tx.valor || 0),
        date: tx.payment_date || tx.competence_date,
        contato: tx.cliente?.nome || tx.fornecedor?.nome || null,
      }))

    const snapshot = {
      generated_at: new Date().toISOString(),
      period,
      account_id: account_id || null,
      accounts: accounts ?? [],
      totals,
      top_receitas: groupTopCategories(transacoes ?? [], 'entrada'),
      top_despesas: groupTopCategories(transacoes ?? [], 'saida'),
      overdue,
      recent_transactions: (transacoes ?? []).slice(0, 30).map((tx: any) => ({
        id: tx.id,
        tipo: tx.tipo,
        descricao: tx.descricao,
        valor: Number(tx.valor || 0),
        status: tx.status,
        competence_date: tx.competence_date,
        payment_date: tx.payment_date,
        categoria: tx.categoria?.nome || null,
        conta: tx.account?.nome || null,
        centro_custo: tx.cost_center?.nome || null,
        contato: tx.cliente?.nome || tx.fornecedor?.nome || null,
      })),
    }

    const response = await runAgent(snapshot, String(message || ''), intent)
    const status = Deno.env.get('OPENAI_API_KEY') ? 'completed' : 'fallback'

    const { data: run } = await sb.from('fin_agent_runs').insert({
      usuario_id: user.usuario_id,
      intent,
      message: String(message || '') || null,
      period_start: period.start,
      period_end: period.end,
      account_id: account_id || null,
      snapshot,
      response,
      draft_actions: response.draft_actions || [],
      model: Deno.env.get('OPENAI_API_KEY') ? MODEL : null,
      status,
    }).select('id,created_at').single()

    return json(req, {
      run_id: run?.id || null,
      created_at: run?.created_at || null,
      intent,
      snapshot,
      response,
    })
  } catch (e) {
    console.error('[financeiro-agent]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
