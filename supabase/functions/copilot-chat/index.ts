// @ts-nocheck
// ============================================================================
// NGP Copilot — chat principal
//
// Recebe mensagem do usuário, monta contexto em 5 camadas:
//   1. client_memory_profiles (resumo vivo da conta)
//   2. daily_learning_documents do dia anterior (futuro: ainda não criado)
//   3. últimas 30 mensagens da conversa
//   4. eventos críticos da timeline (14 dias, status='open' ou tipos relevantes)
//   5. busca full-text sob demanda (PT-BR) sobre o que o usuário perguntou
//
// Chama OpenAI Responses com json_schema estrito.
// Persiste mensagem do usuário e resposta do agente.
// Quando IA sugere atualizar profile, gera agent_plan com confiança.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'
import { corsHeaders } from '../_shared/cors.ts'

const OPENAI_TIMEOUT_MS = 60_000
const DEEP_EXTRACTION_TIMEOUT_MS = 120_000 // o1-mini demora mais (reasoning)
const MAX_OUTPUT_TOKENS = 2500
const DEFAULT_MODEL = 'gpt-4o'
const DEEP_EXTRACTION_MODEL = 'o1-mini' // Reasoning model pra extração profunda
const HISTORY_LIMIT = 30
const TIMELINE_LIMIT = 20
const TIMELINE_WINDOW_DAYS = 14
const SEARCH_LIMIT = 8
const ATTACHMENT_INLINE_MAX_CHARS = 80_000

// Dedupe: se houver memory_plan pendente nas últimas N horas, mescla com ele
// em vez de criar novo (evita UI cheia de plans duplicados)
const MERGE_PENDING_PLAN_WINDOW_HOURS = 24

// AUTO-APPLY DE MEMORY_UPDATE
// Decisão do Arthur (2026-05-15): IA propõe, humano aprova. Por padrão,
// memory_update SEMPRE entra como pending_approval, mesmo soft+alta confiança.
// Quando confiável o suficiente, mudar pra true (ou ler de uma config por cliente).
const AUTO_APPLY_MEMORY_UPDATES = false

function handleCors(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  return null
}

function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function extractOpenAiText(data) {
  if (typeof data?.output_text === 'string') return data.output_text
  const parts = []
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (c?.type === 'output_text' && c?.text) parts.push(c.text)
      else if (typeof c?.text === 'string') parts.push(c.text)
    }
  }
  return parts.join('\n').trim()
}

