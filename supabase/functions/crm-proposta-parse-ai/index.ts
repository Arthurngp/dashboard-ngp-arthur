// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'

const OPENAI_TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 1500
const MODEL = 'gpt-4o'

function corsHeaders(req) {
  const origin = req.headers.get('origin') || ''
  const list = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)
  if (list.length > 0) {
    return {
      'Access-Control-Allow-Origin': list.includes(origin) ? origin : '',
      'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    }
  }
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

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

const SYSTEM_PROMPT = `Voce e um assistente comercial da NGP/AmplaSoft (agencia de performance + softhouse). Extrai dados de briefings e devolve JSON estruturado para preencher uma proposta comercial PROFISSIONAL E VENDEDORA.

REGRAS CRITICAS:
- Devolva APENAS JSON valido, sem markdown, sem comentarios, sem texto antes/depois.
- Se um campo nao foi mencionado no briefing, devolva null. NUNCA invente dados que nao foram ditos.
- Valores monetarios em "vlr_un": numeros puros (8000, nao "R$ 8.000").
- Campos texto monetarios (faturamentoMedio, investimentoMensal): formato curto como "80k" ou "R$ 8.000".

TIPO DE PROJETO (use EXATAMENTE um destes valores):
- "Performance/Vendas" - trafego pago, gestao de ads, Meta/Google Ads, performance marketing
- "Software" - sistema, app, plataforma, automacao, CRM custom
- "Site" - site institucional, landing page, hotsite
- "Comercial Digital" - SDR, prospeccao, gestao comercial, RD Station, pipeline

CONDICOES:
- condicaoPagamento: se nao explicito, "Mensal recorrente". Aceita "Cartao 10x", "30/60/90", "A vista".
- prazoContrato: "12 meses", "6 meses", "Indeterminado" etc.
- onboardingDias: numero, default 7.

== ITENS (regra mais importante) ==

Cada item: { descricao (string CURTA em CAIXA ALTA), escopo (string detalhada multilinha), vlr_un (numero), qtd (numero) }.

DESCRICAO (titulo do servico):
- Comercial e vendedora, em CAIXA ALTA, sem prazo.
- ERRADO: "PERFORMANCE", "GESTAO DE PERFORMANCE POR 3 MESES", "ACOMPANHAMENTO DE VENDAS"
- CERTO: "GESTAO DE TRAFEGO PAGO - META + GOOGLE ADS", "AQUISICAO DE CLIENTES VIA META ADS", "CONSULTORIA COMERCIAL E ESTRUTURACAO DE PIPELINE", "DESENVOLVIMENTO DE PLATAFORMA WEB SOB MEDIDA"

ESCOPO (o que sera entregue):
- SEMPRE de 3 a 6 entregaveis concretos, separados por " • " (bullet + espaco).
- Cada entregavel comeca com verbo no infinitivo ou substantivo de acao.
- ERRADO: "Gestao de performance por 3 meses"
- CERTO: "Planejamento e estruturacao de campanhas Meta Ads e Google Ads • Criacao de pixel, eventos e UTMs • Otimizacao diaria de lances e segmentacoes • Relatorio semanal de performance • Reuniao mensal de alinhamento estrategico"

QUANTIDADE (qtd):
- Se servico recorrente mensal com prazo (ex: "8k/mes por 12 meses"), use qtd = numero de meses, vlr_un = valor mensal.
- Se servico unico (setup, projeto), qtd = 1.

SETUP/ONBOARDING (regra obrigatoria):
- Se o briefing mencionar QUALQUER valor de setup, onboarding, implementacao, ativacao, configuracao inicial — SEMPRE crie um item SEPARADO antes da mensalidade.
- Mesmo se o briefing nao mencionar setup mas houver complexidade de implementacao (ex: software, integracao, CRM), considere sugerir um item de "SETUP & ONBOARDING" — porem deixe o vlr_un=0 para o usuario revisar.

EXEMPLO DE ITEM PERFEITO (Performance):
{
  "descricao": "GESTAO DE TRAFEGO PAGO - META + GOOGLE ADS",
  "escopo": "Auditoria inicial de contas e pixel • Planejamento estrategico de campanhas Meta e Google • Criacao de criativos e copies (ate 6 variacoes/mes) • Otimizacao diaria de lances, publicos e segmentacoes • Relatorio semanal com KPIs e insights • Reuniao mensal de alinhamento com gestor dedicado",
  "vlr_un": 8000,
  "qtd": 12
}

Portugues brasileiro. Nomes proprios capitalizados corretamente. NUNCA use markdown nas strings.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    clienteNome: { type: ['string', 'null'] },
    clienteDoc: { type: ['string', 'null'] },
    clienteContato: { type: ['string', 'null'] },
    clienteSegmento: { type: ['string', 'null'] },
    tipoProjeto: {
      type: ['string', 'null'],
      enum: ['Site', 'Software', 'Performance/Vendas', 'Comercial Digital', null],
    },
    dorPrincipal: { type: ['string', 'null'] },
    faturamentoMedio: { type: ['string', 'null'] },
    ticketMedio: { type: ['string', 'null'] },
    investimentoMensal: { type: ['string', 'null'] },
    canalLeads: { type: ['string', 'null'] },
    tempoResposta: { type: ['string', 'null'] },
    taxaConversao: { type: ['string', 'null'] },
    crmAtual: { type: ['string', 'null'] },
    itens: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          descricao: { type: 'string' },
          escopo: { type: 'string' },
          vlr_un: { type: 'number' },
          qtd: { type: 'number' },
        },
        required: ['descricao', 'escopo', 'vlr_un', 'qtd'],
      },
    },
    prazoContrato: { type: ['string', 'null'] },
    condicaoPagamento: { type: ['string', 'null'] },
    onboardingDias: { type: ['number', 'null'] },
  },
  required: [
    'clienteNome', 'clienteDoc', 'clienteContato', 'clienteSegmento',
    'tipoProjeto', 'dorPrincipal', 'faturamentoMedio', 'ticketMedio',
    'investimentoMensal', 'canalLeads', 'tempoResposta', 'taxaConversao',
    'crmAtual', 'itens', 'prazoContrato', 'condicaoPagamento', 'onboardingDias',
  ],
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, briefing, custom_instructions } = await req.json()
    if (!session_token) return json(req, { error: 'Sessao invalida.' }, 401)
    if (!briefing || typeof briefing !== 'string' || briefing.trim().length < 10) {
      return json(req, { error: 'Briefing muito curto. Descreva o cliente, dor e valores em pelo menos 10 caracteres.' }, 400)
    }
    const customInstr = typeof custom_instructions === 'string' ? custom_instructions.trim().slice(0, 2000) : ''

    const sb = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessao expirada.' }, 401)

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'IA nao configurada. Configure OPENAI_API_KEY nos Supabase Secrets.' }, 500)

    const inputMessages = [
      { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
    ]
    if (customInstr) {
      inputMessages.push({
        role: 'system',
        content: [{ type: 'input_text', text: `INSTRUCOES ESPECIFICAS DO VENDEDOR (aplique sobre as regras acima):\n${customInstr}` }],
      })
    }
    inputMessages.push({
      role: 'user',
      content: [{ type: 'input_text', text: `BRIEFING:\n${briefing.trim()}` }],
    })

    let aiRes
    try {
      aiRes = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: 'proposta_extracao',
              strict: true,
              schema: SCHEMA,
            },
          },
          input: inputMessages,
        }),
      })
    } catch {
      return json(req, { error: 'A IA demorou demais. Tente novamente.' }, 504)
    }

    const aiData = await aiRes.json().catch(() => ({}))
    if (!aiRes.ok) {
      const msg = aiData?.error?.message || `Erro ${aiRes.status} na IA.`
      console.error('[crm-proposta-parse-ai] OpenAI error:', msg)
      return json(req, { error: msg }, aiRes.status >= 500 ? 502 : 400)
    }

    const raw = extractOpenAiText(aiData)
    if (!raw) return json(req, { error: 'A IA nao retornou dados. Tente novamente.' }, 502)

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('[crm-proposta-parse-ai] JSON parse fail:', raw)
      return json(req, { error: 'IA retornou formato invalido. Tente novamente.' }, 502)
    }

    return json(req, { extracted: parsed })

  } catch (e) {
    console.error('[crm-proposta-parse-ai]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
