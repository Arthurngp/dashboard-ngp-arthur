// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { isNgp, validateSession } from '../_shared/roles.ts'

const MAX_CONTEXT_CHARS = 3000
const MAX_METRICS_CHARS = 18000
const MAX_OUTPUT_TOKENS = 1600
const OPENAI_TIMEOUT_MS = 45000
const STRUCTURED_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', enum: [1] },
    headline: { type: 'string' },
    diagnosis: { type: 'string' },
    wins: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    opportunities: { type: 'array', items: { type: 'string' } },
    nextActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'detail', 'priority'],
      },
    },
    dataGaps: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: [
    'version',
    'headline',
    'diagnosis',
    'wins',
    'risks',
    'opportunities',
    'nextActions',
    'dataGaps',
    'confidence',
  ],
}

function cleanText(value: unknown, max = MAX_CONTEXT_CHARS) {
  return String(value || '').replace(/\s+\n/g, '\n').trim().slice(0, max)
}

function safeMetrics(value: unknown) {
  const metrics = value && typeof value === 'object' ? value : {}
  const raw = JSON.stringify(metrics)
  if (raw.length <= MAX_METRICS_CHARS) return metrics
  return {
    aviso: 'Payload de métricas reduzido por limite de segurança.',
    resumo: raw.slice(0, MAX_METRICS_CHARS),
  }
}

function normalizeMetaAccountId(value: unknown) {
  return cleanText(value, 80).replace(/^act_/, '')
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

function metricsToText(metrics: Record<string, unknown>) {
  if (!metrics || typeof metrics !== 'object' || !Object.keys(metrics).length) return 'Nenhuma métrica foi enviada.'
  const raw = JSON.stringify(metrics, null, 2)
  if (raw.length <= MAX_METRICS_CHARS) return raw
  return `${raw.slice(0, MAX_METRICS_CHARS)}\n... [snapshot truncado por limite de segurança]`
}

function parseStructuredAnalysis(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const headline = cleanText(source.headline, 240)
  const diagnosis = cleanText(source.diagnosis, 2000)
  if (!headline || !diagnosis) return null

  const asArray = (field: string) =>
    Array.isArray(source[field])
      ? source[field].map((item) => cleanText(item, 400)).filter(Boolean)
      : []

  const nextActions = Array.isArray(source.nextActions)
    ? source.nextActions
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const action = item as Record<string, unknown>
          const title = cleanText(action.title, 180)
          const detail = cleanText(action.detail, 500)
          const priority = ['high', 'medium', 'low'].includes(String(action.priority)) ? String(action.priority) : 'medium'
          if (!title || !detail) return null
          return { title, detail, priority }
        })
        .filter(Boolean)
    : []

  const confidence = ['high', 'medium', 'low'].includes(String(source.confidence)) ? String(source.confidence) : 'medium'

  return {
    version: 1,
    headline,
    diagnosis,
    wins: asArray('wins'),
    risks: asArray('risks'),
    opportunities: asArray('opportunities'),
    nextActions,
    dataGaps: asArray('dataGaps'),
    confidence,
  }
}

function renderStructuredAnalysisMarkdown(analysis: ReturnType<typeof parseStructuredAnalysis>) {
  if (!analysis) return ''
  const sections = [`# ${analysis.headline}`, '', analysis.diagnosis]

  const addList = (title: string, items: string[]) => {
    if (!items.length) return
    sections.push('', `## ${title}`)
    items.forEach((item) => sections.push(`- ${item}`))
  }

  addList('O que está funcionando', analysis.wins)
  addList('Riscos e desperdícios', analysis.risks)
  addList('Oportunidades', analysis.opportunities)

  if (analysis.nextActions.length) {
    sections.push('', '## Próximas ações')
    analysis.nextActions.forEach((action) => {
      sections.push(`- [${action.priority.toUpperCase()}] ${action.title}: ${action.detail}`)
    })
  }

  addList('Lacunas de dados', analysis.dataGaps)
  sections.push('', `Confiança da análise: ${analysis.confidence}.`)
  return sections.join('\n')
}

async function getSessionUser(sb: any, session_token: string) {
  const session = await validateSession(sb, session_token)
  if (!session) return null

  const { data: usuario } = await sb
    .from('usuarios')
    .select('id, username, nome, role, meta_account_id')
    .eq('id', session.usuario_id)
    .single()

  if (!usuario) return null
  return usuario
}

async function canAccessClient(sb: any, actor: any, cliente_id?: string, cliente_username?: string) {
  if (isNgp(actor.role)) return true
  if (actor.role !== 'cliente') return false
  if (cliente_id && cliente_id === actor.id) return true
  if (cliente_username && cliente_username === actor.username) return true
  return false
}

