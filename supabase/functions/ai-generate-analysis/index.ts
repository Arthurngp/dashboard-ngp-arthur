// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { isNgp, validateSession } from '../_shared/roles.ts'

const MAX_CONTEXT_CHARS = 3000
const MAX_METRICS_CHARS = 18000
const MAX_OUTPUT_TOKENS = 1600
const OPENAI_TIMEOUT_MS = 45000

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
  const entries = Object.entries(metrics || {})
  if (!entries.length) return 'Nenhuma métrica foi enviada.'
  return entries
    .map(([key, value]) => {
      if (value && typeof value === 'object') return `- ${key}: ${JSON.stringify(value)}`
      return `- ${key}: ${value ?? 'não informado'}`
    })
    .join('\n')
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
        .select('id, cliente_id, cliente_username, cliente_nome, meta_account_id, period_label, prompt_name, model, output, created_at')
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

    const metrics = safeMetrics(params.metrics)
    const extraContext = cleanText(params.extra_context, MAX_CONTEXT_CHARS)
    const clientLabel = cleanText(cliente_nome || cliente_username || 'Cliente', 120)
    const periodLabel = cleanText(period_label || 'Período atual', 80)

    const userText = `${prompt.user_prompt}

Cliente: ${clientLabel}
Conta Meta: ${meta_account_id || 'não informada'}
Período: ${periodLabel}

Métricas recebidas:
${metricsToText(metrics)}

${extraContext ? `Contexto adicional:\n${extraContext}\n` : ''}Regras:
- Não invente dados que não foram enviados.
- Quando faltar dado, sinalize a ausência.
- Entregue uma leitura objetiva para decisão de tráfego pago.`

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
    if (!output) return json(req, { error: 'A IA não retornou texto para esta análise.' }, 502)

    const { data: run, error: runError } = await sb
      .from('ai_analysis_runs')
      .insert({
        cliente_id: cliente_id || null,
        cliente_username: cliente_username || null,
        cliente_nome: cliente_nome || null,
        meta_account_id: meta_account_id || null,
        period_label: periodLabel,
        prompt_template_id: prompt.id,
        prompt_name: prompt.name,
        model: prompt.model || 'gpt-4o-mini',
        metrics,
        extra_context: extraContext || null,
        output,
        created_by: actor.id,
      })
      .select('id, created_at')
      .single()

    if (runError) throw runError

    return json(req, {
      analysis: output,
      run,
      model: prompt.model,
      prompt_name: prompt.name,
    })
  } catch (e) {
    console.error('[ai-generate-analysis]', e)
    return json(req, { error: 'Erro interno ao processar análise de IA.' }, 500)
  }
})
