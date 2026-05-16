// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'

const OPENAI_TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 1200
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

const SYSTEM_PROMPT = `Voce e um assistente comercial da NGP/AmplaSoft que conduz uma ENTREVISTA com o vendedor para montar uma proposta comercial profissional.

REGRAS DE CONDUCAO:
- Faca UMA pergunta por vez, de forma natural, como se fosse um colega ajudando a estruturar a proposta.
- Comece pelos campos mais criticos: cliente, tipo de projeto, valor. Depois va aprofundando.
- NUNCA pergunte algo que ja foi respondido (verifique o "estado atual" antes).
- Quando ja tiver informacao suficiente para preencher 1 ou mais campos, EXTRAIA na hora — sem esperar tudo terminar.
- Quando achar que tem TUDO que precisa (cliente, tipo, dor, valores, itens), diga: "Acho que ja temos tudo. Pode revisar a proposta ao lado e exportar quando quiser." e marque done=true.
- Tom: profissional mas leve. Portugues brasileiro. SEM emojis, SEM markdown.
- Mensagens curtas (1-3 frases). Direto ao ponto.

CAMPOS QUE VOCE PRECISA EXTRAIR (devolva como fields_to_update):
- clienteNome, clienteDoc (CNPJ), clienteContato (whatsapp/email), clienteSegmento
- tipoProjeto: "Site" | "Software" | "Performance/Vendas" | "Comercial Digital"
- dorPrincipal: 1 frase resumo do problema do cliente
- faturamentoMedio, ticketMedio, investimentoMensal: strings curtas ("80k", "R$ 8.000")
- canalLeads, tempoResposta, taxaConversao, crmAtual: strings curtas
- prazoContrato: "12 meses", "6 meses" etc.
- condicaoPagamento: "Mensal recorrente", "A vista", "Cartao 10x" etc.
- onboardingDias: numero
- itens: array de servicos vendidos

REGRA DOS ITENS (descricao + escopo):
- descricao: CAIXA ALTA, comercial e vendedora. Ex: "GESTAO DE TRAFEGO PAGO - META + GOOGLE ADS"
- escopo: 3-6 entregaveis concretos separados por " • ". Ex: "Auditoria de pixel • Planejamento de campanhas • Criativos mensais • Otimizacao diaria • Relatorio semanal • Reuniao mensal"
- vlr_un: numero puro. Se servico mensal por X meses, vlr_un = valor mensal e qtd = X.
- Setup sempre item separado da mensalidade.

ESTRATEGIA DE ENTREVISTA (siga essa ordem geral, mas adapte):
1. "Qual o cliente que vamos atender?" (nome, e se vier junto CNPJ/contato/segmento, aproveite)
2. "Qual o tipo do projeto? Performance, Software, Site ou Comercial Digital?"
3. "Qual a principal dor do cliente?" (se for performance, perguntar tambem investimento atual e faturamento)
4. "Qual o valor que voce fechou? Tem setup separado da mensalidade?"
5. "Por quanto tempo? Mensal recorrente ou prazo definido?"
6. Confirmar e encerrar.

FORMATO DE RESPOSTA (JSON estrito):
{
  "message": "sua pergunta ou comentario para o vendedor",
  "fields_to_update": { ... apenas campos novos detectados na ultima resposta do usuario ... },
  "done": false
}

REGRAS CRITICAS DE EXTRACAO (evitar duplicatas):
- NUNCA inclua um campo em fields_to_update se voce ja vê ele preenchido no ESTADO ATUAL com o mesmo valor.
- Para campos simples (strings/numbers): mande null se nao mudou nada nessa rodada.
- Para itens (array): mande null OU array vazio [] se nao ha NOVO item ou MUDANCA real. Nao reenvie itens ja extraidos anteriormente. So mande itens quando o usuario adicionar/corrigir item.
- Se voce ja extraiu um item antes e o usuario nao mencionou mudanca, NAO reenvie.
- Se quiser CORRIGIR um item ja existente, reenvie com a MESMA descricao (CAIXA ALTA identica) que o sistema substitui no lugar.`

const FIELD_SCHEMA = {
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
    prazoContrato: { type: ['string', 'null'] },
    condicaoPagamento: { type: ['string', 'null'] },
    onboardingDias: { type: ['number', 'null'] },
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
  },
  required: [
    'clienteNome', 'clienteDoc', 'clienteContato', 'clienteSegmento',
    'tipoProjeto', 'dorPrincipal', 'faturamentoMedio', 'ticketMedio',
    'investimentoMensal', 'canalLeads', 'tempoResposta', 'taxaConversao',
    'crmAtual', 'prazoContrato', 'condicaoPagamento', 'onboardingDias', 'itens',
  ],
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string' },
    fields_to_update: FIELD_SCHEMA,
    done: { type: 'boolean' },
  },
  required: ['message', 'fields_to_update', 'done'],
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, history, current_state, custom_instructions } = await req.json()
    if (!session_token) return json(req, { error: 'Sessao invalida.' }, 401)
    if (!Array.isArray(history)) return json(req, { error: 'history deve ser um array.' }, 400)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessao expirada.' }, 401)

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'IA nao configurada. Configure OPENAI_API_KEY nos Supabase Secrets.' }, 500)

    const customInstr = typeof custom_instructions === 'string' ? custom_instructions.trim().slice(0, 2000) : ''
    const stateText = current_state ? JSON.stringify(current_state, null, 2) : '{}'

    const inputMessages = [
      { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
    ]
    if (customInstr) {
      inputMessages.push({
        role: 'system',
        content: [{ type: 'input_text', text: `INSTRUCOES ESPECIFICAS DO VENDEDOR:\n${customInstr}` }],
      })
    }
    inputMessages.push({
      role: 'system',
      content: [{ type: 'input_text', text: `ESTADO ATUAL DA PROPOSTA (campos ja preenchidos):\n${stateText}\n\nNao pergunte sobre campos que ja tem valor preenchido. Foque nos que ainda estao vazios/null.` }],
    })

    // Limita o historico para nao explodir tokens (mantem ultimas 20 mensagens)
    const trimmedHistory = history.slice(-20)
    for (const m of trimmedHistory) {
      const role = m.role === 'assistant' ? 'assistant' : 'user'
      const text = typeof m.content === 'string' ? m.content : String(m.content || '')
      if (!text.trim()) continue
      inputMessages.push({
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
      })
    }

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
          temperature: 0.4,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: 'proposta_chat_turn',
              strict: true,
              schema: RESPONSE_SCHEMA,
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
      console.error('[crm-proposta-chat-ai] OpenAI error:', msg)
      return json(req, { error: msg }, aiRes.status >= 500 ? 502 : 400)
    }

    const raw = extractOpenAiText(aiData)
    if (!raw) return json(req, { error: 'A IA nao retornou dados. Tente novamente.' }, 502)

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('[crm-proposta-chat-ai] JSON parse fail:', raw)
      return json(req, { error: 'IA retornou formato invalido. Tente novamente.' }, 502)
    }

    return json(req, parsed)

  } catch (e) {
    console.error('[crm-proposta-chat-ai]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
