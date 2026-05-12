// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { isNgp, validateSession } from '../_shared/roles.ts'

const OPENAI_TIMEOUT_MS = 35_000
const MAX_OUTPUT_TOKENS = 900

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
    .filter(Boolean)
}

function buildEmptyExtractedFields() {
  return Object.fromEntries(FIELD_KEYS.map((field) => [field, null]))
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, message, draft = {}, transcript = [] } = body

    if (!session_token) return json(req, { error: 'Sessao invalida.' }, 401)
    if (!cleanText(message, 4000)) return json(req, { error: 'Mensagem obrigatoria.' }, 400)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const sessionUser = await validateSession(sb, session_token)
    if (!sessionUser) return json(req, { error: 'Sessao expirada.' }, 401)
    if (!isNgp(sessionUser.role)) return json(req, { error: 'Acesso nao autorizado.' }, 403)

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'IA nao configurada. Defina OPENAI_API_KEY no Supabase.' }, 500)

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
          model: 'gpt-4o-mini',
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
      })
    } catch {
      return json(req, { error: 'A IA demorou demais para responder.' }, 504)
    }

    const aiData = await aiRes.json().catch(() => ({}))
    if (!aiRes.ok) {
      const message = aiData?.error?.message || `Erro ${aiRes.status} ao consultar a IA.`
      return json(req, { error: message }, aiRes.status >= 500 ? 502 : 400)
    }

    const raw = extractOpenAiText(aiData)
    if (!raw) {
      return json(req, { error: 'A IA nao retornou conteudo para o agente de contrato.' }, 502)
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return json(req, { error: 'A IA retornou um formato invalido para o agente de contrato.' }, 502)
    }

    return json(req, {
      assistant_reply: cleanText(parsed?.assistant_reply, 1000),
      extracted_fields: {
        ...buildEmptyExtractedFields(),
        ...(parsed?.extracted_fields || {}),
      },
    })
  } catch (error) {
    console.error('[crm-contract-agent]', error)
    return json(req, { error: 'Erro interno ao processar o agente de contratos.' }, 500)
  }
})
