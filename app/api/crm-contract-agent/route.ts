import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cache de sessões validadas para evitar query no Supabase a cada mensagem do chat
const SESSION_CACHE = new Map<string, { userId: string; expiresAt: number }>()
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos

async function validateSession(token: string): Promise<string | null> {
  const now = Date.now()
  const cached = SESSION_CACHE.get(token)
  if (cached && cached.expiresAt > now) return cached.userId

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data } = await sb
    .from('sessions')
    .select('usuario_id')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!data) return null
  SESSION_CACHE.set(token, { userId: data.usuario_id, expiresAt: now + SESSION_CACHE_TTL_MS })
  return data.usuario_id
}

const OPENAI_TIMEOUT_MS = 35_000
const MAX_OUTPUT_TOKENS = 900
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const FIELD_KEYS = [
  'nomeCliente',
  'cnpjCliente',
  'enderecoCliente',
  'telefoneCliente',
  'nomeResponsavel',
  'nacionalidade',
  'estadoCivil',
  'profissao',
  'rgResponsavel',
  'cpfResponsavel',
  'enderecoResponsavel',
  'plataformas',
  'valorMensal',
  'valorMensalExtenso',
  'valorMinimoTrafego',
  'valorParcela',
  'diaEmissaoNfSubsequente',
  'diaVencimento',
  'vencimentoParcela1',
  'vencimentoParcela2',
  'vencimentoParcela3',
  'dataContrato',
  'cidadeContrato',
] as const

const STRUCTURED_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assistant_reply: { type: 'string' },
    extracted_fields: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        FIELD_KEYS.map((field) => [field, { type: ['string', 'null'] }])
      ),
      required: FIELD_KEYS,
    },
  },
  required: ['assistant_reply', 'extracted_fields'],
}

function cleanText(value: unknown, max = 1200) {
  return String(value || '').trim().slice(0, max)
}

function sanitizeTranscript(raw: unknown) {
  if (!Array.isArray(raw)) return []

  return raw
    .slice(-10)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const role = entry.role === 'assistant' ? 'assistant' : 'user'
      const content = cleanText(entry.content, 800)
      if (!content) return null
      return { role, content }
    })
    .filter((entry): entry is { role: 'assistant' | 'user'; content: string } => Boolean(entry))
}

function buildEmptyExtractedFields() {
  return Object.fromEntries(FIELD_KEYS.map((field) => [field, null]))
}

function extractOpenAiText(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text

  const parts: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) parts.push(content.text)
      else if (typeof content?.text === 'string') parts.push(content.text)
    }
  }

  return parts.join('\n').trim()
}