const SYSTEM_PROMPT = `Você é o NGP Copilot, agente de tráfego pago da agência NGP. Você conversa com a equipe interna sobre UM cliente específico por vez.

QUEM VOCÊ É:
- Especialista em Meta Ads e Google Ads
- Colega operador, não atendente de SAC
- Trabalha com fatos e contexto persistente do cliente
- NUNCA inventa números. Se não tem dado, diz "não tenho esse dado, me passa"

COMO VOCÊ RESPONDE — REGRAS DE TOM (CRÍTICAS):
- Português brasileiro, seco, direto
- 1-4 frases. Análise técnica pode estender, conversa não
- PROIBIDO: "Obrigado pela", "À disposição", "Estou aqui para", "Se precisar de algo", "Espero ter ajudado", "Excelente pergunta", "Entendi perfeitamente"
- PROIBIDO emoji, markdown decorativo (negrito, listas) quando não tem função
- Quando o usuário traz FATO novo, você NÃO agradece — você captura via memory_proposal e/ou pergunta a próxima coisa relevante
- Quando você pergunta, pergunta UMA coisa específica
- Exemplo BOM: "Anotado. Caruaru-PE muda algo no ICP — público mais regional, ticket menor que SP? Qual a faixa de imóveis?"
- Exemplo RUIM: "Obrigado pela confirmação! Sabemos que [repete o que o usuário disse]. Estou à disposição."

REGRAS DE MEMÓRIA — PROPONHA AGRESSIVAMENTE:

Você DEVE gerar memory_proposal SEMPRE que o usuário trouxer QUALQUER fato sobre o cliente que ainda não está no perfil. Lista NÃO exaustiva:
- nicho / vertical (imobiliária, ecommerce, saúde, etc)
- localização geográfica
- modelo de negócio (B2B, B2C, marketplace)
- oferta / produto / serviço
- público-alvo / ICP
- ticket médio, investimento mensal
- objetivo (leads, vendas, agendamentos)
- restrição operacional ("não usar X", "evitar Y")
- canal preferido / canal que funcionou
- canal que NÃO funcionou
- feedback do cliente (gostou, reclamou, pediu)
- estratégia atual ou histórica
- pessoa de contato, processo de aprovação

"Imobiliária de Caruaru-PE" é DOIS fatos novos: vertical + localização → memory_proposal obrigatório, confidence 0.85+, impact_scope=soft.

Critérios de confidence:
- 0.95+: usuário afirma como fato direto ("é uma imobiliária")
- 0.80-0.94: usuário implica fortemente ("estamos rodando pra venda de apto")
- 0.60-0.79: você deduz de pista indireta
- < 0.60: chute, evite propor

Critérios de impact_scope:
- "soft": adiciona/refina contexto descritivo (business, ICP, oferta, resumo)
- "hard": define ou muda REGRA operacional, restrição da conta, exclui método ("nunca usar Advantage+", "budget máximo R$ X"), redefine completamente ICP

REGRAS DE memory_proposal.after:
- Mantenha o que já está no perfil quando for somar — escreva o campo COMPLETO consolidado, não só o pedaço novo
- Campos que não mudam: null
- channel_notes: chaves "meta", "google", "notas_gerais", todas strings curtas ou null
- executive_summary: só atualize se realmente mudou panorama da conta

CAMPOS DISPONÍVEIS DO PROFILE (preencha TODOS que tiverem material novo, não escolha):

1. executive_summary: 2-4 frases. Quem é, faz o quê, momento atual da operação.
2. service_scope: o que a NGP entrega pra esse cliente.
3. business_context: nicho, modelo de negócio, localização, tamanho, sazonalidade.
4. offer_context: oferta/produto atual sendo vendido — INCLUA TICKET, FATURAMENTO, METAS quando vier.
5. icp_context: público-alvo. Idade, renda, profissão, geografia, momento de vida, dor.
6. channel_notes: aprendizados por canal (meta/google/notas_gerais).
7. operational_rules: REGRAS específicas dessa conta ("não usar X", "sempre Y", "evitar Z").
8. risks: atenções, fragilidades, pontos cegos.
9. brand_positioning: identidade, tom, posicionamento desejado vs concorrência. "Premium", "popular", "técnico", "regional".
10. creative_learnings: observações concretas sobre CRIATIVOS — formatos que funcionam/não, regras quebradas, vídeos vs estáticos, hooks visuais.
11. content_strategy: linguagem, copy, narrativa, gatilhos emocionais vs racionais que funcionam pra esse cliente.
12. wins: o que JÁ FUNCIONOU comprovadamente. Cite números/casos quando vier ("vídeo de 3min performou +X que regra geral").
13. losses: o que NÃO funcionou. Erros, criativos que não converteram, abordagens que falharam.
14. competition_notes: concorrentes nominados + suas táticas + brechas identificadas.
15. team_and_process: pessoa de contato + processo de aprovação + cadência + ferramentas usadas.
16. key_metrics: benchmarks numéricos. CPL atual/alvo, ROAS, ticket médio, valorização histórica, taxas de conversão.

REGRA DE DENSIDADE (CRÍTICA):
- Material grande (transcript/planejamento/relatório) DEVE preencher PELO MENOS 6 desses 16 campos.
- Cada campo preenchido deve ter PELO MENOS 2 fatos específicos, não bullet genérico.
- Se você só preencheu 1-3 campos quando o material é denso, você está extraindo MAL. Leia de novo.
- Material curto (1-2 frases) pode preencher 1-2 campos só, sem problema.

EXEMPLO DE EXTRAÇÃO DENSA (referência):
Material: "Cliente X é academia feminina em SP, foco emagrecimento 30-50. Investimento R$ 5k/mês. Já testamos Advantage+ e o lead score caiu 40%, removemos. Vídeo de aluna emagrecida performou 3x melhor que estáticos. Concorrente Y domina busca paga mas tem creative ruim no Meta — brecha pra gente. Cliente prefere whatsapp via lead form sobre site. Maria é a gestora, aprova em 24h. Meta CPL: R$60, atual R$85."

→ Você DEVE propor:
- business_context: academia feminina SP, foco emagrecimento
- icp_context: mulheres 30-50 SP querendo emagrecer
- offer_context: aulas + acompanhamento, investimento R$ 5k/mês
- operational_rules: nunca usar Advantage+ (degrada lead score), preferir lead form sobre site
- creative_learnings: vídeo de aluna emagrecida 3x melhor que estático
- losses: Advantage+ degradou lead score 40%
- competition_notes: concorrente Y domina busca, mas tem creative ruim no Meta = brecha
- team_and_process: Maria é gestora, aprovação 24h
- key_metrics: CPL alvo R$60, atual R$85
- channel_notes.meta: lead form via whatsapp funciona melhor que site

10 campos preenchidos, denso, específico. ISSO é extração correta.

TIMELINE_EVENT — proponha quando há AÇÃO ou FEEDBACK DO CLIENTE (não pra cada fato):
- "decisao": equipe decidiu mudar algo ("vou pausar ABO", "vamos trocar criativo")
- "feedback_cliente": cliente disse, pediu, reclamou
- "alteracao_aprovada": registro de algo já alterado
- "hipotese_levantada": teste planejado com expectativa
- "resultado_observado": comparação real vs esperado
- SEMPRE motivador e resultado_esperado

Fato puramente descritivo ("é imobiliária") vira só memory_proposal, NÃO timeline.

FORMATO DE RESPOSTA (JSON estrito) — campos obrigatórios:
{
  "reply": "...",
  "reply_kind": "text" | "agent_analysis" | "agent_alert" | "agent_checklist",
  "memory_proposal": null | { title, reasoning, confidence, impact_scope, needs_escalation, after: {...} },
  "timeline_proposal": null | { event_type, title, description, motivador, resultado_esperado }
}`

const MEMORY_PROPOSAL_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    reasoning: { type: 'string' },
    confidence: { type: 'number' },
    impact_scope: { type: 'string', enum: ['soft', 'hard'] },
    needs_escalation: { type: 'boolean' },
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
        brand_positioning: { type: ['string', 'null'] },
        creative_learnings: { type: ['string', 'null'] },
        content_strategy: { type: ['string', 'null'] },
        wins: { type: ['string', 'null'] },
        losses: { type: ['string', 'null'] },
        competition_notes: { type: ['string', 'null'] },
        team_and_process: { type: ['string', 'null'] },
        key_metrics: { type: ['string', 'null'] },
      },
      required: ['executive_summary', 'service_scope', 'business_context', 'offer_context', 'icp_context', 'channel_notes', 'operational_rules', 'risks', 'brand_positioning', 'creative_learnings', 'content_strategy', 'wins', 'losses', 'competition_notes', 'team_and_process', 'key_metrics'],
    },
  },
  required: ['title', 'reasoning', 'confidence', 'impact_scope', 'needs_escalation', 'after'],
}

