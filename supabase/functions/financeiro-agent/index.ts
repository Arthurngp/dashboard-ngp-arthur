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
      // Prioriza output_text; se não, qualquer text string. Nunca os dois (duplicaria JSON).
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        parts.push(content.text)
      } else if (typeof content?.text === 'string') {
        parts.push(content.text)
      }
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
            type: 'input_text',
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
            type: 'input_text',
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

// ─── ANALISTA IA — helpers e runners ──────────────────────────────────────────
// 3 actions de análise IA (previsao, padroes, saude). Lacunas é SQL puro no
// frontend, não precisa de OpenAI. Cada runner monta um snapshot próprio e
// chama OpenAI com schema dedicado.

type AnalistaAction = 'analista_previsao' | 'analista_padroes' | 'analista_saude'

function isInternalTransfer(tx: any): boolean {
  const txt = [
    tx?.descricao,
    tx?.observacoes,
    tx?.categoria?.nome ?? tx?.categoria_nome,
  ].map((v) => String(v || '').toLowerCase()).join(' ')
  return (
    txt.includes('transfer') ||
    txt.includes('movimentacao entre contas') ||
    txt.includes('movimentação entre contas') ||
    txt.includes('movimentacao interna') ||
    txt.includes('entre contas')
  )
}

function todayISO(): string { return new Date().toISOString().slice(0, 10) }

function isoMonthsAgo(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function isoMonthsAhead(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months + 1)
  d.setDate(0)
  return d.toISOString().slice(0, 10)
}

type ViewMode = 'competencia' | 'caixa'

async function loadHistoricalSnapshot(sb: any, monthsBack: number, monthsAhead = 0, view: ViewMode = 'competencia') {
  const start = isoMonthsAgo(monthsBack)
  const end = monthsAhead > 0 ? isoMonthsAhead(monthsAhead) : todayISO()
  const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'

  // Faz paginação manual em chunks de 1000 para evitar limite implícito do PostgREST
  const all: any[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    let q = sb.from('fin_transacoes')
      .select('id,tipo,descricao,valor,status,competence_date,payment_date,observacoes,categoria_id,account_id,cliente_id,fornecedor_id,fin_categorias(nome,tipo),fin_accounts(nome,ativo,saldo_inicial)')
      .order(dateField, { ascending: true, nullsFirst: false })
      .range(offset, offset + pageSize - 1)
    if (view === 'caixa') {
      q = q.not('payment_date', 'is', null)
        .eq('status', 'confirmado')
        .gte('payment_date', start).lte('payment_date', end)
    } else {
      q = q.gte('competence_date', start).lte('competence_date', end)
    }
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return { rows: all, start, end, view }
}

function summarizeMonthly(rows: any[], view: ViewMode = 'competencia'): Array<{ ym: string; entradas: number; saidas: number; saldo: number; entradas_pendente: number; saidas_pendente: number }> {
  const map = new Map<string, { entradas: number; saidas: number; entradas_pendente: number; saidas_pendente: number }>()
  for (const r of rows) {
    if (isInternalTransfer({ descricao: r.descricao, observacoes: r.observacoes, categoria_nome: r.fin_categorias?.nome })) continue
    const dateRef = view === 'caixa' ? r.payment_date : r.competence_date
    const ym = String(dateRef || '').slice(0, 7)
    if (!ym) continue
    if (!map.has(ym)) map.set(ym, { entradas: 0, saidas: 0, entradas_pendente: 0, saidas_pendente: 0 })
    const slot = map.get(ym)!
    const v = Math.abs(Number(r.valor || 0))
    if (r.tipo === 'entrada') {
      if (r.status === 'pendente') slot.entradas_pendente += v
      else slot.entradas += v
    } else if (r.tipo === 'saida') {
      if (r.status === 'pendente') slot.saidas_pendente += v
      else slot.saidas += v
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => ({ ym, ...v, saldo: v.entradas - v.saidas }))
}

function topCategoriesAggregate(rows: any[], tipo: 'entrada' | 'saida', limit = 10) {
  const totals = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    if (r.tipo !== tipo) continue
    if (r.status !== 'confirmado') continue
    if (isInternalTransfer({ descricao: r.descricao, observacoes: r.observacoes, categoria_nome: r.fin_categorias?.nome })) continue
    const name = r.fin_categorias?.nome || 'Sem categoria'
    if (!totals.has(name)) totals.set(name, { total: 0, count: 0 })
    const slot = totals.get(name)!
    slot.total += Math.abs(Number(r.valor || 0))
    slot.count += 1
  }
  return Array.from(totals.entries())
    .map(([categoria, v]) => ({ categoria, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

async function callOpenAi(messages: any[], schema: any, schemaName: string, maxTokens: number): Promise<{ data: any | null; debug: any }> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return { data: null, debug: { stage: 'no_key' } }

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
      body: JSON.stringify({
        model: MODEL,
        input: messages,
        text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
        max_output_tokens: maxTokens,
      }),
    })
  } catch (e: any) {
    return { data: null, debug: { stage: 'fetch_failed', error: String(e?.message || e) } }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { data: null, debug: { stage: 'http_error', status: res.status, body: body.slice(0, 800) } }
  }

  let api: any
  try { api = await res.json() }
  catch (e: any) { return { data: null, debug: { stage: 'json_parse_top', error: String(e?.message || e) } } }

  const raw = extractOpenAiText(api)
  if (!raw) {
    return { data: null, debug: { stage: 'empty_output', api_status: api?.status, incomplete: api?.incomplete_details, output_count: api?.output?.length || 0 } }
  }

  try {
    const parsed = JSON.parse(raw)
    return { data: parsed, debug: { stage: 'ok', output_length: raw.length } }
  } catch (e: any) {
    return { data: null, debug: { stage: 'json_parse_inner', error: String(e?.message || e), raw_preview: raw.slice(0, 500) } }
  }
}

async function runAnalistaPrevisao(sb: any, userId: string, accountId: string | null, view: ViewMode = 'competencia') {
  const { rows } = await loadHistoricalSnapshot(sb, 12, 3, view)
  const monthly = summarizeMonthly(rows, view)
  const today = todayISO()

  // Pendentes futuras (potenciais receitas confirmáveis)
  const pendingFuture = rows
    .filter((r: any) => r.tipo === 'entrada' && r.status === 'pendente' && (r.payment_date || r.competence_date) >= today)
    .map((r: any) => ({
      data: r.payment_date || r.competence_date,
      valor: Math.abs(Number(r.valor || 0)),
      categoria: r.fin_categorias?.nome || null,
    }))
    .slice(0, 80)

  const snapshot = {
    today,
    view,
    monthly_history: monthly,
    pending_future_entries: pendingFuture,
    total_rows_consideradas: rows.length,
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      diagnosis: { type: 'string' },
      projected_3m_total: { type: 'number' },
      monthly_breakdown: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            month_label: { type: 'string' },
            projected_revenue: { type: 'number' },
            projected_expense: { type: 'number' },
            projected_net: { type: 'number' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['month_label', 'projected_revenue', 'projected_expense', 'projected_net', 'confidence'],
        },
      },
      drivers: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      next_actions: { type: 'array', items: { type: 'string' } },
      data_gaps: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['headline', 'diagnosis', 'projected_3m_total', 'monthly_breakdown', 'drivers', 'risks', 'next_actions', 'data_gaps', 'confidence'],
  }

  const messages = [
    {
      role: 'system',
      content: [{ type: 'input_text', text: [
        'Você é o analista financeiro sênior do NGP Space.',
        'Sua tarefa: projetar faturamento e resultado dos próximos 3 meses com base no histórico fornecido.',
        view === 'caixa'
          ? 'Os dados estão em REGIME DE CAIXA: cada lançamento é alocado ao mês em que foi PAGO. Não há pendentes. Use isso para projetar fluxo real de caixa, não DRE.'
          : 'Os dados estão em REGIME DE COMPETÊNCIA: cada lançamento é alocado ao mês de competência (DRE). Inclui pendentes. Use isso para projetar resultado contábil.',
        'Use APENAS os dados em snapshot. Nunca invente números.',
        'Considere recorrências evidentes no histórico (mesmo padrão se repete em meses consecutivos).',
        'Se o histórico for curto ou inconsistente, marque confidence=low e explique nas data_gaps.',
        'Responda em português do Brasil, objetivo e operacional. Não dê desculpas, dê números.',
      ].join(' ') }],
    },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(snapshot) }] },
  ]

  const { data: ai, debug } = await callOpenAi(messages, schema, 'analista_previsao_v1', 1500)
  return { snapshot, ai, debug }
}