function mapOpenAiError(openAiData: any, status: number) {
  const code = String(openAiData?.error?.code || '')
  const rawMessage = String(openAiData?.error?.message || '')
  const normalized = rawMessage.toLowerCase()

  if (code === 'invalid_api_key' || normalized.includes('incorrect api key')) {
    return {
      status: 401,
      message: 'A chave da OpenAI configurada neste ambiente e invalida ou expirou.',
    }
  }

  if (code === 'insufficient_quota' || normalized.includes('quota')) {
    return {
      status: 402,
      message: 'A conta da OpenAI esta sem saldo ou sem cota disponivel no momento.',
    }
  }

  if (status >= 500) {
    return {
      status: 502,
      message: 'A OpenAI falhou ao responder agora. Tenta novamente em alguns segundos.',
    }
  }

  return {
    status: 400,
    message: 'Nao foi possivel processar a mensagem com a IA neste momento.',
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nao configurada no ambiente local.' }, { status: 500 })
    }

    const body = await req.json()
    const { session_token, message, draft = {}, transcript = [] } = body || {}

    if (!session_token) {
      return NextResponse.json({ error: 'Sessao invalida. Faça login novamente.' }, { status: 401 })
    }

    const userId = await validateSession(session_token)
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && !userId) {
      return NextResponse.json({ error: 'Sessao expirada. Faca login novamente.' }, { status: 401 })
    }

    if (!cleanText(message, 4000)) {
      return NextResponse.json({ error: 'Mensagem obrigatoria.' }, { status: 400 })
    }

    const safeDraft = Object.fromEntries(
      FIELD_KEYS.map((field) => [field, cleanText(draft?.[field], 400)])
    )
    const safeTranscript = sanitizeTranscript(transcript)

    const systemPrompt = `Voce e o Assistente Comercial da NGP - Nova Gestao de Performance.
Sua unica funcao e coletar dados para preencher um contrato padrao de Gestao de Trafego e Performance.
Converse de forma direta, profissional e curta, em portugues do Brasil.

Regras obrigatorias:
- Nunca invente dados.
- Extraia tudo o que estiver explicito na mensagem do usuario.
- Se o usuario corrigir um dado anterior, devolva o valor novo no campo correspondente.
- Se nao houver certeza suficiente sobre um campo, retorne null nesse campo.
- Nao altere campos fixos da NGP.
- Nao gere contrato.
- Nao devolva resumo final completo; apenas continue a coleta.
- A resposta assistant_reply deve ter no maximo 70 palavras e pedir so o proximo bloco que estiver faltando.

Campos disponiveis:
- nomeCliente, cnpjCliente, enderecoCliente, telefoneCliente
- nomeResponsavel, nacionalidade, estadoCivil, profissao, rgResponsavel, cpfResponsavel, enderecoResponsavel
- plataformas, valorMensal, valorMensalExtenso, valorMinimoTrafego, valorParcela
- diaEmissaoNfSubsequente, diaVencimento, vencimentoParcela1, vencimentoParcela2, vencimentoParcela3
- dataContrato, cidadeContrato

Formato esperado:
- Retorne SOMENTE JSON valido no schema informado.
- extracted_fields deve conter todos os campos do schema.
- Quando a mensagem nao trouxer um campo, deixe null.
- Pode formatar CPF, CNPJ, telefone, datas e valores se o usuario mandou sem pontuacao.
`

    const userPrompt = `Estado atual do contrato:
${JSON.stringify(safeDraft, null, 2)}

Historico recente:
${safeTranscript.length ? safeTranscript.map((item) => `${item.role}: ${item.content}`).join('\n') : '(sem historico relevante)'}

Mensagem atual do usuario:
${cleanText(message, 4000)}

Objetivo agora:
1. Extrair qualquer campo informado na mensagem atual ou claramente corrigido.
2. Responder com uma frase curta guiando a coleta do que ainda faz sentido pedir em seguida.
3. Se aparentemente todos os dados ja vieram, use assistant_reply para dizer que fechou a coleta e que vai confirmar no proximo passo.
`

    let openAiResponse: Response
    try {
      openAiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.2,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: 'ngp_contract_collection',
              strict: true,
              schema: STRUCTURED_RESPONSE_SCHEMA,
            },
          },
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: systemPrompt }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: userPrompt }],
            },
          ],
        }),
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (error) {
      console.error('[api/crm-contract-agent] OpenAI fetch failed', error)
      return NextResponse.json({ error: 'Nao consegui conectar com a IA agora. Tenta novamente em alguns segundos.' }, { status: 504 })
    }

    const openAiData = await openAiResponse.json().catch(() => ({}))
    if (!openAiResponse.ok) {
      console.error('[api/crm-contract-agent] OpenAI error', {
        status: openAiResponse.status,
        code: openAiData?.error?.code,
        type: openAiData?.error?.type,
      })
      const mapped = mapOpenAiError(openAiData, openAiResponse.status)
      return NextResponse.json({ error: mapped.message }, { status: mapped.status })
    }

    const raw = extractOpenAiText(openAiData)
    if (!raw) {
      return NextResponse.json({ error: 'A IA nao retornou conteudo para o agente de contratos.' }, { status: 502 })
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.error('[api/crm-contract-agent] Invalid JSON from OpenAI', raw, error)
      return NextResponse.json({ error: 'A IA retornou um formato invalido para o agente de contratos.' }, { status: 502 })
    }

    return NextResponse.json({
      assistant_reply: cleanText(parsed?.assistant_reply, 1000),
      extracted_fields: {
        ...buildEmptyExtractedFields(),
        ...(parsed?.extracted_fields || {}),
      },
    })
  } catch (error) {
    console.error('[api/crm-contract-agent]', error)
    return NextResponse.json({ error: 'Erro interno ao processar o agente de contratos.' }, { status: 500 })
  }
}