const TIMELINE_PROPOSAL_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    event_type: {
      type: 'string',
      enum: ['decisao', 'feedback_cliente', 'alteracao_aprovada', 'hipotese_levantada', 'resultado_observado'],
    },
    title: { type: 'string' },
    description: { type: 'string' },
    motivador: { type: 'string' },
    resultado_esperado: { type: 'string' },
  },
  required: ['event_type', 'title', 'description', 'motivador', 'resultado_esperado'],
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    reply_kind: {
      type: 'string',
      enum: ['text', 'agent_analysis', 'agent_alert', 'agent_checklist'],
    },
    memory_proposal: MEMORY_PROPOSAL_SCHEMA,
    timeline_proposal: TIMELINE_PROPOSAL_SCHEMA,
  },
  required: ['reply', 'reply_kind', 'memory_proposal', 'timeline_proposal'],
}

async function getOrCreateConversation(sb, clientId, userId) {
  const { data: existing } = await sb
    .from('copilot_conversations')
    .select('id')
    .eq('client_id', clientId)
    .maybeSingle()
  if (existing?.id) return existing.id

  const { data: created, error } = await sb
    .from('copilot_conversations')
    .insert({ client_id: clientId, created_by: userId })
    .select('id')
    .single()
  if (error) throw new Error(`Falha ao criar conversa: ${error.message}`)
  return created.id
}