async function runAnalistaPadroes(sb: any, userId: string, view: ViewMode = 'competencia') {
  const { rows } = await loadHistoricalSnapshot(sb, 6, 0, view)
  const topReceitas = topCategoriesAggregate(rows, 'entrada', 8)
  const topDespesas = topCategoriesAggregate(rows, 'saida', 12)
  const monthly = summarizeMonthly(rows, view)

  // Distribuição de saídas por dia da semana
  const dowSaidas = [0, 0, 0, 0, 0, 0, 0]
  for (const r of rows) {
    if (r.tipo !== 'saida' || r.status !== 'confirmado') continue
    if (isInternalTransfer({ descricao: r.descricao, observacoes: r.observacoes, categoria_nome: r.fin_categorias?.nome })) continue
    const date = r.payment_date || r.competence_date
    if (!date) continue
    const dow = new Date(date + 'T00:00:00Z').getUTCDay()
    dowSaidas[dow] += Math.abs(Number(r.valor || 0))
  }

  // Top 10 contrapartes (clientes/fornecedores) por valor
  const partyTotals = new Map<string, { tipo: string; total: number; count: number }>()
  for (const r of rows) {
    if (r.status !== 'confirmado') continue
    if (isInternalTransfer({ descricao: r.descricao, observacoes: r.observacoes, categoria_nome: r.fin_categorias?.nome })) continue
    // Sem nome do cliente/fornecedor por causa do select; será passado como id apenas — pular
  }

  const snapshot = {
    period_months: 6,
    view,
    monthly_summary: monthly,
    top_categorias_entrada: topReceitas,
    top_categorias_saida: topDespesas,
    saidas_por_dia_semana: { dom: dowSaidas[0], seg: dowSaidas[1], ter: dowSaidas[2], qua: dowSaidas[3], qui: dowSaidas[4], sex: dowSaidas[5], sab: dowSaidas[6] },
    total_rows: rows.length,
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      diagnosis: { type: 'string' },
      trends: { type: 'array', items: { type: 'string' } },
      hotspots: { type: 'array', items: { type: 'string' } },
      anomalies: { type: 'array', items: { type: 'string' } },
      next_actions: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['headline', 'diagnosis', 'trends', 'hotspots', 'anomalies', 'next_actions', 'confidence'],
  }

  const messages = [
    {
      role: 'system',
      content: [{ type: 'input_text', text: [
        'Você é o analista financeiro sênior do NGP Space.',
        'Sua tarefa: identificar padrões, gargalos e anomalias nos últimos 6 meses.',
        view === 'caixa'
          ? 'Os dados estão em REGIME DE CAIXA (mês = quando foi pago).'
          : 'Os dados estão em REGIME DE COMPETÊNCIA (mês = competência, inclui pendentes).',
        'Trends = tendências evolutivas (categoria crescendo/caindo, receita acelerando).',
        'Hotspots = onde está o dinheiro saindo (categorias caras, fornecedores caros, dia da semana concentrado).',
        'Anomalies = picos atípicos, valores muito acima da média, padrões quebrados.',
        'Use APENAS dados do snapshot. Cite números reais. Não dê conselhos genéricos.',
        'Responda em português do Brasil.',
      ].join(' ') }],
    },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(snapshot) }] },
  ]

  const { data: ai, debug } = await callOpenAi(messages, schema, 'analista_padroes_v1', 1500)
  return { snapshot, ai, debug }
}

async function runAnalistaSaude(sb: any, userId: string, view: ViewMode = 'competencia') {
  const { rows } = await loadHistoricalSnapshot(sb, 6, 0, view)
  const monthly = summarizeMonthly(rows, view)

  // Saldo atual = saldo_inicial das contas ativas + soma de confirmados de todo histórico
  const accountsRes = await sb.from('fin_accounts').select('id,nome,saldo_inicial,ativo').eq('ativo', true)
  const accounts = accountsRes.data || []
  const saldoInicial = accounts.reduce((s: number, a: any) => s + Number(a.saldo_inicial || 0), 0)

  // Total all-time confirmado para saldo atual
  const allTimeRes = await sb.from('fin_transacoes')
    .select('tipo,valor,status,descricao,observacoes,fin_categorias(nome)')
    .eq('status', 'confirmado')
  const allTime = allTimeRes.data || []
  let entradasAll = 0
  let saidasAll = 0
  for (const r of allTime) {
    if (isInternalTransfer({ descricao: r.descricao, observacoes: r.observacoes, categoria_nome: r.fin_categorias?.nome })) continue
    const v = Math.abs(Number(r.valor || 0))
    if (r.tipo === 'entrada') entradasAll += v
    else if (r.tipo === 'saida') saidasAll += v
  }
  const saldoAtual = saldoInicial + entradasAll - saidasAll

  // Burn médio = média mensal de saídas confirmadas dos últimos 3 meses fechados
  const today = new Date()
  const last3 = monthly.filter((m) => {
    const [y, mo] = m.ym.split('-').map(Number)
    const monthDate = new Date(y, mo - 1, 1)
    const cur = new Date(today.getFullYear(), today.getMonth(), 1)
    const diffMonths = (cur.getFullYear() - monthDate.getFullYear()) * 12 + (cur.getMonth() - monthDate.getMonth())
    return diffMonths >= 1 && diffMonths <= 3
  })
  const avgBurn = last3.length > 0 ? last3.reduce((s, m) => s + m.saidas, 0) / last3.length : 0
  const avgRevenue = last3.length > 0 ? last3.reduce((s, m) => s + m.entradas, 0) / last3.length : 0
  const avgNet = avgRevenue - avgBurn
  const margin = avgRevenue > 0 ? avgNet / avgRevenue : 0
  const runwayMonths = avgNet < 0 ? saldoAtual / Math.abs(avgNet) : null

  const snapshot = {
    view,
    saldo_atual: saldoAtual,
    saldo_inicial_total: saldoInicial,
    entradas_all_time_confirmadas: entradasAll,
    saidas_all_time_confirmadas: saidasAll,
    monthly_last_6: monthly,
    avg_revenue_last_3m: avgRevenue,
    avg_burn_last_3m: avgBurn,
    avg_net_last_3m: avgNet,
    margin_last_3m: margin,
    runway_months: runwayMonths,
    accounts_count: accounts.length,
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      diagnosis: { type: 'string' },
      status: { type: 'string', enum: ['healthy', 'warning', 'critical'] },
      runway_months: { type: ['number', 'null'] },
      monthly_burn: { type: 'number' },
      monthly_revenue: { type: 'number' },
      margin_pct: { type: 'number' },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      next_actions: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['headline', 'diagnosis', 'status', 'runway_months', 'monthly_burn', 'monthly_revenue', 'margin_pct', 'strengths', 'weaknesses', 'next_actions', 'confidence'],
  }

  const messages = [
    {
      role: 'system',
      content: [{ type: 'input_text', text: [
        'Você é o analista financeiro sênior do NGP Space.',
        'Sua tarefa: avaliar a saúde financeira atual.',
        view === 'caixa'
          ? 'Os dados mensais estão em REGIME DE CAIXA (mês = quando foi pago). Saldo atual é caixa real.'
          : 'Os dados mensais estão em REGIME DE COMPETÊNCIA (mês = competência, inclui pendentes). Saldo atual é caixa real.',
        'Status: healthy = margem positiva consistente; warning = margem zero/oscilante; critical = margem negativa ou runway curto.',
        'Não invente números. Use os fornecidos no snapshot.',
        'Se runway_months for null no snapshot, significa que avg_net é positivo (não há queima) — não diga que tem runway curto nesse caso.',
        'Atenção: as contas-lixo (NATHALLI, NGP, 5497380056655157) podem inflar saídas históricas. Avalie isso na confidence.',
        'Responda em português do Brasil.',
      ].join(' ') }],
    },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(snapshot) }] },
  ]

  const { data: ai, debug } = await callOpenAi(messages, schema, 'analista_saude_v1', 1200)
  return { snapshot, ai, debug }
}

