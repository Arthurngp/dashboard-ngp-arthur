// @ts-nocheck
// ============================================================================
// NGP Copilot — sumarizador diário de aprendizado
//
// Entrada:
//   { session_token, client_id?, document_date? }
//   - Se client_id ausente: roda pra todos clientes que tiveram atividade no dia
//   - Se document_date ausente: usa "ontem" (UTC-3)
//
// Pra cada cliente alvo:
//   1. Coleta atividade do dia: messages, timeline events, asset ingestions,
//      agent_plans (aprovados/rejeitados/criados)
//   2. Manda pra IA gerar markdown estruturado
//   3. Upsert em daily_learning_documents (unique client_id + document_date)
//   4. Skip se já existe e status != 'generated' (não sobrescreve revisado)
//
// Pode ser chamada manualmente OU via cron. Se chamada sem client_id, processa
// em lote (até 50 clientes por execução pra não estourar timeout).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'
import { corsHeaders } from '../_shared/cors.ts'

const OPENAI_TIMEOUT_MS = 60_000
const MODEL = 'gpt-4o-mini'
const BATCH_LIMIT = 50
const TZ_OFFSET_HOURS = -3 // America/Sao_Paulo

function handleCors(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  return null
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}
function extractOpenAiText(data) {
  if (typeof data?.output_text === 'string') return data.output_text
  const parts = []
  for (const item of data?.output || []) for (const c of item?.content || []) {
    if (c?.type === 'output_text' && c?.text) parts.push(c.text)
    else if (typeof c?.text === 'string') parts.push(c.text)
  }
  return parts.join('\n').trim()
}

// Retorna [start, end] em ISO (UTC) representando o dia local (UTC-3)
function dayBoundariesUtc(dateYmd) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  // Início do dia local = 00:00 BRT = 03:00 UTC
  const startUtc = new Date(Date.UTC(y, m - 1, d, -TZ_OFFSET_HOURS, 0, 0, 0))
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000)
  return [startUtc.toISOString(), endUtc.toISOString()]
}

function yesterdayLocal() {
  // Hoje em BRT, menos 1 dia
  const nowUtc = new Date()
  const brt = new Date(nowUtc.getTime() + TZ_OFFSET_HOURS * 3600 * 1000)
  brt.setUTCDate(brt.getUTCDate() - 1)
  return brt.toISOString().slice(0, 10)
}

async function collectActivity(sb, clientId, startIso, endIso) {
  const [msgs, events, assets, plans] = await Promise.all([
    sb.from('copilot_messages')
      .select('role, kind, texto, created_at, autor_usuario_id')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .gte('created_at', startIso).lt('created_at', endIso)
      .order('created_at', { ascending: true }),
    sb.from('client_timeline_events')
      .select('event_type, title, description, motivador, resultado_esperado, resultado_observado, hypothesis_status, event_at, created_by_agent')
      .eq('client_id', clientId)
      .gte('event_at', startIso).lt('event_at', endIso)
      .order('event_at', { ascending: true }),
    sb.from('campaign_assets')
      .select('asset_type, label, extracted_summary, created_at')
      .eq('client_id', clientId)
      .gte('created_at', startIso).lt('created_at', endIso)
      .order('created_at', { ascending: true }),
    sb.from('agent_plans')
      .select('plan_type, title, status, confidence, impact_scope, decision_note, decided_at, created_at')
      .eq('client_id', clientId)
      .gte('created_at', startIso).lt('created_at', endIso)
      .order('created_at', { ascending: true }),
  ])

  return {
    messages: msgs.data || [],
    events: events.data || [],
    assets: assets.data || [],
    plans: plans.data || [],
  }
}

const SYSTEM_PROMPT = `Você é o redator do diário de operação do NGP Copilot. Gera um documento markdown estruturado a partir da atividade de UM cliente em UM dia.

REGRAS:
- Português brasileiro, direto, sem floreio.
- Markdown limpo: headings ## e ###, listas com -, sem HTML.
- Foco em INFORMAÇÃO ACIONÁVEL, não relato cronológico.
- Se o dia foi inexpressivo, dê uma linha só. Não force conteúdo.

ESTRUTURA OBRIGATÓRIA:
## Resumo do dia
1-3 frases sobre o que de mais importante aconteceu.

## Decisões e alterações
Lista de decisões/alterações com motivador. Vazio se não houve.

## Aprendizados
O que ficou claro hoje sobre o cliente, mercado, criativo ou operação.

## Hipóteses em aberto
Hipóteses levantadas hoje que ainda não foram validadas.

## Riscos / atenções
Algo a observar nos próximos dias.

## Próximos passos sugeridos
1-5 ações específicas pra amanhã/semana.`

