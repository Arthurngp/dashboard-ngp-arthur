// @ts-nocheck
// ============================================================================
// NGP Copilot — compactador semanal de perfil do cliente
//
// Entrada:
//   { session_token, client_id?, window_days?=14 }
//   - Se client_id ausente: roda pra todos clientes com atividade recente
//   - window_days: janela de leitura (padrão 14 dias)
//
// Pra cada cliente:
//   1. Lê profile atual
//   2. Lê daily_learning_documents da janela
//   3. Lê eventos significativos (decisao, hipotese_confirmada, etc) da janela
//   4. Pede pra IA reescrever profile consolidando tudo
//   5. Cria agent_plan tipo memory_update em pending_approval
//      (você aprova manualmente — não sobrescreve direto)
//
// IMPORTANTE: nunca aplica direto. Sempre vira plano pendente.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'
import { corsHeaders } from '../_shared/cors.ts'

const OPENAI_TIMEOUT_MS = 60_000
const MODEL = 'gpt-4o-mini'
const DEFAULT_WINDOW_DAYS = 14
const BATCH_LIMIT = 30

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

const SYSTEM_PROMPT = `Você é o compactador de memória do NGP Copilot. Sua função é REESCREVER o perfil persistente de UM cliente, consolidando aprendizados recentes.

REGRAS DE OURO:
- Português brasileiro, denso, sem floreio. Cada campo é lido por IA depois — economize palavras.
- INFORMAÇÃO ACUMULA. Não jogue fora o que já estava no perfil só porque a janela recente não menciona.
- INFORMAÇÃO MAIS RECENTE GANHA quando há conflito direto.
- Se um campo não tem informação relevante, devolva null pra ele.
- channel_notes é texto livre por canal. Use chaves "meta", "google", "notas_gerais".

CAMPOS QUE VOCÊ PRODUZ:
- executive_summary: 2-4 frases. O que esse cliente é, faz, e qual o momento atual da operação.
- service_scope: 1-3 frases. O que a NGP entrega pra ele hoje.
- business_context: nicho, modelo de negócio, tamanho, sazonalidade. 2-4 frases.
- offer_context: oferta atual sendo vendida. 1-3 frases.
- icp_context: público-alvo principal. 1-3 frases.
- channel_notes: { meta: "...", google: "...", notas_gerais: "..." } — aprendizados acumulados por canal. Strings curtas.
- operational_rules: regras específicas dessa conta (ex: "não usar imagens de mulheres muito magras", "Advantage+ piora aqui"). Lista em texto.
- risks: pontos de atenção, fragilidades, riscos conhecidos. 1-3 itens.

FORMATO DE RESPOSTA (JSON estrito):
{
  "confidence": 0.0 a 1.0,
  "summary_of_changes": "1-3 frases sobre o que MUDOU em relação ao perfil anterior",
  "after": { todos os campos acima, cada um string ou null }
}`

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confidence: { type: 'number' },
    summary_of_changes: { type: 'string' },
    after: {
      type: 'object',
      additionalProperties: false,
      properties: {
        executive_summary: { type: ['string', 'null'] },
        service_scope: { type: ['string', 'null'] },
        business_context: { type: ['string', 'null'] },
        offer_context: { type: ['string', 'null'] },
        icp_context: { type: ['string', 'null'] },
        channel_notes: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            meta: { type: ['string', 'null'] },
            google: { type: ['string', 'null'] },
            notas_gerais: { type: ['string', 'null'] },
          },
          required: ['meta', 'google', 'notas_gerais'],
        },
        operational_rules: { type: ['string', 'null'] },
        risks: { type: ['string', 'null'] },
      },
      required: ['executive_summary', 'service_scope', 'business_context', 'offer_context', 'icp_context', 'channel_notes', 'operational_rules', 'risks'],
    },
  },
  required: ['confidence', 'summary_of_changes', 'after'],
}

async function gatherEvidence(sb, clientId, windowDays) {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString()
  const [profileRes, dailyRes, eventsRes] = await Promise.all([
    sb.from('client_memory_profiles').select('*').eq('client_id', clientId).maybeSingle(),
    sb.from('daily_learning_documents').select('document_date, summary_markdown')
      .eq('client_id', clientId).gte('document_date', since.slice(0, 10))
      .order('document_date', { ascending: false }).limit(14),
    sb.from('client_timeline_events').select('event_type, title, description, motivador, resultado_esperado, resultado_observado, hypothesis_status, event_at')
      .eq('client_id', clientId).gte('event_at', since)
      .in('event_type', ['decisao', 'feedback_cliente', 'alteracao_aprovada', 'hipotese_levantada', 'resultado_observado', 'memory_update', 'asset_ingerido'])
      .order('event_at', { ascending: false }).limit(80),
  ])

  return {
    profile: profileRes.data || null,
    daily: dailyRes.data || [],
    events: eventsRes.data || [],
  }
}