async function persistAnalistaRun(sb: any, userId: string, action: AnalistaAction, snapshot: any, response: any | null) {
  const status = response ? 'completed' : 'fallback'
  const { data: run } = await sb.from('fin_agent_runs').insert({
    usuario_id: userId,
    intent: action,
    message: null,
    period_start: null,
    period_end: null,
    account_id: null,
    snapshot,
    response: response ?? { error: 'OpenAI indisponível ou retornou resposta inválida.' },
    draft_actions: [],
    model: response ? MODEL : null,
    status,
  }).select('id,created_at').single()
  return { run_id: run?.id || null, created_at: run?.created_at || null, status }
}

// ─── Fim helpers analista ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action, message = '', period: periodInput, account_id, view: viewInput } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    const analistaView: ViewMode = viewInput === 'caixa' ? 'caixa' : 'competencia'

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    // ─── DRE CASCATA: agrega valores por grupo contábil ───────────────────────
    if (action === 'dre_cascata') {
      const { ano, mes, view: viewRaw = 'competencia' } = body as { ano?: number; mes?: number | null; view?: string }
      const anoNum = Number(ano) || new Date().getFullYear()
      const mesNum = (typeof mes === 'number' && mes >= 1 && mes <= 12) ? mes : null
      const dreView: ViewMode = viewRaw === 'caixa' ? 'caixa' : 'competencia'

      let start: string, end: string, periodoLabel: string
      if (mesNum) {
        const mm = String(mesNum).padStart(2, '0')
        const lastDay = new Date(anoNum, mesNum, 0).getDate()
        start = `${anoNum}-${mm}-01`
        end = `${anoNum}-${mm}-${String(lastDay).padStart(2, '0')}`
        const monthsLabel = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
        periodoLabel = `${monthsLabel[mesNum - 1]} de ${anoNum}`
      } else {
        start = `${anoNum}-01-01`
        end = `${anoNum}-12-31`
        periodoLabel = `${anoNum}`
      }
      const dateField = dreView === 'caixa' ? 'payment_date' : 'competence_date'

      // Carrega transações com paginação (categoria + grupo_dre via join)
      const all: any[] = []
      let off = 0
      while (true) {
        let q = sb.from('fin_transacoes')
          .select('id,tipo,valor,status,competence_date,payment_date,categoria_id,fin_categorias(nome,grupo_dre),account:fin_accounts!inner(id,ativo)')
          .eq('account.ativo', true)
          .range(off, off + 999)
        if (dreView === 'caixa') {
          q = q.eq('status', 'confirmado').not('payment_date', 'is', null)
            .gte('payment_date', start).lte('payment_date', end)
        } else {
          q = q.gte('competence_date', start).lte('competence_date', end)
        }
        const { data, error } = await q
        if (error) return json(req, { error: 'Erro ao buscar transações DRE.' }, 500)
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < 1000) break
        off += 1000
      }

      // Agrega por grupo_dre
      type GroupAgg = { confirmado: number; pendente: number }
      const grupos: Record<string, GroupAgg> = {}
      const semGrupo: { categoria: string; total: number; count: number }[] = []
      const categoriasUsadas = new Map<string, { nome: string; grupo: string | null; tipo: string; total: number }>()

      for (const t of all) {
        const cat = (t as any).fin_categorias as { nome: string; grupo_dre: string | null } | null
        const grupo = cat?.grupo_dre || null
        const valor = Math.abs(Number(t.valor || 0))

        if (grupo) {
          if (!grupos[grupo]) grupos[grupo] = { confirmado: 0, pendente: 0 }
          if (t.status === 'confirmado') grupos[grupo].confirmado += valor
          else grupos[grupo].pendente += valor
        }

        // Tracking de categorias usadas para a tela de classificação
        if (t.categoria_id) {
          const key = t.categoria_id
          if (!categoriasUsadas.has(key)) {
            categoriasUsadas.set(key, {
              nome: cat?.nome || 'Sem nome',
              grupo: cat?.grupo_dre || null,
              tipo: t.tipo,
              total: 0,
            })
          }
          const slot = categoriasUsadas.get(key)!
          if (t.status === 'confirmado') slot.total += valor
        }
      }

      // Calcula linhas da cascata (igual estrutura do Controlle)
      const g = (k: string) => (grupos[k]?.confirmado || 0) + (grupos[k]?.pendente || 0)
      const gConf = (k: string) => grupos[k]?.confirmado || 0
      const gPend = (k: string) => grupos[k]?.pendente || 0

      const receitaOp = g('receita_operacional')
      const deducoes = g('deducao_receita')
      const receitaLiquida = receitaOp - deducoes

      const custoVar = g('custo_variavel')
      const lucroBruto = receitaLiquida - custoVar

      const despComercial = g('despesa_comercial')
      const despAdm = g('despesa_administrativa')
      const despPessoal = g('despesa_pessoal')
      const despOutras = g('despesa_outras')
      const totalDespOp = despComercial + despAdm + despPessoal + despOutras

      const lucroOp = lucroBruto - totalDespOp

      const recFin = g('receita_financeira')
      const despFin = g('despesa_financeira')
      const outRec = g('outras_receitas')
      const resultadoFin = recFin - despFin + outRec

      const lucroAntesIR = lucroOp + resultadoFin

      const impostoLucro = g('imposto_lucro')
      const proLabore = g('prolabore_dividendos')

      const resultadoFinal = lucroAntesIR - impostoLucro - proLabore

      // Margem
      const margemBruta = receitaLiquida > 0 ? lucroBruto / receitaLiquida : 0
      const margemOperacional = receitaLiquida > 0 ? lucroOp / receitaLiquida : 0
      const margemLiquida = receitaLiquida > 0 ? resultadoFinal / receitaLiquida : 0

      return json(req, {
        ano: anoNum,
        mes: mesNum,
        periodo_label: periodoLabel,
        view: dreView,
        cascata: {
          receita_operacional: { valor: receitaOp, confirmado: gConf('receita_operacional'), pendente: gPend('receita_operacional') },
          deducoes: { valor: deducoes, confirmado: gConf('deducao_receita'), pendente: gPend('deducao_receita') },
          receita_liquida: receitaLiquida,
          custo_variavel: { valor: custoVar, confirmado: gConf('custo_variavel'), pendente: gPend('custo_variavel') },
          lucro_bruto: lucroBruto,
          despesa_comercial: { valor: despComercial, confirmado: gConf('despesa_comercial'), pendente: gPend('despesa_comercial') },
          despesa_administrativa: { valor: despAdm, confirmado: gConf('despesa_administrativa'), pendente: gPend('despesa_administrativa') },
          despesa_pessoal: { valor: despPessoal, confirmado: gConf('despesa_pessoal'), pendente: gPend('despesa_pessoal') },
          despesa_outras: { valor: despOutras, confirmado: gConf('despesa_outras'), pendente: gPend('despesa_outras') },
          total_despesas_op: totalDespOp,
          lucro_operacional: lucroOp,
          receita_financeira: { valor: recFin, confirmado: gConf('receita_financeira'), pendente: gPend('receita_financeira') },
          despesa_financeira: { valor: despFin, confirmado: gConf('despesa_financeira'), pendente: gPend('despesa_financeira') },
          outras_receitas: { valor: outRec, confirmado: gConf('outras_receitas'), pendente: gPend('outras_receitas') },
          resultado_financeiro: resultadoFin,
          lucro_antes_ir: lucroAntesIR,
          imposto_lucro: { valor: impostoLucro, confirmado: gConf('imposto_lucro'), pendente: gPend('imposto_lucro') },
          prolabore_dividendos: { valor: proLabore, confirmado: gConf('prolabore_dividendos'), pendente: gPend('prolabore_dividendos') },
          resultado_final: resultadoFinal,
        },
        margens: {
          bruta: margemBruta,
          operacional: margemOperacional,
          liquida: margemLiquida,
        },
        total_transacoes: all.length,
      })
    }

    // ─── CATEGORIAS: lista todas com info do grupo + uso ──────────────────────
    if (action === 'categorias_listar_com_grupo') {
      const { data: cats } = await sb.from('fin_categorias')
        .select('id,nome,tipo,grupo_dre,ativo')
        .eq('ativo', true)
        .order('grupo_dre,tipo,nome' as any)

      // Calcula uso/total all-time confirmadas
      const useResults: any[] = []
      let off = 0
      while (true) {
        const { data } = await sb.from('fin_transacoes')
          .select('categoria_id,valor,status')
          .range(off, off + 1999)
        if (!data || data.length === 0) break
        useResults.push(...data)
        if (data.length < 2000) break
        off += 2000
      }
      const usoMap = new Map<string, { total: number; count: number }>()
      for (const t of useResults) {
        if (!t.categoria_id || t.status !== 'confirmado') continue
        if (!usoMap.has(t.categoria_id)) usoMap.set(t.categoria_id, { total: 0, count: 0 })
        const slot = usoMap.get(t.categoria_id)!
        slot.total += Math.abs(Number(t.valor || 0))
        slot.count += 1
      }

      const result = (cats || []).map((c: any) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        grupo_dre: c.grupo_dre,
        total: usoMap.get(c.id)?.total || 0,
        count: usoMap.get(c.id)?.count || 0,
      }))

      return json(req, { categorias: result })
    }

    // ─── CATEGORIAS: altera grupo_dre de uma categoria ────────────────────────
    if (action === 'categorias_set_grupo') {
      const { categoria_id: catId, grupo_dre: newGrupo } = body as { categoria_id?: string; grupo_dre?: string | null }
      if (!catId) return json(req, { error: 'categoria_id obrigatório.' }, 400)

      const allowedGrupos = [
        'receita_operacional', 'deducao_receita', 'custo_variavel',
        'despesa_comercial', 'despesa_administrativa', 'despesa_pessoal', 'despesa_outras',
        'receita_financeira', 'despesa_financeira', 'outras_receitas',
        'prolabore_dividendos', 'imposto_lucro', 'transferencia', 'ignorar',
      ]
      const grupo = newGrupo === null || newGrupo === '' ? null : (allowedGrupos.includes(String(newGrupo)) ? String(newGrupo) : null)
      if (newGrupo && !grupo) return json(req, { error: 'grupo_dre inválido.' }, 400)

      const upd = await sb.from('fin_categorias')
        .update({ grupo_dre: grupo })
        .eq('id', catId)
        .select('id,nome,grupo_dre')
        .single()
      if (upd.error) return json(req, { error: 'Erro ao atualizar categoria.' }, 500)
      return json(req, { ok: true, categoria: upd.data })
    }

    // ─── CARTÕES: lista cartões de crédito com fatura calculada ──────────────
    if (action === 'cartoes_listar') {
      const cartoesRes = await sb.from('fin_accounts')
        .select('id,nome,ativo,limite_credito,dia_fechamento,dia_vencimento,saldo_inicial,tipo')
        .in('tipo', ['cartao_credito', 'cartao'])
        .order('nome')
      const cartoes = cartoesRes.data || []
      if (cartoes.length === 0) return json(req, { cartoes: [] })

      const cartIds = cartoes.map((c: any) => c.id)

      // Busca todas as transações dos cartões — confirmadas e pendentes
      // (precisamos de pendentes pra calcular fatura aberta)
      const txAll: any[] = []
      let off = 0
      while (true) {
        const { data, error } = await sb.from('fin_transacoes')
          .select('id,tipo,valor,status,competence_date,payment_date,account_id')
          .in('account_id', cartIds)
          .range(off, off + 999)
        if (error) return json(req, { error: 'Erro ao buscar transações dos cartões.' }, 500)
        if (!data || data.length === 0) break
        txAll.push(...data)
        if (data.length < 1000) break
        off += 1000
      }

      const today = new Date()
      const todayISOStr = today.toISOString().slice(0, 10)

      // Calcula fatura "atual" de cada cartão.
      // Estratégia: se dia_fechamento estiver definido, soma saídas confirmadas/pendentes
      // entre [último fechamento] e hoje (aberto). Senão, soma do mês corrente.
      function lastClosingDate(diaFech: number | null): { start: string; end: string; label: string } {
        if (!diaFech || diaFech < 1 || diaFech > 31) {
          // Fallback: mês corrente
          const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
          const end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
          return { start, end, label: 'mês corrente (sem dia de fechamento)' }
        }
        const yr = today.getFullYear()
        const mo = today.getMonth()
        // O último fechamento foi: dia_fech do mês anterior (se hoje > dia_fech do mês atual, foi este mês)
        let closingY = yr, closingM = mo
        if (today.getDate() <= diaFech) {
          // Ainda não passou o fechamento deste mês — último foi mês passado
          closingM = mo - 1
          if (closingM < 0) { closingM = 11; closingY = yr - 1 }
        }
        const lastClosing = new Date(closingY, closingM, diaFech)
        const startDate = new Date(lastClosing); startDate.setDate(startDate.getDate() + 1)
        return { start: startDate.toISOString().slice(0, 10), end: todayISOStr, label: `${startDate.toLocaleDateString('pt-BR')} até hoje` }
      }

      const result = cartoes.map((c: any) => {
        const periodo = lastClosingDate(c.dia_fechamento)
        let faturaAtual = 0
        let faturaPendente = 0
        for (const t of txAll) {
          if (t.account_id !== c.id) continue
          const dRef = t.payment_date || t.competence_date
          if (!dRef || dRef < periodo.start || dRef > periodo.end) continue
          const v = Math.abs(Number(t.valor || 0))
          if (t.tipo === 'saida') {
            if (t.status === 'confirmado') faturaAtual += v
            else if (t.status === 'pendente') faturaPendente += v
          }
        }
        const limite = c.limite_credito != null ? Number(c.limite_credito) : null
        const limiteDisponivel = limite !== null ? limite - faturaAtual - faturaPendente : null
        return {
          id: c.id,
          nome: c.nome,
          ativo: c.ativo,
          limite_credito: limite,
          dia_fechamento: c.dia_fechamento,
          dia_vencimento: c.dia_vencimento,
          fatura_atual: faturaAtual,
          fatura_pendente: faturaPendente,
          fatura_total: faturaAtual + faturaPendente,
          limite_disponivel: limiteDisponivel,
          fatura_periodo: periodo,
        }
      })

      return json(req, { cartoes: result, computed_at: new Date().toISOString() })
    }

    // Helper: dado competence_date (YYYY-MM-DD) e dia_fechamento, devolve o
    // primeiro dia do mês de referência da fatura (YYYY-MM-01).
    function faturaMesRef(competenceISO: string, diaFech: number | null): string {
      const d = new Date(competenceISO + 'T00:00:00')
      let y = d.getFullYear()
      let m = d.getMonth()
      // Se passou do fechamento do mês, vai pra fatura seguinte.
      if (diaFech && d.getDate() > diaFech) {
        m += 1
        if (m > 11) { m = 0; y += 1 }
      }
      const mm = String(m + 1).padStart(2, '0')
      return `${y}-${mm}-01`
    }

    function mesRefLabel(mesRef: string): string {
      const d = new Date(mesRef + 'T00:00:00')
      return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    }

    // ─── CARTÕES: lista 12 faturas do cartão (status, valor) ─────────────────
    if (action === 'cartoes_faturas_listar') {
      const { cartao_id, ano } = body as { cartao_id?: string; ano?: number }
      if (!cartao_id) return json(req, { error: 'cartao_id é obrigatório.' }, 400)
      const anoNum = Number(ano) || new Date().getFullYear()

      const cartRes = await sb.from('fin_accounts')
        .select('id,nome,dia_fechamento,dia_vencimento,limite_credito')
        .eq('id', cartao_id)
        .in('tipo', ['cartao_credito', 'cartao'])
        .single()
      if (cartRes.error || !cartRes.data) return json(req, { error: 'Cartão não encontrado.' }, 404)
      const cart = cartRes.data

      // Carrega todas as transações do cartão (lib paginação).
      const txAll: any[] = []
      let off = 0
      while (true) {
        const { data, error } = await sb.from('fin_transacoes_ativas')
          .select('id,tipo,valor,status,competence_date,payment_date')
          .eq('account_id', cartao_id)
          .range(off, off + 999)
        if (error) return json(req, { error: 'Erro ao buscar transações do cartão.' }, 500)
        if (!data || data.length === 0) break
        txAll.push(...data)
        if (data.length < 1000) break
        off += 1000
      }

      // Status registrados (pagas) para o ano.
      const startAno = `${anoNum}-01-01`
      const endAno = `${anoNum}-12-01`
      const faturasRes = await sb.from('fin_cartao_faturas')
        .select('mes_ref,status,valor,valor_pago,paid_at,paid_account_id')
        .eq('cartao_id', cartao_id)
        .gte('mes_ref', startAno)
        .lte('mes_ref', endAno)
      const faturasMap = new Map<string, any>()
      for (const f of faturasRes.data || []) faturasMap.set(String(f.mes_ref), f)

      const meses = []
      for (let m = 0; m < 12; m++) {
        const mes_ref = `${anoNum}-${String(m + 1).padStart(2, '0')}-01`
        let valor = 0
        for (const t of txAll) {
          const dRef = t.competence_date
          if (!dRef) continue
          if (faturaMesRef(dRef, cart.dia_fechamento) !== mes_ref) continue
          const v = Math.abs(Number(t.valor || 0))
          if (t.tipo === 'saida') valor += v
          else if (t.tipo === 'entrada') valor -= v
        }
        const registrado = faturasMap.get(mes_ref)
        meses.push({
          mes_ref,
          label: mesRefLabel(mes_ref),
          valor,
          status: registrado?.status || 'aberta',
          valor_pago: Number(registrado?.valor_pago || 0),
          paid_at: registrado?.paid_at || null,
          paid_account_id: registrado?.paid_account_id || null,
        })
      }

      return json(req, {
        cartao: { id: cart.id, nome: cart.nome, dia_fechamento: cart.dia_fechamento, dia_vencimento: cart.dia_vencimento, limite_credito: cart.limite_credito != null ? Number(cart.limite_credito) : null },
        ano: anoNum,
        faturas: meses,
      })
    }

    // ─── CARTÕES: detalhe (lançamentos) de uma fatura específica ────────────
    if (action === 'cartoes_fatura_detalhe') {
      const { cartao_id, mes_ref } = body as { cartao_id?: string; mes_ref?: string }
      if (!cartao_id || !mes_ref) return json(req, { error: 'cartao_id e mes_ref são obrigatórios.' }, 400)
      if (!/^\d{4}-\d{2}-01$/.test(mes_ref)) return json(req, { error: 'mes_ref inválido (esperado YYYY-MM-01).' }, 400)

      const cartRes = await sb.from('fin_accounts')
        .select('id,nome,dia_fechamento,dia_vencimento,limite_credito')
        .eq('id', cartao_id)
        .in('tipo', ['cartao_credito', 'cartao'])
        .single()
      if (cartRes.error || !cartRes.data) return json(req, { error: 'Cartão não encontrado.' }, 404)
      const cart = cartRes.data

      const txAll: any[] = []
      let off = 0
      while (true) {
        const { data, error } = await sb.from('fin_transacoes_ativas')
          .select('id,tipo,descricao,valor,status,competence_date,payment_date,installment_index,installment_total,categoria:fin_categorias(id,nome,cor),fornecedor:fin_fornecedores(id,nome)')
          .eq('account_id', cartao_id)
          .range(off, off + 999)
        if (error) return json(req, { error: 'Erro ao buscar lançamentos do cartão.' }, 500)
        if (!data || data.length === 0) break
        txAll.push(...data)
        if (data.length < 1000) break
        off += 1000
      }

      const lancamentos = txAll
        .filter(t => t.competence_date && faturaMesRef(t.competence_date, cart.dia_fechamento) === mes_ref)
        .sort((a, b) => (a.competence_date || '').localeCompare(b.competence_date || ''))

      let totalSaidas = 0
      let totalEntradas = 0
      for (const t of lancamentos) {
        const v = Math.abs(Number(t.valor || 0))
        if (t.tipo === 'saida') totalSaidas += v
        else if (t.tipo === 'entrada') totalEntradas += v
      }

      // Saldo da fatura anterior (mês anterior, mesmo cartão).
      const mesRefD = new Date(mes_ref + 'T00:00:00')
      const anteriorD = new Date(mesRefD.getFullYear(), mesRefD.getMonth() - 1, 1)
      const anteriorISO = `${anteriorD.getFullYear()}-${String(anteriorD.getMonth() + 1).padStart(2, '0')}-01`
      const anteriorRes = await sb.from('fin_cartao_faturas')
        .select('valor,valor_pago,status')
        .eq('cartao_id', cartao_id)
        .eq('mes_ref', anteriorISO)
        .maybeSingle()
      const saldoAnterior = anteriorRes.data
        ? Number(anteriorRes.data.valor) - Number(anteriorRes.data.valor_pago)
        : 0

      const faturaRes = await sb.from('fin_cartao_faturas')
        .select('id,status,valor,valor_pago,paid_at,paid_account_id,observacoes')
        .eq('cartao_id', cartao_id)
        .eq('mes_ref', mes_ref)
        .maybeSingle()

      // Vencimento: dia_vencimento no mês ref (ou último dia se mês não tiver).
      let vencimento: string | null = null
      if (cart.dia_vencimento) {
        const vencD = new Date(mesRefD.getFullYear(), mesRefD.getMonth(), cart.dia_vencimento)
        // Se overflow (ex: 31 de fev), Date corrige para próximo mês — voltar p/ último dia do mês ref.
        if (vencD.getMonth() !== mesRefD.getMonth()) vencD.setDate(0)
        vencimento = vencD.toISOString().slice(0, 10)
      }

      return json(req, {
        cartao: { id: cart.id, nome: cart.nome, dia_fechamento: cart.dia_fechamento, dia_vencimento: cart.dia_vencimento, limite_credito: cart.limite_credito != null ? Number(cart.limite_credito) : null },
        mes_ref,
        label: mesRefLabel(mes_ref),
        vencimento,
        saldo_anterior: saldoAnterior,
        total_saidas: totalSaidas,
        total_entradas: totalEntradas,
        valor_fatura: totalSaidas - totalEntradas,
        fatura: faturaRes.data || null,
        lancamentos,
      })
    }

    // ─── CARTÕES: marcar fatura como paga ────────────────────────────────────
    // Cria uma saída na conta bancária + registra na fin_cartao_faturas.
    if (action === 'cartoes_fatura_marcar_paga') {
      const { cartao_id, mes_ref, paid_account_id, paid_at, valor_pago } = body as {
        cartao_id?: string; mes_ref?: string; paid_account_id?: string; paid_at?: string; valor_pago?: number
      }
      if (!cartao_id || !mes_ref || !paid_account_id) {
        return json(req, { error: 'cartao_id, mes_ref e paid_account_id são obrigatórios.' }, 400)
      }
      if (!/^\d{4}-\d{2}-01$/.test(mes_ref)) return json(req, { error: 'mes_ref inválido.' }, 400)

      const cartRes = await sb.from('fin_accounts')
        .select('id,nome,dia_fechamento')
        .eq('id', cartao_id)
        .in('tipo', ['cartao_credito', 'cartao'])
        .single()
      if (cartRes.error || !cartRes.data) return json(req, { error: 'Cartão não encontrado.' }, 404)

      // Calcula valor da fatura se não enviado.
      let valor = Number(valor_pago)
      if (!Number.isFinite(valor) || valor <= 0) {
        const txAll: any[] = []
        let off = 0
        while (true) {
          const { data, error } = await sb.from('fin_transacoes_ativas')
            .select('tipo,valor,competence_date')
            .eq('account_id', cartao_id)
            .range(off, off + 999)
          if (error) return json(req, { error: 'Erro ao buscar lançamentos do cartão.' }, 500)
          if (!data || data.length === 0) break
          txAll.push(...data)
          if (data.length < 1000) break
          off += 1000
        }
        let total = 0
        for (const t of txAll) {
          if (!t.competence_date) continue
          if (faturaMesRef(t.competence_date, cartRes.data.dia_fechamento) !== mes_ref) continue
          const v = Math.abs(Number(t.valor || 0))
          total += t.tipo === 'saida' ? v : (t.tipo === 'entrada' ? -v : 0)
        }
        valor = total
      }

      if (valor <= 0) return json(req, { error: 'Fatura sem valor positivo a pagar.' }, 400)

      const dataPag = paid_at && /^\d{4}-\d{2}-\d{2}$/.test(paid_at) ? paid_at : new Date().toISOString().slice(0, 10)

      // Cria a transação de pagamento da fatura (saída na conta bancária).
      // is_card_payment=true: marca como pagamento de fatura para não duplicar no DRE
      // (as despesas individuais do cartão já entram com suas categorias).
      const txInsert = await sb.from('fin_transacoes').insert({
        tipo: 'saida',
        descricao: `Pagamento fatura ${mesRefLabel(mes_ref)} — ${cartRes.data.nome}`,
        valor,
        data_transacao: dataPag,
        competence_date: dataPag,
        payment_date: dataPag,
        account_id: paid_account_id,
        status: 'confirmado',
        observacoes: null,
        created_by: user.usuario_id,
        is_card_payment: true,
      }).select('id').single()
      if (txInsert.error || !txInsert.data) return json(req, { error: 'Erro ao registrar pagamento.' }, 500)

      // Upsert na fin_cartao_faturas.
      const fatUpsert = await sb.from('fin_cartao_faturas').upsert({
        cartao_id, mes_ref,
        status: 'paga',
        valor,
        valor_pago: valor,
        paid_at: dataPag,
        paid_account_id,
        pagamento_tx_id: txInsert.data.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cartao_id,mes_ref' }).select().single()
      if (fatUpsert.error) {
        // rollback da tx
        await sb.from('fin_transacoes').delete().eq('id', txInsert.data.id)
        return json(req, { error: 'Erro ao registrar fatura paga.' }, 500)
      }

      return json(req, { fatura: fatUpsert.data, transacao_id: txInsert.data.id })
    }

    // ─── CARTÕES: marcar fatura como aberta (desfazer pagamento) ─────────────
    if (action === 'cartoes_fatura_marcar_aberta') {
      const { cartao_id, mes_ref } = body as { cartao_id?: string; mes_ref?: string }
      if (!cartao_id || !mes_ref) return json(req, { error: 'cartao_id e mes_ref são obrigatórios.' }, 400)

      const fatRes = await sb.from('fin_cartao_faturas')
        .select('id,pagamento_tx_id')
        .eq('cartao_id', cartao_id)
        .eq('mes_ref', mes_ref)
        .maybeSingle()
      if (!fatRes.data) return json(req, { ok: true })

      if (fatRes.data.pagamento_tx_id) {
        await sb.from('fin_transacoes').delete().eq('id', fatRes.data.pagamento_tx_id)
      }
      await sb.from('fin_cartao_faturas').update({
        status: 'aberta', valor_pago: 0, paid_at: null, paid_account_id: null, pagamento_tx_id: null, updated_at: new Date().toISOString(),
      }).eq('id', fatRes.data.id)
      return json(req, { ok: true })
    }

    // ─── DASHBOARD: alterna inclusão de uma conta no saldo geral ──────────────
    if (action === 'dashboard_toggle_saldo') {
      const { account_id: accId, incluir } = body as { account_id?: string; incluir?: boolean }
      if (!accId || typeof incluir !== 'boolean') {
        return json(req, { error: 'account_id e incluir (boolean) são obrigatórios.' }, 400)
      }
      const upd = await sb.from('fin_accounts')
        .update({ incluir_no_saldo: incluir })
        .eq('id', accId)
        .select('id,nome,incluir_no_saldo')
        .single()
      if (upd.error) return json(req, { error: 'Erro ao atualizar conta.' }, 500)
      return json(req, { ok: true, account: upd.data })
    }

    // ─── DASHBOARD: agrega saldos + top despesas + balanço em uma chamada ────
    if (action === 'dashboard_resumo') {
      const dashView: ViewMode = viewInput === 'caixa' ? 'caixa' : 'competencia'

      // Mês corrente
      const today = new Date()
      const ymStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
      const ymEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
      const dateField = dashView === 'caixa' ? 'payment_date' : 'competence_date'

      // 1) Saldos das contas ativas (saldo_inicial + soma de confirmados all-time, sem transferências internas)
      const accountsRes = await sb.from('fin_accounts').select('id,nome,tipo,saldo_inicial,ativo,incluir_no_saldo').eq('ativo', true).order('nome')
      const accounts = accountsRes.data || []

      // Carrega TODAS as transações confirmadas all-time (paginado)
      const allConfirmed: any[] = []
      let off = 0
      while (true) {
        const { data, error } = await sb.from('fin_transacoes')
          .select('id,tipo,valor,status,descricao,observacoes,account_id,competence_date,payment_date,categoria_id,fin_categorias(nome)')
          .eq('status', 'confirmado')
          .range(off, off + 999)
        if (error) return json(req, { error: 'Erro ao carregar transações.' }, 500)
        if (!data || data.length === 0) break
        allConfirmed.push(...data)
        if (data.length < 1000) break
        off += 1000
      }

      // Calcula saldo por conta (saldo_inicial + entradas - saídas, sem transferências para não dobrar)
      const saldoByAccount = new Map<string, number>()
      for (const a of accounts) saldoByAccount.set(a.id, Number(a.saldo_inicial || 0))
      for (const t of allConfirmed) {
        if (!t.account_id) continue
        // Note: transferências SÃO incluídas aqui porque saldo da conta precisa refletir movimentação real (sai de uma, entra em outra).
        const v = Math.abs(Number(t.valor || 0))
        const cur = saldoByAccount.get(t.account_id) || 0
        if (t.tipo === 'entrada') saldoByAccount.set(t.account_id, cur + v)
        else if (t.tipo === 'saida') saldoByAccount.set(t.account_id, cur - v)
      }

      const contas = accounts.map((a: any) => ({
        id: a.id,
        nome: a.nome,
        tipo: a.tipo,
        saldo: saldoByAccount.get(a.id) || 0,
        incluir_no_saldo: a.incluir_no_saldo !== false,
      })).sort((a: any, b: any) => {
        // Contas incluídas no saldo aparecem primeiro, depois ordenadas por |saldo|
        if (a.incluir_no_saldo !== b.incluir_no_saldo) return a.incluir_no_saldo ? -1 : 1
        return Math.abs(b.saldo) - Math.abs(a.saldo)
      })

      // Saldo geral = APENAS contas correntes com incluir_no_saldo=true (igual Controlle)
      const isContaCorrente = (t: string) => t === 'conta_corrente' || t === 'banco' // 'banco' é legado
      const saldoTotal = contas
        .filter((a: any) => a.incluir_no_saldo && isContaCorrente(a.tipo))
        .reduce((s: number, a: any) => s + a.saldo, 0)
      const saldoInvestimentos = contas
        .filter((a: any) => a.incluir_no_saldo && a.tipo === 'investimento')
        .reduce((s: number, a: any) => s + a.saldo, 0)
      const saldoPoupanca = contas
        .filter((a: any) => a.incluir_no_saldo && a.tipo === 'poupanca')
        .reduce((s: number, a: any) => s + a.saldo, 0)
      const contasInclusas = contas.filter((a: any) => a.incluir_no_saldo && isContaCorrente(a.tipo)).length
      const contasExcluidas = contas.filter((a: any) => !a.incluir_no_saldo).length

      // 2) Balanço do mês corrente — filtrado por regime, sem transferências internas
      let entMes = 0, saiMes = 0
      let entMesCount = 0, saiMesCount = 0
      const despPorCat = new Map<string, { total: number; count: number }>()

      for (const t of allConfirmed) {
        const dRef = dashView === 'caixa' ? t.payment_date : t.competence_date
        if (!dRef) continue
        if (dRef < ymStart || dRef > ymEnd) continue
        if (isInternalTransfer({ descricao: t.descricao, observacoes: t.observacoes, categoria_nome: t.fin_categorias?.nome })) continue
        const v = Math.abs(Number(t.valor || 0))
        if (t.tipo === 'entrada') { entMes += v; entMesCount++ }
        else if (t.tipo === 'saida') {
          saiMes += v; saiMesCount++
          const cat = t.fin_categorias?.nome || 'Sem categoria'
          if (!despPorCat.has(cat)) despPorCat.set(cat, { total: 0, count: 0 })
          const slot = despPorCat.get(cat)!
          slot.total += v
          slot.count += 1
        }
      }

      // 3) Top despesas do mês (com %)
      const topDespesas = Array.from(despPorCat.entries())
        .map(([categoria, v]) => ({ categoria, total: v.total, count: v.count, pct: saiMes > 0 ? v.total / saiMes : 0 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8)

      return json(req, {
        view: dashView,
        period: { start: ymStart, end: ymEnd, label: today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) },
        contas,
        saldo_total: saldoTotal,
        saldo_investimentos: saldoInvestimentos,
        saldo_poupanca: saldoPoupanca,
        contas_inclusas: contasInclusas,
        contas_excluidas: contasExcluidas,
        balanco_mes: {
          entradas: entMes,
          saidas: saiMes,
          resultado: entMes - saiMes,
          entradas_count: entMesCount,
          saidas_count: saiMesCount,
        },
        top_despesas: topDespesas,
        generated_at: new Date().toISOString(),
      })
    }

    // ─── DEBUG: confere se OPENAI_API_KEY está visível na edge ────────────────
    if (action === 'analista_debug_key') {
      const k = Deno.env.get('OPENAI_API_KEY')
      return json(req, {
        has_key: !!k,
        key_length: k ? k.length : 0,
        key_prefix: k ? k.slice(0, 7) : null,
        key_suffix: k ? k.slice(-4) : null,
        model: MODEL,
      })
    }

    // ─── DEBUG: faz uma chamada simples à OpenAI e devolve o erro real ────────
    if (action === 'analista_debug_openai') {
      const k = Deno.env.get('OPENAI_API_KEY')
      if (!k) return json(req, { ok: false, reason: 'no_key' })
      try {
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${k}`,
          },
          body: JSON.stringify({
            model: MODEL,
            input: [{ role: 'user', content: [{ type: 'input_text', text: 'Diga "ok" em pt-BR.' }] }],
            max_output_tokens: 20,
          }),
        })
        const text = await r.text()
        return json(req, {
          ok: r.ok,
          http_status: r.status,
          response_preview: text.slice(0, 800),
        })
      } catch (e: any) {
        return json(req, { ok: false, error: String(e?.message || e) })
      }
    }

    // ─── DEBUG: testa schema + max_tokens igual aos runners reais ─────────────
    if (action === 'analista_debug_schema') {
      const k = Deno.env.get('OPENAI_API_KEY')
      if (!k) return json(req, { ok: false, reason: 'no_key' })
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          headline: { type: 'string' },
          diagnosis: { type: 'string' },
          trends: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['headline', 'diagnosis', 'trends', 'confidence'],
      }
      try {
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` },
          body: JSON.stringify({
            model: MODEL,
            input: [
              { role: 'system', content: [{ type: 'input_text', text: 'Você é um analista. Responda em PT-BR.' }] },
              { role: 'user', content: [{ type: 'input_text', text: 'Resuma esta venda fictícia: R$ 100' }] },
            ],
            text: { format: { type: 'json_schema', name: 'debug_schema', schema, strict: true } },
            max_output_tokens: 1500,
          }),
        })
        const text = await r.text()
        return json(req, {
          ok: r.ok,
          http_status: r.status,
          response_preview: text.slice(0, 2000),
        })
      } catch (e: any) {
        return json(req, { ok: false, error: String(e?.message || e) })
      }
    }

    // ─── ROUTER: Analista IA (3 actions específicas) ──────────────────────────
    if (action === 'analista_previsao') {
      const { snapshot, ai, debug } = await runAnalistaPrevisao(sb, user.usuario_id, account_id || null, analistaView)
      const meta = await persistAnalistaRun(sb, user.usuario_id, 'analista_previsao', snapshot, ai)
      return json(req, { ...meta, action, view: analistaView, snapshot, response: ai, debug })
    }
    if (action === 'analista_padroes') {
      const { snapshot, ai, debug } = await runAnalistaPadroes(sb, user.usuario_id, analistaView)
      const meta = await persistAnalistaRun(sb, user.usuario_id, 'analista_padroes', snapshot, ai)
      return json(req, { ...meta, action, view: analistaView, snapshot, response: ai, debug })
    }
    if (action === 'analista_saude') {
      const { snapshot, ai, debug } = await runAnalistaSaude(sb, user.usuario_id, analistaView)
      const meta = await persistAnalistaRun(sb, user.usuario_id, 'analista_saude', snapshot, ai)
      return json(req, { ...meta, action, view: analistaView, snapshot, response: ai, debug })
    }
    if (action === 'analista_lacunas') {
      // Calculadora pura — não chama OpenAI. Retorna estatísticas de integridade.
      const baseRes = await sb.from('fin_transacoes').select('id,categoria_id,cliente_id,fornecedor_id,cost_center_id,competence_date,valor,tipo,account_id').limit(20000)
      const all = baseRes.data || []
      const today = new Date()
      const limFut = new Date(); limFut.setFullYear(today.getFullYear() + 3)
      const limPast = new Date(); limPast.setFullYear(today.getFullYear() - 5)
      const limFutISO = limFut.toISOString().slice(0, 10)
      const limPastISO = limPast.toISOString().slice(0, 10)

      let semCategoria = 0, entradaSemCli = 0, saidaSemForn = 0, semCC = 0, dataFut = 0, dataAnt = 0, valorZero = 0
      const contasUso = new Map<string, number>()
      for (const r of all) {
        if (!r.categoria_id) semCategoria++
        if (r.tipo === 'entrada' && !r.cliente_id) entradaSemCli++
        if (r.tipo === 'saida' && !r.fornecedor_id) saidaSemForn++
        if (!r.cost_center_id) semCC++
        if (r.competence_date && r.competence_date > limFutISO) dataFut++
        if (r.competence_date && r.competence_date < limPastISO) dataAnt++
        if (Number(r.valor) === 0) valorZero++
        if (r.account_id) contasUso.set(r.account_id, (contasUso.get(r.account_id) || 0) + 1)
      }

      // Contas órfãs = ativas mas com 0 lançamentos
      const accRes = await sb.from('fin_accounts').select('id,nome,ativo').eq('ativo', true)
      const accs = accRes.data || []
      const contasOrfas = accs.filter((a: any) => !contasUso.has(a.id)).map((a: any) => ({ nome: a.nome, qtd: 0 }))

      // Resumo de impacto em texto
      const issues: string[] = []
      if (semCategoria > 0) issues.push(`${semCategoria} sem categoria → DRE não vê`)
      if (entradaSemCli > 0) issues.push(`${entradaSemCli} entradas sem cliente → análise de receita por cliente fica incompleta`)
      if (saidaSemForn > 0) issues.push(`${saidaSemForn} saídas sem fornecedor → análise de fornecedores caros fica incompleta`)
      if (dataFut > 0) issues.push(`${dataFut} lançamentos com data > 3 anos no futuro (provisões muito longas)`)
      if (valorZero > 0) issues.push(`${valorZero} lançamentos com valor zero`)
      const impactSummary = issues.length === 0
        ? 'Nenhuma lacuna crítica detectada na base.'
        : issues.join(' · ')

      const result = {
        total_transacoes: all.length,
        sem_categoria: semCategoria,
        entrada_sem_cliente: entradaSemCli,
        saida_sem_fornecedor: saidaSemForn,
        sem_centro_custo: semCC,
        data_muito_futura: dataFut,
        data_muito_antiga: dataAnt,
        valor_zero: valorZero,
        contas_orfas: contasOrfas,
        impact_summary: impactSummary,
        computed_at: new Date().toISOString(),
      }
      return json(req, { lacunas: result })
    }
    if (action === 'analista_carregar_ultima') {
      // Retorna a última run de cada uma das 3 actions
      const intents: AnalistaAction[] = ['analista_previsao', 'analista_padroes', 'analista_saude']
      const results: Record<string, any> = {}
      for (const it of intents) {
        const { data } = await sb.from('fin_agent_runs')
          .select('id,intent,snapshot,response,model,status,created_at')
          .eq('intent', it)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        results[it] = data || null
      }
      return json(req, { latest: results })
    }
    // ─── Fim router analista ──────────────────────────────────────────────────

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