async function generateMarkdown(openAiKey, clienteNome, dateYmd, activity) {
  const stats = {
    messages: activity.messages.length,
    events: activity.events.length,
    assets: activity.assets.length,
    plans: activity.plans.length,
  }

  const ctxParts = [`CLIENTE: ${clienteNome}`, `DATA: ${dateYmd}`, '']

  if (activity.messages.length) {
    ctxParts.push('## CONVERSAS DO DIA')
    for (const m of activity.messages.slice(0, 60)) {
      const role = m.role === 'agent' ? 'IA' : m.role === 'user' ? 'Equipe' : 'Sistema'
      ctxParts.push(`- [${role}] ${(m.texto || '').slice(0, 300)}`)
    }
    ctxParts.push('')
  }

  if (activity.events.length) {
    ctxParts.push('## EVENTOS DA TIMELINE')
    for (const e of activity.events) {
      const who = e.created_by_agent ? 'IA' : 'humano'
      ctxParts.push(`- [${e.event_type}] (${who}) ${e.title}`)
      if (e.motivador) ctxParts.push(`  motivador: ${e.motivador}`)
      if (e.resultado_esperado) ctxParts.push(`  esperado: ${e.resultado_esperado}`)
      if (e.description) ctxParts.push(`  detalhe: ${e.description.slice(0, 200)}`)
    }
    ctxParts.push('')
  }

  if (activity.assets.length) {
    ctxParts.push('## ANEXOS INGERIDOS')
    for (const a of activity.assets) {
      ctxParts.push(`- [${a.asset_type}] ${a.label || ''}`)
      if (a.extracted_summary) ctxParts.push(`  resumo: ${a.extracted_summary.slice(0, 300)}`)
    }
    ctxParts.push('')
  }

  if (activity.plans.length) {
    ctxParts.push('## PROPOSTAS DA IA (agent_plans)')
    for (const p of activity.plans) {
      ctxParts.push(`- [${p.plan_type}] (${p.status}, conf=${p.confidence}, ${p.impact_scope}) ${p.title}`)
      if (p.decision_note) ctxParts.push(`  decisão: ${p.decision_note}`)
    }
  }

  const ctx = ctxParts.join('\n')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: MODEL,
      max_output_tokens: 1500,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: ctx }] },
      ],
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Summarizer falhou (${res.status})`)
  const md = extractOpenAiText(data)
  if (!md) throw new Error('IA retornou vazio')
  return { markdown: md, stats }
}

async function processClient(sb, openAiKey, clientId, dateYmd) {
  const [startIso, endIso] = dayBoundariesUtc(dateYmd)

  // Pega nome
  const { data: cli } = await sb.from('clientes').select('nome').eq('id', clientId).maybeSingle()
  if (!cli) return { client_id: clientId, status: 'skipped', reason: 'client_not_found' }

  // Se já existe e foi revisado, não sobrescreve
  const { data: existing } = await sb.from('daily_learning_documents')
    .select('id, status').eq('client_id', clientId).eq('document_date', dateYmd).maybeSingle()
  if (existing && existing.status !== 'generated') {
    return { client_id: clientId, status: 'skipped', reason: 'already_reviewed' }
  }

  const activity = await collectActivity(sb, clientId, startIso, endIso)
  const totalActivity = activity.messages.length + activity.events.length + activity.assets.length + activity.plans.length
  if (totalActivity === 0) {
    return { client_id: clientId, status: 'skipped', reason: 'no_activity' }
  }

  const { markdown, stats } = await generateMarkdown(openAiKey, cli.nome, dateYmd, activity)

  const upsertPayload = {
    client_id: clientId,
    document_date: dateYmd,
    title: `Diário ${cli.nome} — ${dateYmd}`,
    summary_markdown: markdown,
    status: 'generated',
    generated_by_model: MODEL,
    stats_json: stats,
    is_editable: true,
  }

  const { data: upserted, error: upErr } = await sb
    .from('daily_learning_documents')
    .upsert(upsertPayload, { onConflict: 'client_id,document_date' })
    .select('id')
    .single()

  if (upErr) throw new Error(`Upsert daily_learning_documents falhou: ${upErr.message}`)

  return { client_id: clientId, status: 'generated', document_id: upserted.id, stats }
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
    const body = await req.json().catch(() => ({}))
    const { session_token, client_id, document_date } = body || {}
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (user.role !== 'admin' && user.role !== 'ngp') return json(req, { error: 'Apenas equipe NGP.' }, 403)

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'OPENAI_API_KEY não configurada.' }, 500)

    const targetDate = (typeof document_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(document_date))
      ? document_date
      : yesterdayLocal()

    if (client_id) {
      const result = await processClient(sb, openAiKey, client_id, targetDate)
      return json(req, { date: targetDate, results: [result] })
    }

    // Batch: clientes com atividade nesse dia
    const [startIso, endIso] = dayBoundariesUtc(targetDate)
    const { data: activeClients, error: actErr } = await sb
      .from('copilot_messages')
      .select('client_id')
      .gte('created_at', startIso).lt('created_at', endIso)
      .limit(500)
    if (actErr) return json(req, { error: `Falha ao listar clientes ativos: ${actErr.message}` }, 500)

    const uniqueClients = [...new Set((activeClients || []).map(r => r.client_id))].slice(0, BATCH_LIMIT)

    const results = []
    for (const cid of uniqueClients) {
      try {
        const r = await processClient(sb, openAiKey, cid, targetDate)
        results.push(r)
      } catch (e) {
        results.push({ client_id: cid, status: 'failed', error: e?.message || String(e) })
      }
    }

    return json(req, { date: targetDate, processed: uniqueClients.length, results })
  } catch (e) {
    console.error('[copilot-daily-summarizer]', e?.message || e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