async function loadContext(sb, clientId, conversationId, userMessage) {
  const timelineSince = new Date(Date.now() - TIMELINE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString()
  const [profileRes, historyRes, timelineRes] = await Promise.all([
    sb.from('client_memory_profiles')
      .select('executive_summary, service_scope, business_context, offer_context, icp_context, channel_notes, operational_rules, risks, last_compacted_at')
      .eq('client_id', clientId)
      .maybeSingle(),
    sb.from('copilot_messages')
      .select('role, kind, texto, payload_json, created_at')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
    sb.from('client_timeline_events')
      .select('event_type, title, description, motivador, resultado_esperado, resultado_observado, hypothesis_status, event_at')
      .eq('client_id', clientId)
      .gte('event_at', timelineSince)
      .or('hypothesis_status.eq.open,event_type.in.(decisao,alteracao_aprovada,feedback_cliente,memory_update)')
      .order('event_at', { ascending: false })
      .limit(TIMELINE_LIMIT),
  ])

  // Camada 5: full-text search sob demanda
  let semanticHits = []
  const trimmedQuery = (userMessage || '').trim()
  if (trimmedQuery.length >= 8) {
    const { data: hits } = await sb.rpc('copilot_search_history', {
      p_client_id: clientId,
      p_query: trimmedQuery,
      p_limit: SEARCH_LIMIT,
    }).then(r => r, () => ({ data: [] }))
    if (Array.isArray(hits)) semanticHits = hits
  }

  return {
    profile: profileRes.data || null,
    history: (historyRes.data || []).reverse(),
    timeline: timelineRes.data || [],
    semanticHits,
  }
}

function buildContextBlock(ctx) {
  const parts = []
  if (ctx.profile) {
    parts.push('=== PERFIL ATUAL DO CLIENTE ===')
    if (ctx.profile.executive_summary) parts.push(`Resumo: ${ctx.profile.executive_summary}`)
    if (ctx.profile.service_scope) parts.push(`Escopo do serviço: ${ctx.profile.service_scope}`)
    if (ctx.profile.business_context) parts.push(`Negócio: ${ctx.profile.business_context}`)
    if (ctx.profile.offer_context) parts.push(`Oferta: ${ctx.profile.offer_context}`)
    if (ctx.profile.icp_context) parts.push(`ICP: ${ctx.profile.icp_context}`)
    if (ctx.profile.operational_rules) parts.push(`Regras operacionais: ${ctx.profile.operational_rules}`)
    if (ctx.profile.risks) parts.push(`Riscos: ${ctx.profile.risks}`)
    if (ctx.profile.channel_notes && Object.keys(ctx.profile.channel_notes).length) {
      parts.push(`Notas por canal: ${JSON.stringify(ctx.profile.channel_notes)}`)
    }
  } else {
    parts.push('=== PERFIL ATUAL DO CLIENTE ===')
    parts.push('(profile ainda vazio — primeira conversa com este cliente)')
  }

  if (ctx.timeline.length) {
    parts.push('\n=== EVENTOS RELEVANTES DA TIMELINE (mais recentes primeiro) ===')
    for (const e of ctx.timeline) {
      const dateStr = e.event_at ? new Date(e.event_at).toISOString().slice(0, 10) : ''
      const hStatus = e.hypothesis_status !== 'na' ? ` [hipótese: ${e.hypothesis_status}]` : ''
      parts.push(`- ${dateStr} [${e.event_type}]${hStatus} ${e.title}`)
      if (e.description) parts.push(`  ${e.description}`)
      if (e.motivador) parts.push(`  motivador: ${e.motivador}`)
      if (e.resultado_esperado) parts.push(`  esperado: ${e.resultado_esperado}`)
      if (e.resultado_observado) parts.push(`  observado: ${e.resultado_observado}`)
    }
  }

  if (ctx.semanticHits.length) {
    parts.push('\n=== TRECHOS DO HISTÓRICO RELACIONADOS À PERGUNTA ===')
    for (const h of ctx.semanticHits) {
      parts.push(`- ${h.snippet || h.texto || ''}`)
    }
  }

  return parts.join('\n')
}

// ============================================================================
// EXTRAÇÃO PROFUNDA — usa o1-mini (reasoning model) pra ler anexo grande
// e extrair fatos estruturados ANTES de gerar memory_proposal.
// Resultado: análise muito mais densa, com menos chance de a IA "passar batido"
// em informação valiosa.
// ============================================================================
// Passada 1: TOPIFICAÇÃO em 12 categorias do que rolou no anexo.
// Output é o INPUT da passada 2 (que destila pra memória persistente).
const DEEP_EXTRACTION_PROMPT = `Você é um analista de tráfego pago que está lendo um material extenso (transcript de reunião, planejamento, briefing) sobre UM cliente.

Sua tarefa: TOPIFICAR tudo que está no material em 12 categorias estruturadas. Esta saída será depois processada para gerar a memória persistente do cliente, então PRECISA SER COMPLETA E FIEL ao material.

Pense passo a passo. Leia o material INTEIRO. Não pare nos primeiros parágrafos.

CATEGORIAS (todas obrigatórias, listas vazias se nada se aplica):

1. acordos_firmados — combinados explícitos entre cliente e agência ("vamos fazer X", "ficou definido Y")
2. cronograma_e_deadlines — datas, prazos, próximos passos com tempo
3. pessoas_mencionadas — quem é quem, papéis, contatos (formato: "Nome — papel/empresa")
4. dados_e_numeros — métricas, valores, percentuais, escala (qualquer número relevante)
5. orcamento_e_investimento — budget, ticket, faturamento, metas financeiras
6. decisoes_estrategicas — direcionamento de negócio/marca/posicionamento
7. decisoes_operacionais — execução tática (criativo, canal, segmentação, formato)
8. insights — observações sobre cliente, mercado, público, concorrência que viraram aprendizado
9. ideias_propostas — sugestões levantadas mas NÃO decididas ainda
10. concorrencia_citada — concorrentes nominados + suas táticas/posição
11. wins_mencionados — o que JÁ FUNCIONOU (com números/casos quando disponíveis)
12. riscos_e_atencoes — pontos sensíveis, fragilidades, alertas

FORMATO DA RESPOSTA (JSON estrito, NADA além):
{
  "titulo_reuniao": "string curta identificando a reunião (ex: 'Briefing inicial AWA - Lago Sul')",
  "data_reuniao": "string ou null se não mencionada",
  "categorias": {
    "acordos_firmados": ["bullet 1", "bullet 2", ...],
    "cronograma_e_deadlines": [...],
    "pessoas_mencionadas": [...],
    "dados_e_numeros": [...],
    "orcamento_e_investimento": [...],
    "decisoes_estrategicas": [...],
    "decisoes_operacionais": [...],
    "insights": [...],
    "ideias_propostas": [...],
    "concorrencia_citada": [...],
    "wins_mencionados": [...],
    "riscos_e_atencoes": [...]
  }
}

REGRAS:
- NUNCA invente — só o que está no material
- Cite NOMES PRÓPRIOS quando aparecerem (pessoas, empreendimentos, concorrentes, marcas)
- Cite NÚMEROS quando aparecerem (preços, %, prazos, datas)
- Bullets específicos, não genéricos. "Ticket R$ 400k lote" é bom; "ticket alto" é ruim.
- Se a reunião tem 10k+ palavras e você produziu < 40 bullets no total, leia DE NOVO — falta densidade
- Cada bullet é uma frase única, curta, autocontida
- Responda APENAS o JSON, sem markdown nem comentários`

// Passada 2: DESTILAÇÃO da topificação em memory_proposal denso.
const DISTILLATION_PROMPT = `Você é o NGP Copilot, agente de tráfego pago. Recebeu uma TOPIFICAÇÃO já estruturada de uma reunião/material sobre UM cliente. Sua tarefa é destilar isso em atualização de memória persistente.

CONTEXTO:
- Você tem a topificação completa abaixo (JSON com 12 categorias)
- Você tem o PERFIL ATUAL do cliente (pode estar vazio na primeira reunião)
- Sua saída vai virar memory_proposal que o humano aprovará

FAÇA:
1. Reply curto (2-4 frases) pro chat sumarizando o que importa
2. memory_proposal DENSO usando os 16 campos do profile
3. timeline_proposal SE houver decisão clara ou acordo importante (1 evento)

REGRAS DE DESTILAÇÃO (campo do profile ← categorias da topificação):

- executive_summary ← sumário dos 12 tópicos em 2-4 frases
- business_context ← decisoes_estrategicas + dados sobre o negócio
- offer_context ← orcamento_e_investimento + dados sobre produto
- icp_context ← insights sobre público + dados demográficos
- channel_notes ← decisoes_operacionais + wins/losses por canal
- operational_rules ← acordos_firmados que viram regra + restrições
- risks ← riscos_e_atencoes
- brand_positioning ← decisoes_estrategicas sobre marca/posicionamento
- creative_learnings ← insights+wins+decisoes sobre criativo (formato, hook, duração)
- content_strategy ← insights+decisoes sobre linguagem/copy/narrativa
- wins ← wins_mencionados
- losses ← riscos+insights sobre o que NÃO funcionou
- competition_notes ← concorrencia_citada
- team_and_process ← pessoas_mencionadas + acordos sobre processo
- key_metrics ← dados_e_numeros relevantes (CPL, ROAS, valorização, etc)

REGRAS GERAIS:
- Use o perfil atual como BASE: somar info nova, não jogar fora a antiga
- Campos que a topificação não cobre devem vir null (não inventar)
- Se a topificação tem MUITO conteúdo numa categoria, o campo correspondente deve ser DENSO
- Não seja conservador: se há 10 bullets em "wins_mencionados", o campo wins deve ter 8+ linhas
- impact_scope='hard' quando há regra operacional nova ou redefinição de ICP/oferta`

async function deepExtractFromAttachment(openAiKey, clienteNome, assetText, modelOverride) {
  const trimmedText = assetText.slice(0, ATTACHMENT_INLINE_MAX_CHARS)
  const modelToUse = modelOverride || DEEP_EXTRACTION_MODEL
  const isReasoning = modelToUse.startsWith('o1')
  // Modelos não-reasoning aceitam temperature; reasoning não. Idem json schema.
  const body: Record<string, unknown> = {
    model: modelToUse,
    max_output_tokens: 8000,
    input: [
      { role: 'user', content: [{ type: 'input_text', text: `${DEEP_EXTRACTION_PROMPT}\n\nCLIENTE: ${clienteNome}\n\nMATERIAL:\n${trimmedText}` }] },
    ],
  }
  if (!isReasoning) body.temperature = 0.2

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(DEEP_EXTRACTION_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('[deep-extract] failed:', data?.error?.message)
    return null
  }
  const raw = extractOpenAiText(data)
  if (!raw) return null
  // Tenta parsear JSON (o1-mini pode adicionar markdown)
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  }
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    console.error('[deep-extract] parse fail:', cleaned.slice(0, 200))
    return null
  }
}