async function loadSnapshot(sb: any, actor: any, params: Record<string, unknown>) {
  const snapshotId = cleanText(params.snapshot_id, 80)
  const clienteId = cleanText(params.cliente_id, 80) || undefined
  const clienteUsername = cleanText(params.cliente_username, 120) || undefined
  const metaAccountId = normalizeMetaAccountId(params.meta_account_id) || undefined

  if (snapshotId) {
    const { data } = await sb
      .from('analytics_snapshots')
      .select('id, cliente_id, cliente_username, cliente_nome, meta_account_id, period_label, snapshot')
      .eq('id', snapshotId)
      .maybeSingle()
    if (!data) return null
    const allowed = await canAccessClient(sb, actor, data.cliente_id || undefined, data.cliente_username || undefined)
    if (!allowed) return 'forbidden'
    return data
  }

  if (clienteId || clienteUsername || metaAccountId) {
    const allowed = await canAccessClient(sb, actor, clienteId, clienteUsername)
    if (!allowed) return 'forbidden'

    let query = sb
      .from('analytics_snapshots')
      .select('id, cliente_id, cliente_username, cliente_nome, meta_account_id, period_label, snapshot')
      .order('updated_at', { ascending: false })
      .limit(1)

    if (clienteId) query = query.eq('cliente_id', clienteId)
    else if (clienteUsername) query = query.eq('cliente_username', clienteUsername)
    else if (metaAccountId) query = query.eq('meta_account_id', metaAccountId)

    const { data } = await query.maybeSingle()
    return data || null
  }

  return null
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, action = 'generate', ...params } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const actor = await getSessionUser(sb, session_token)
    if (!actor) return json(req, { error: 'Sessão expirada. Faça login novamente.' }, 401)

    if (action === 'list_prompts') {
      let query = sb
        .from('ai_prompt_templates')
        .select('id, slug, name, description, category, model, temperature, system_prompt, user_prompt, is_active, updated_at')
        .order('name', { ascending: true })

      if (!isNgp(actor.role) || !params.include_inactive) query = query.eq('is_active', true)

      const { data, error } = await query
      if (error) throw error
      return json(req, { prompts: data || [], can_manage: isNgp(actor.role) })
    }

    if (action === 'history') {
      const { cliente_id, cliente_username } = params
      const allowed = await canAccessClient(sb, actor, cliente_id, cliente_username)
      if (!allowed) return json(req, { error: 'Acesso negado.' }, 403)

      let query = sb
        .from('ai_analysis_runs')
        .select('id, cliente_id, cliente_username, cliente_nome, meta_account_id, period_label, prompt_name, model, output, output_json, snapshot_id, created_at')
        .order('created_at', { ascending: false })
        .limit(12)

      if (cliente_id) query = query.eq('cliente_id', cliente_id)
      else if (cliente_username) query = query.eq('cliente_username', cliente_username)
      else query = query.eq('created_by', actor.id)

      const { data, error } = await query
      if (error) throw error
      return json(req, { history: data || [] })
    }

    if (action === 'save_prompt') {
      if (!isNgp(actor.role)) return json(req, { error: 'Acesso negado.' }, 403)

      const name = cleanText(params.name, 120)
      const system_prompt = cleanText(params.system_prompt, 4000)
      const user_prompt = cleanText(params.user_prompt, 4000)
      if (!name || !system_prompt || !user_prompt) {
        return json(req, { error: 'Nome, prompt de sistema e prompt do usuário são obrigatórios.' }, 400)
      }

      const payload = {
        name,
        description: cleanText(params.description, 240) || null,
        category: cleanText(params.category, 60) || 'performance',
        model: cleanText(params.model, 80) || 'gpt-4o-mini',
        temperature: Number.isFinite(Number(params.temperature)) ? Number(params.temperature) : 0.35,
        system_prompt,
        user_prompt,
        is_active: params.is_active !== false,
        updated_at: new Date().toISOString(),
      }

      if (params.id) {
        const { data, error } = await sb
          .from('ai_prompt_templates')
          .update(payload)
          .eq('id', params.id)
          .select()
          .single()
        if (error) throw error
        return json(req, { prompt: data })
      }

      const slug = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) + '-' + crypto.randomUUID().slice(0, 8)

      const { data, error } = await sb
        .from('ai_prompt_templates')
        .insert({ ...payload, slug, created_by: actor.id })
        .select()
        .single()
      if (error) throw error
      return json(req, { prompt: data })
    }

    if (action !== 'generate') {
      return json(req, { error: `Action '${action}' desconhecida.` }, 400)
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      return json(req, { error: 'IA não configurada no servidor. Configure OPENAI_API_KEY nos Supabase Secrets.' }, 500)
    }

    const { prompt_id, cliente_id, cliente_username, cliente_nome, meta_account_id, period_label } = params
    const allowed = await canAccessClient(sb, actor, cliente_id, cliente_username)
    if (!allowed) return json(req, { error: 'Acesso negado.' }, 403)
    if (!prompt_id) return json(req, { error: 'Selecione um prompt para gerar a análise.' }, 400)

    const { data: prompt, error: promptError } = await sb
      .from('ai_prompt_templates')
      .select('*')
      .eq('id', prompt_id)
      .eq('is_active', true)
      .single()

      if (promptError || !prompt) return json(req, { error: 'Prompt não encontrado ou inativo.' }, 404)

      const snapshotRow = await loadSnapshot(sb, actor, params)
      if (snapshotRow === 'forbidden') return json(req, { error: 'Acesso negado ao snapshot analítico.' }, 403)

      const baseMetrics = snapshotRow?.snapshot || params.metrics
      if (!baseMetrics || typeof baseMetrics !== 'object') {
        return json(req, { error: 'Nenhum snapshot analítico foi encontrado para esta conta/período.' }, 400)
      }

      const metrics = safeMetrics(baseMetrics)
      const extraContext = cleanText(params.extra_context, MAX_CONTEXT_CHARS)
      const clientLabel = cleanText(snapshotRow?.cliente_nome || cliente_nome || cliente_username || 'Cliente', 120)
      const periodLabel = cleanText(snapshotRow?.period_label || period_label || 'Período atual', 80)
      const accountLabel = cleanText(snapshotRow?.meta_account_id || meta_account_id || 'não informada', 80)

      // ====================================================================
      // HOOK COPILOT — injeta memória persistente do cliente como contexto
      // antes da análise. Tudo que o NGP Copilot aprendeu (profile + timeline)
      // passa a alimentar relatórios automaticamente.
      // ====================================================================
      let copilotMemoryBlock = ''
      try {
        const cidCandidate = snapshotRow?.cliente_id || cliente_id || null
        if (cidCandidate) {
          // Resolve clientes.id (pode vir como usuarios.id do dashboard)
          const { data: resolvedId } = await sb.rpc('resolve_cliente_id', { p_input: cidCandidate })
          const realClientId = (typeof resolvedId === 'string' && resolvedId) ? resolvedId : null
          if (realClientId) {
            const [profileRes, timelineRes] = await Promise.all([
              sb.from('client_memory_profiles')
                .select('executive_summary, business_context, offer_context, icp_context, brand_positioning, creative_learnings, content_strategy, wins, losses, competition_notes, operational_rules, risks, key_metrics, channel_notes, last_compacted_at')
                .eq('client_id', realClientId).maybeSingle(),
              sb.from('client_timeline_events')
                .select('event_type, title, description, motivador, resultado_esperado, resultado_observado, hypothesis_status, event_at')
                .eq('client_id', realClientId)
                .in('event_type', ['decisao', 'feedback_cliente', 'alteracao_aprovada', 'hipotese_levantada', 'resultado_observado', 'memory_update'])
                .order('event_at', { ascending: false })
                .limit(15),
            ])

            const p = profileRes.data
            const events = timelineRes.data || []

            if (p) {
              const parts = ['', '=== MEMÓRIA PERSISTENTE DO CLIENTE (NGP Copilot) ===']
              if (p.executive_summary) parts.push(`Resumo executivo:\n${p.executive_summary}`)
              if (p.business_context) parts.push(`\nNegócio:\n${p.business_context}`)
              if (p.offer_context) parts.push(`\nOferta atual:\n${p.offer_context}`)
              if (p.icp_context) parts.push(`\nICP / Público:\n${p.icp_context}`)
              if (p.brand_positioning) parts.push(`\nPosicionamento de marca:\n${p.brand_positioning}`)
              if (p.content_strategy) parts.push(`\nEstratégia de conteúdo:\n${p.content_strategy}`)
              if (p.creative_learnings) parts.push(`\nAprendizados de criativo:\n${p.creative_learnings}`)
              if (p.wins) parts.push(`\nO que JÁ FUNCIONOU (wins):\n${p.wins}`)
              if (p.losses) parts.push(`\nO que NÃO funcionou (losses):\n${p.losses}`)
              if (p.competition_notes) parts.push(`\nConcorrência:\n${p.competition_notes}`)
              if (p.operational_rules) parts.push(`\nRegras operacionais (RESPEITAR):\n${p.operational_rules}`)
              if (p.risks) parts.push(`\nRiscos/atenções:\n${p.risks}`)
              if (p.key_metrics) parts.push(`\nMétricas-chave:\n${p.key_metrics}`)
              if (p.channel_notes && typeof p.channel_notes === 'object') {
                const cn = p.channel_notes as Record<string, string | null>
                const meta = cn.meta, google = cn.google, notas = cn.notas_gerais
                if (meta) parts.push(`\nNotas Meta Ads:\n${meta}`)
                if (google) parts.push(`\nNotas Google Ads:\n${google}`)
                if (notas) parts.push(`\nNotas gerais por canal:\n${notas}`)
              }
              if (p.last_compacted_at) parts.push(`\n(Memória atualizada em ${p.last_compacted_at})`)
              copilotMemoryBlock = parts.join('\n')
            }

            if (events.length) {
              copilotMemoryBlock += '\n\n=== EVENTOS RECENTES DA TIMELINE ==='
              for (const e of events) {
                const dateStr = e.event_at ? String(e.event_at).slice(0, 10) : ''
                const hStatus = e.hypothesis_status && e.hypothesis_status !== 'na' ? ` [hipótese: ${e.hypothesis_status}]` : ''
                copilotMemoryBlock += `\n- ${dateStr} [${e.event_type}]${hStatus} ${e.title}`
                if (e.motivador) copilotMemoryBlock += `\n  motivador: ${e.motivador}`
                if (e.resultado_esperado) copilotMemoryBlock += `\n  esperado: ${e.resultado_esperado}`
                if (e.resultado_observado) copilotMemoryBlock += `\n  observado: ${e.resultado_observado}`
              }
            }
          }
        }
      } catch (e) {
        console.error('[ai-generate-analysis] copilot memory hook failed (não-bloqueante):', e?.message)
      }

      const userText = `${prompt.user_prompt}

Cliente: ${clientLabel}
Conta Meta: ${accountLabel || 'não informada'}
Período: ${periodLabel}

Snapshot analítico estruturado (JSON):
${metricsToText(metrics)}
${copilotMemoryBlock}

${extraContext ? `Contexto adicional:\n${extraContext}\n` : ''}Regras:
- Não invente dados que não foram enviados.
- Quando faltar dado, sinalize a ausência.
- USE a MEMÓRIA PERSISTENTE acima quando for relevante: cite wins/losses conhecidos, respeite regras operacionais, considere o posicionamento de marca e o ICP nas recomendações.
- Quando uma observação contradiz a memória persistente, sinalize explicitamente.
- Entregue uma leitura objetiva para decisão de tráfego pago.
- Priorize clareza operacional, sem frases genéricas.
- Retorne SOMENTE o JSON no schema solicitado.`

    let aiRes: Response
    try {
      aiRes = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: prompt.model || 'gpt-4o-mini',
          temperature: Number(prompt.temperature ?? 0.35),
          max_output_tokens: MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: 'ngp_meta_analysis',
              strict: true,
              schema: STRUCTURED_ANALYSIS_SCHEMA,
            },
          },
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: prompt.system_prompt }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: userText }],
            },
          ],
        }),
      })
    } catch {
      return json(req, { error: 'A IA demorou demais para responder. Tente novamente em alguns segundos.' }, 504)
    }

    const aiData = await aiRes.json().catch(() => ({}))
    if (!aiRes.ok) {
      const message = aiData?.error?.message || `Erro ${aiRes.status} ao gerar análise.`
      return json(req, { error: message }, aiRes.status >= 500 ? 502 : 400)
    }

    const output = extractOpenAiText(aiData)
    if (!output) return json(req, { error: 'A IA não retornou conteúdo para esta análise.' }, 502)

    let structured: ReturnType<typeof parseStructuredAnalysis> | null = null
    try {
      structured = parseStructuredAnalysis(JSON.parse(output))
    } catch {
      structured = null
    }
    if (!structured) {
      return json(req, { error: 'A IA retornou um formato inválido para a análise estruturada.' }, 502)
    }

    const markdown = renderStructuredAnalysisMarkdown(structured)

    const { data: run, error: runError } = await sb
      .from('ai_analysis_runs')
      .insert({
        cliente_id: cliente_id || null,
        cliente_username: cliente_username || null,
        cliente_nome: snapshotRow?.cliente_nome || cliente_nome || null,
        meta_account_id: snapshotRow?.meta_account_id || meta_account_id || null,
        period_label: periodLabel,
        prompt_template_id: prompt.id,
        prompt_name: prompt.name,
        model: prompt.model || 'gpt-4o-mini',
        metrics,
        snapshot_id: snapshotRow?.id || null,
        extra_context: extraContext || null,
        output: markdown,
        output_json: structured,
        created_by: actor.id,
      })
      .select('id, created_at')
      .single()

    if (runError) throw runError

    return json(req, {
      analysis: markdown,
      analysis_json: structured,
      run,
      model: prompt.model,
      prompt_name: prompt.name,
      snapshot_id: snapshotRow?.id || null,
    })
  } catch (e) {
    console.error('[ai-generate-analysis]', e)
    return json(req, { error: 'Erro interno ao processar análise de IA.' }, 500)
  }
})