function buildEvidenceText(clienteNome, evidence) {
  const parts = [`CLIENTE: ${clienteNome}`, '']

  parts.push('## PERFIL ATUAL (estado vigente — base)')
  if (evidence.profile) {
    const p = evidence.profile
    if (p.executive_summary) parts.push(`executive_summary: ${p.executive_summary}`)
    if (p.service_scope) parts.push(`service_scope: ${p.service_scope}`)
    if (p.business_context) parts.push(`business_context: ${p.business_context}`)
    if (p.offer_context) parts.push(`offer_context: ${p.offer_context}`)
    if (p.icp_context) parts.push(`icp_context: ${p.icp_context}`)
    if (p.operational_rules) parts.push(`operational_rules: ${p.operational_rules}`)
    if (p.risks) parts.push(`risks: ${p.risks}`)
    if (p.channel_notes && Object.keys(p.channel_notes).length) parts.push(`channel_notes: ${JSON.stringify(p.channel_notes)}`)
  } else {
    parts.push('(perfil ainda vazio — primeira compactação)')
  }
  parts.push('')

  if (evidence.daily.length) {
    parts.push('## DIÁRIOS DA JANELA (mais recentes primeiro)')
    for (const d of evidence.daily) {
      parts.push(`### ${d.document_date}`)
      parts.push(d.summary_markdown.slice(0, 1500))
      parts.push('')
    }
  }

  if (evidence.events.length) {
    parts.push('## EVENTOS RELEVANTES DA TIMELINE')
    for (const e of evidence.events) {
      const dateStr = e.event_at ? e.event_at.slice(0, 10) : ''
      const hStatus = e.hypothesis_status && e.hypothesis_status !== 'na' ? ` [hipótese: ${e.hypothesis_status}]` : ''
      parts.push(`- ${dateStr} [${e.event_type}]${hStatus} ${e.title}`)
      if (e.description) parts.push(`  ${e.description}`)
      if (e.motivador) parts.push(`  motivador: ${e.motivador}`)
      if (e.resultado_esperado) parts.push(`  esperado: ${e.resultado_esperado}`)
      if (e.resultado_observado) parts.push(`  observado: ${e.resultado_observado}`)
    }
  }

  return parts.join('\n')
}

async function callOpenAi(openAiKey, evidenceText) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_output_tokens: 2000,
      text: {
        format: {
          type: 'json_schema',
          name: 'profile_compaction',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: evidenceText }] },
      ],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI falhou (${res.status})`)
  const raw = extractOpenAiText(data)
  if (!raw) throw new Error('IA retornou vazio')
  try { return { parsed: JSON.parse(raw), runId: data?.id || null } }
  catch (_) { throw new Error('IA retornou JSON inválido') }
}

async function processClient(sb, openAiKey, clientId, windowDays, userId) {
  const { data: cli } = await sb.from('clientes').select('nome').eq('id', clientId).maybeSingle()
  if (!cli) return { client_id: clientId, status: 'skipped', reason: 'client_not_found' }

  const evidence = await gatherEvidence(sb, clientId, windowDays)
  const totalEvidence = evidence.daily.length + evidence.events.length
  if (totalEvidence === 0 && !evidence.profile) {
    return { client_id: clientId, status: 'skipped', reason: 'no_evidence_and_no_profile' }
  }

  // Evita duplicar compactações na mesma janela: se há plan recente pendente, pula
  const recentSince = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString()
  const { data: existingPlan } = await sb.from('agent_plans')
    .select('id').eq('client_id', clientId).eq('plan_type', 'memory_update')
    .in('status', ['pending_approval', 'draft'])
    .gte('created_at', recentSince)
    .like('title', 'Compactação semanal%')
    .maybeSingle()
  if (existingPlan) {
    return { client_id: clientId, status: 'skipped', reason: 'pending_compaction_exists', plan_id: existingPlan.id }
  }

  const evidenceText = buildEvidenceText(cli.nome, evidence)
  const { parsed, runId } = await callOpenAi(openAiKey, evidenceText)

  const beforeSnapshot = evidence.profile || {}
  const planPayload = {
    client_id: clientId,
    plan_type: 'memory_update',
    impact_scope: 'soft',
    title: `Compactação semanal — ${cli.nome}`,
    reasoning_summary: parsed.summary_of_changes || 'Compactação periódica',
    proposal_json: { before: beforeSnapshot, after: parsed.after, source: 'compactor' },
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    needs_escalation: false,
    agent_model: MODEL,
    agent_run_id: runId,
  }

  const { data: plan, error: planErr } = await sb.from('agent_plans')
    .insert(planPayload).select('id').single()
  if (planErr) throw new Error(`Insert agent_plan: ${planErr.message}`)

  // Evento na timeline pra avisar
  await sb.from('client_timeline_events').insert({
    client_id: clientId,
    event_type: 'compactacao_proposta',
    title: `Compactação semanal proposta para ${cli.nome}`,
    description: parsed.summary_of_changes?.slice(0, 500) || null,
    reference_table: 'agent_plans',
    reference_id: plan.id,
    created_by_agent: true,
    created_by_usuario_id: userId,
  })

  return { client_id: clientId, status: 'plan_created', plan_id: plan.id, confidence: parsed.confidence }
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
    const body = await req.json().catch(() => ({}))
    const { session_token, client_id, window_days } = body || {}
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (user.role !== 'admin' && user.role !== 'ngp') return json(req, { error: 'Apenas equipe NGP.' }, 403)

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'OPENAI_API_KEY não configurada.' }, 500)

    const win = (typeof window_days === 'number' && window_days >= 1 && window_days <= 90) ? window_days : DEFAULT_WINDOW_DAYS

    if (client_id) {
      const r = await processClient(sb, openAiKey, client_id, win, user.usuario_id)
      return json(req, { window_days: win, results: [r] })
    }

    // Batch: clientes com qualquer atividade na janela
    const since = new Date(Date.now() - win * 24 * 3600 * 1000).toISOString()
    const { data: rows } = await sb.from('copilot_messages')
      .select('client_id').gte('created_at', since).limit(500)
    const uniqueClients = [...new Set((rows || []).map(r => r.client_id))].slice(0, BATCH_LIMIT)

    const results = []
    for (const cid of uniqueClients) {
      try {
        const r = await processClient(sb, openAiKey, cid, win, user.usuario_id)
        results.push(r)
      } catch (e) {
        results.push({ client_id: cid, status: 'failed', error: e?.message || String(e) })
      }
    }
    return json(req, { window_days: win, processed: uniqueClients.length, results })
  } catch (e) {
    console.error('[copilot-profile-compactor]', e?.message || e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