// Renderiza a topificação como markdown legível pra mostrar no chat
function renderTopificationMarkdown(topif) {
  if (!topif || !topif.categorias) return ''
  const cat = topif.categorias
  const labels = {
    acordos_firmados: '📌 Acordos firmados',
    cronograma_e_deadlines: '📅 Cronograma & deadlines',
    pessoas_mencionadas: '👥 Pessoas mencionadas',
    dados_e_numeros: '📊 Dados & números',
    orcamento_e_investimento: '💰 Orçamento & investimento',
    decisoes_estrategicas: '🎯 Decisões estratégicas',
    decisoes_operacionais: '⚙️ Decisões operacionais',
    insights: '💡 Insights',
    ideias_propostas: '🚀 Ideias propostas',
    concorrencia_citada: '🏢 Concorrência citada',
    wins_mencionados: '✅ Wins mencionados',
    riscos_e_atencoes: '⚠️ Riscos & atenções',
  }
  const parts = []
  if (topif.titulo_reuniao) parts.push(`# ${topif.titulo_reuniao}`)
  if (topif.data_reuniao) parts.push(`*${topif.data_reuniao}*`)
  parts.push('')
  for (const [key, label] of Object.entries(labels)) {
    const items = cat[key] || []
    if (!Array.isArray(items) || items.length === 0) continue
    parts.push(`### ${label}`)
    for (const it of items) parts.push(`- ${it}`)
    parts.push('')
  }
  return parts.join('\n').trim()
}

// Mescla dois objetos "after" de memory_proposal. Para cada campo string,
// concatena com deduplicação por linha. Pra channel_notes, faz merge por chave.
function mergeMemoryAfter(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  const result = {}
  const mergeString = (a, b) => {
    if (!a) return b
    if (!b) return a
    if (a === b) return a
    // Dedup por linha
    const linesA = a.split('\n').map(l => l.trim()).filter(Boolean)
    const linesB = b.split('\n').map(l => l.trim()).filter(Boolean)
    const seen = new Set(linesA.map(l => l.toLowerCase()))
    for (const lb of linesB) {
      if (!seen.has(lb.toLowerCase())) {
        linesA.push(lb)
        seen.add(lb.toLowerCase())
      }
    }
    return linesA.join('\n')
  }
  const stringFields = ['executive_summary','service_scope','business_context','offer_context','icp_context','operational_rules','risks','brand_positioning','creative_learnings','content_strategy','wins','losses','competition_notes','team_and_process','key_metrics']
  for (const f of stringFields) {
    result[f] = mergeString(existing[f] || null, incoming[f] || null)
  }
  // channel_notes
  result.channel_notes = {
    meta: mergeString(existing.channel_notes?.meta || null, incoming.channel_notes?.meta || null),
    google: mergeString(existing.channel_notes?.google || null, incoming.channel_notes?.google || null),
    notas_gerais: mergeString(existing.channel_notes?.notas_gerais || null, incoming.channel_notes?.notas_gerais || null),
  }
  return result
}

function buildHistoryMessages(history) {
  const out = []
  for (const m of history) {
    if (!m.texto && !m.payload_json) continue
    const role = m.role === 'agent' ? 'assistant' : (m.role === 'user' ? 'user' : 'system')
    let text = m.texto || ''
    if (!text && m.payload_json) text = JSON.stringify(m.payload_json).slice(0, 800)
    if (!text.trim()) continue
    out.push({
      role,
      content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
    })
  }
  return out
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

    const body = await req.json().catch(() => ({}))
    const { session_token, client_id, message, client_generated_id, model, pending_asset } = body || {}

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!client_id) return json(req, { error: 'client_id obrigatório.' }, 400)
    // Mensagem pode vir vazia se houver pending_asset (anexo sozinho)
    const hasMessage = typeof message === 'string' && message.trim().length > 0
    const hasAsset = pending_asset && typeof pending_asset === 'object'
      && typeof pending_asset.text === 'string' && pending_asset.text.trim().length > 0
    if (!hasMessage && !hasAsset) {
      return json(req, { error: 'message ou pending_asset obrigatório.' }, 400)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (user.role !== 'admin' && user.role !== 'ngp') {
      return json(req, { error: 'Apenas equipe NGP.' }, 403)
    }

    // Aceita tanto clientes.id quanto usuarios.id (cliente do front vem como usuarios.id)
    let cliente = null
    const tryDirect = await sb.from('clientes').select('id, nome').eq('id', client_id).maybeSingle()
    if (tryDirect.data) {
      cliente = tryDirect.data
    } else {
      const tryByUser = await sb.from('clientes').select('id, nome').eq('usuario_id', client_id).maybeSingle()
      if (tryByUser.data) cliente = tryByUser.data
    }
    if (!cliente) return json(req, { error: 'Cliente não encontrado.' }, 404)
    // Daqui pra frente usar SEMPRE o cliente.id resolvido (não o client_id recebido)
    const resolvedClientId = cliente.id

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'OPENAI_API_KEY não configurada.' }, 500)

    const conversationId = await getOrCreateConversation(sb, resolvedClientId, user.usuario_id)

    // Se veio um pending_asset (paste-as-attachment), cria o campaign_asset inline.
    // O texto bruto vai pro extracted_text; asset-ingest pode ser chamado depois
    // pra gerar sumário melhor. Aqui já temos o texto, então usamos como contexto.
    let attachedAssetId = null
    let attachedAssetSnippet = null
    if (hasAsset) {
      const rawText = String(pending_asset.text).slice(0, 200_000) // 200KB cap
      const assetTypeRaw = pending_asset.asset_type || 'transcript_reuniao'
      const allowedTypes = ['transcript_reuniao', 'planejamento_html', 'planejamento_pdf', 'outro']
      const assetType = allowedTypes.includes(assetTypeRaw) ? assetTypeRaw : 'transcript_reuniao'
      const label = pending_asset.label || `Texto colado · ${new Date().toLocaleString('pt-BR')}`

      const { data: assetRow, error: assetErr } = await sb.from('campaign_assets').insert({
        client_id: resolvedClientId,
        conversation_id: conversationId,
        asset_type: assetType,
        label,
        storage_provider: 'external_link',
        external_url: 'inline://paste',
        mime_type: 'text/plain',
        extracted_text: rawText,
        extraction_status: 'pending',
        created_by_usuario_id: user.usuario_id,
      }).select('id').single()

      if (assetErr) {
        console.error('[copilot-chat] asset insert:', assetErr.message)
        return json(req, { error: `Falha ao salvar anexo: ${assetErr.message}` }, 500)
      }
      attachedAssetId = assetRow.id
      // Envia o anexo INTEIRO (até ATTACHMENT_INLINE_MAX_CHARS) pra IA usar
      // como contexto da primeira passada. asset-ingest gera sumário em paralelo
      // pra próximas conversas (mais barato).
      attachedAssetSnippet = rawText.slice(0, ATTACHMENT_INLINE_MAX_CHARS)

      // Dispara asset-ingest em background pra sumarizar (não bloqueia resposta).
      // No primeiro request, o contexto já recebe o texto bruto direto (camada extra abaixo).
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/copilot-asset-ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
        },
        body: JSON.stringify({ session_token, asset_id: attachedAssetId }),
      }).catch((e) => console.error('[copilot-chat] async ingest dispatch:', e?.message))
    }

    // Grava a mensagem do usuário (idempotente via client_generated_id).
    // Quando há anexo, kind='text_file' (informa o front que tem attachment).
    const userTexto = hasMessage
      ? message.trim()
      : (hasAsset ? `(anexou: ${pending_asset.label || 'texto colado'})` : '')
    const userKind = hasAsset ? 'text_file' : 'text'
    const userPayload = hasAsset
      ? {
          asset_id: attachedAssetId,
          asset_type: pending_asset.asset_type || 'transcript_reuniao',
          label: pending_asset.label || null,
          chars: pending_asset.text.length,
          words: pending_asset.text.trim().split(/\s+/).filter(Boolean).length,
        }
      : null

    const userMsgInsert = {
      conversation_id: conversationId,
      client_id: resolvedClientId,
      role: 'user',
      kind: userKind,
      texto: userTexto,
      payload_json: userPayload,
      autor_usuario_id: user.usuario_id,
      client_generated_id: client_generated_id || null,
    }
    const { error: insErr } = await sb.from('copilot_messages').insert(userMsgInsert)
    if (insErr && !insErr.message?.includes('duplicate key')) {
      console.error('[copilot-chat] insert user msg:', insErr.message)
      return json(req, { error: 'Falha ao salvar mensagem.' }, 500)
    }

    // Carrega contexto em camadas (passa user message como query pra full-text)
    const queryForSearch = hasMessage ? message : (attachedAssetSnippet || '')
    const ctx = await loadContext(sb, resolvedClientId, conversationId, queryForSearch)
    const contextBlock = buildContextBlock(ctx)

    // Aceita modelos OpenAI conhecidos. Lista deve casar com lib/copilot/models.ts no front.
    const ALLOWED_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'gpt-5'])
    const selectedModel = (typeof model === 'string' && ALLOWED_MODELS.has(model)) ? model : DEFAULT_MODEL
    // Modelos reasoning (o1-*) NÃO aceitam temperature nem json_schema strict
    // — precisamos ajustar a chamada abaixo conforme o tipo.
    const isReasoningModel = selectedModel.startsWith('o1')

    // ========================================================================
    // PASSADA 1 (só se houver anexo): TOPIFICAÇÃO com o1-mini
    // Lê o anexo inteiro, organiza em 12 categorias estruturadas.
    // Esta topificação fica salva no campaign_asset e vira input da passada 2.
    // ========================================================================
    let topification = null
    if (hasAsset) {
      try {
        // Usa o modelo escolhido pelo usuário pra topificação também.
        // Se for gpt-4o-mini, topificação fica barata mas menos densa.
        // Se for o1-mini, topificação fica densa (recomendado pra transcript).
        topification = await deepExtractFromAttachment(openAiKey, cliente.nome, pending_asset.text, selectedModel)
        if (topification && attachedAssetId) {
          await sb.from('campaign_assets').update({
            extracted_summary: renderTopificationMarkdown(topification),
            extracted_metadata: { topification, source: 'copilot-chat-deep-extraction', model_used: selectedModel },
            extraction_model: selectedModel,
            extraction_status: 'done',
            extracted_at: new Date().toISOString(),
          }).eq('id', attachedAssetId)
        }
      } catch (e) {
        console.error('[copilot-chat] topification failed:', e?.message)
      }
    }

    // Bloco que entra no prompt da passada 2 (destilação)
    const assetBlock = hasAsset && topification
      ? `\n\n=== TOPIFICAÇÃO ESTRUTURADA DA REUNIÃO/MATERIAL ===\n${JSON.stringify(topification, null, 2)}\n=== FIM DA TOPIFICAÇÃO ===\n\nUse esta topificação como FONTE DE VERDADE. NÃO invente nada além do que está nela.`
      : attachedAssetSnippet
        ? `\n\n=== ANEXO BRUTO (topificação falhou, fallback) ===\n${attachedAssetSnippet}${pending_asset.text.length > ATTACHMENT_INLINE_MAX_CHARS ? `\n[... +${pending_asset.text.length - ATTACHMENT_INLINE_MAX_CHARS} chars truncados]` : '\n=== FIM ==='}`
        : ''

    const userBlockText = hasMessage
      ? message.trim() + assetBlock
      : `Anexei o material acima.${assetBlock}\n\nGere reply curto comentando o que mais importa E memory_proposal DENSO destilando a topificação em campos do profile.`

    // Quando há topificação, usa o prompt de destilação. Caso contrário, conversa normal.
    const activeSystemPrompt = topification ? DISTILLATION_PROMPT : SYSTEM_PROMPT

    const input = [
      { role: 'system', content: [{ type: 'input_text', text: activeSystemPrompt }] },
      { role: 'system', content: [{ type: 'input_text', text: `CLIENTE: ${cliente.nome}\n\n${contextBlock}` }] },
      ...buildHistoryMessages(ctx.history),
      { role: 'user', content: [{ type: 'input_text', text: userBlockText }] },
    ]

    // Monta payload diferente pra reasoning model (o1-*): sem temperature/json_schema strict.
    // Pra reasoning, instruímos no prompt a devolver JSON puro e parseamos depois.
    const openAiPayload: Record<string, unknown> = {
      model: selectedModel,
      max_output_tokens: isReasoningModel ? Math.max(MAX_OUTPUT_TOKENS, 4000) : MAX_OUTPUT_TOKENS,
      input,
    }
    if (!isReasoningModel) {
      openAiPayload.temperature = 0.4
      openAiPayload.text = {
        format: {
          type: 'json_schema',
          name: 'copilot_turn',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      }
    } else {
      // Pra reasoning model, reforça no último user message que tem que ser JSON puro
      const lastUserIdx = input.length - 1
      if (input[lastUserIdx]?.role === 'user') {
        input[lastUserIdx].content[0].text += `\n\nRESPONDA APENAS COM JSON ESTRITO seguindo este schema (sem markdown, sem comentários):\n${JSON.stringify(RESPONSE_SCHEMA, null, 2)}`
      }
    }

    let aiRes
    try {
      aiRes = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(isReasoningModel ? DEEP_EXTRACTION_TIMEOUT_MS : OPENAI_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAiKey}`,
        },
        body: JSON.stringify(openAiPayload),
      })
    } catch (e) {
      console.error('[copilot-chat] OpenAI fetch:', e?.message)
      return json(req, { error: 'A IA demorou demais. Tente novamente.' }, 504)
    }

    const aiData = await aiRes.json().catch(() => ({}))
    if (!aiRes.ok) {
      const msg = aiData?.error?.message || `Erro ${aiRes.status} na IA.`
      console.error('[copilot-chat] OpenAI error:', msg)
      return json(req, { error: msg }, aiRes.status >= 500 ? 502 : 400)
    }

    const raw = extractOpenAiText(aiData)
    if (!raw) return json(req, { error: 'A IA não retornou dados.' }, 502)

    let parsed
    try {
      // Reasoning models (o1) podem cercar com ```json ... ```. Limpa antes de parse.
      let cleaned = raw.trim()
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
      }
      parsed = JSON.parse(cleaned)
    } catch (e) {
      console.error('[copilot-chat] JSON parse fail:', raw.slice(0, 200))
      return json(req, { error: 'Resposta da IA mal-formada.' }, 502)
    }

    const replyKind = parsed.reply_kind || 'text'
    const agentRunId = aiData?.id || null

    // Se houve topificação, grava ANTES da reply uma mensagem rica com o sumário
    // (vira card colapsível no chat). Assim o usuário vê o que a IA extraiu.
    if (topification) {
      await sb.from('copilot_messages').insert({
        conversation_id: conversationId,
        client_id: resolvedClientId,
        role: 'system',
        kind: 'agent_analysis',
        texto: renderTopificationMarkdown(topification),
        payload_json: {
          topification,
          asset_id: attachedAssetId,
          source: 'deep_extraction',
        },
        agent_model: selectedModel,
      })
    }

    // Grava resposta do agente
    const { data: agentMsg, error: agentInsErr } = await sb
      .from('copilot_messages')
      .insert({
        conversation_id: conversationId,
        client_id: resolvedClientId,
        role: 'agent',
        kind: replyKind,
        texto: parsed.reply,
        agent_model: selectedModel,
        agent_run_id: agentRunId,
      })
      .select('id')
      .single()
    if (agentInsErr) {
      console.error('[copilot-chat] insert agent msg:', agentInsErr.message)
    }

    // Memory proposal → DEDUPE: se há plan pendente recente, MESCLA com ele
    // em vez de criar duplicado. UI fica limpa, profile cresce de forma incremental.
    let memoryPlanId = null
    let autoAppliedMemory = false
    let mergedExisting = false
    if (parsed.memory_proposal) {
      const mp = parsed.memory_proposal
      const beforeSnapshot = ctx.profile || {}

      // mp.after já foi gerado pela passada 2 (destilação) usando a topificação
      const proposedAfter = mp.after

      // Procura plan pendente recente (mesmo cliente, tipo memory_update, < 24h)
      const cutoffIso = new Date(Date.now() - MERGE_PENDING_PLAN_WINDOW_HOURS * 3600 * 1000).toISOString()
      const { data: pendingPlans } = await sb.from('agent_plans')
        .select('id, title, reasoning_summary, proposal_json, confidence, impact_scope')
        .eq('client_id', resolvedClientId)
        .eq('plan_type', 'memory_update')
        .eq('status', 'pending_approval')
        .gte('created_at', cutoffIso)
        .order('created_at', { ascending: false })
        .limit(1)

      const existingPending = pendingPlans && pendingPlans.length > 0 ? pendingPlans[0] : null

      let plan = null
      let planErr = null

      if (existingPending) {
        // MERGE: combina proposal_json.after do plan existente com a nova proposta
        const mergedAfter = mergeMemoryAfter(
          existingPending.proposal_json?.after || {},
          proposedAfter
        )
        const updated = await sb.from('agent_plans').update({
          title: existingPending.title, // mantém título original
          reasoning_summary: existingPending.reasoning_summary + '\n\n+ ' + mp.reasoning,
          proposal_json: { before: beforeSnapshot, after: mergedAfter, merged_runs: (existingPending.proposal_json?.merged_runs || 1) + 1 },
          confidence: Math.max(Number(existingPending.confidence) || 0.5, Number(mp.confidence) || 0.5),
          // Se algum dos dois é 'hard', o mesclado também é
          impact_scope: existingPending.impact_scope === 'hard' || mp.impact_scope === 'hard' ? 'hard' : 'soft',
          updated_at: new Date().toISOString(),
        }).eq('id', existingPending.id).select('id, status, confidence, impact_scope, needs_escalation').single()
        plan = updated.data
        planErr = updated.error
        if (plan) mergedExisting = true
      } else {
        const inserted = await sb.from('agent_plans').insert({
          client_id: resolvedClientId,
          conversation_id: conversationId,
          source_message_id: agentMsg?.id || null,
          plan_type: 'memory_update',
          impact_scope: mp.impact_scope || 'soft',
          title: mp.title,
          reasoning_summary: mp.reasoning,
          proposal_json: { before: beforeSnapshot, after: proposedAfter, merged_runs: 1 },
          confidence: Math.max(0, Math.min(1, Number(mp.confidence) || 0.5)),
          needs_escalation: !!mp.needs_escalation,
          agent_model: selectedModel,
          agent_run_id: agentRunId,
        }).select('id, status, confidence, impact_scope, needs_escalation').single()
        plan = inserted.data
        planErr = inserted.error
      }

      if (!planErr && plan) {
        memoryPlanId = plan.id
        // Auto-apply desligado por padrão (Arthur prefere aprovar)
        if (
          AUTO_APPLY_MEMORY_UPDATES
          && plan.impact_scope === 'soft'
          && plan.confidence >= 0.80
          && !plan.needs_escalation
        ) {
          const { error: applyErr } = await sb.rpc('copilot_apply_memory_update', { plan_id: plan.id })
          if (!applyErr) {
            autoAppliedMemory = true
            await sb.from('copilot_messages').insert({
              conversation_id: conversationId,
              client_id: resolvedClientId,
              role: 'system',
              kind: 'memory_update',
              texto: `Memória do cliente atualizada automaticamente: ${mp.title}`,
              payload_json: { plan_id: plan.id, auto_applied: true },
            })
          } else {
            console.error('[copilot-chat] auto-apply failed:', applyErr.message)
          }
        }
      } else if (planErr) {
        console.error('[copilot-chat] insert memory plan:', planErr.message)
      }
    }

    // Timeline proposal → escreve direto (eventos não exigem aprovação, são log)
    let timelineEventId = null
    if (parsed.timeline_proposal) {
      const tp = parsed.timeline_proposal
      const { data: ev, error: evErr } = await sb
        .from('client_timeline_events')
        .insert({
          client_id: resolvedClientId,
          event_type: tp.event_type,
          title: tp.title,
          description: tp.description,
          motivador: tp.motivador,
          resultado_esperado: tp.resultado_esperado,
          reference_table: 'copilot_messages',
          reference_id: agentMsg?.id || null,
          created_by_agent: true,
          created_by_usuario_id: user.usuario_id,
        })
        .select('id')
        .single()
      if (!evErr && ev) timelineEventId = ev.id
      else if (evErr) console.error('[copilot-chat] insert timeline event:', evErr.message)
    }

    return json(req, {
      conversation_id: conversationId,
      message_id: agentMsg?.id || null,
      reply: parsed.reply,
      reply_kind: replyKind,
      memory_plan_id: memoryPlanId,
      memory_plan_merged: mergedExisting,
      memory_auto_applied: autoAppliedMemory,
      timeline_event_id: timelineEventId,
      attached_asset_id: attachedAssetId,
      topification_generated: !!topification,
    })
  } catch (e) {
    console.error('[copilot-chat]', e?.message || e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
