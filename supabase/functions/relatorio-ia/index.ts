// IA do relatório de performance. 3 modos:
//   - 'resumo':      texto curto pro campo "Resumo da semana"
//   - 'criativo':    justificativa "por que este criativo ganha"
//   - 'comparativo': bullets do que melhorou/piorou vs semana anterior
//
// Auth: exige session_token válido E role=ngp. Cliente nunca chama isso.
// IMPORTANTE: cors/validateSession/isNgp são INLINE para evitar dependência
// de _shared/* no deploy via MCP (que não bundle-ia diretórios externos).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  return null
}
function json(_req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}
// deno-lint-ignore no-explicit-any
async function validateSession(sb: any, token: string): Promise<{ usuario_id: string; role: string } | null> {
  const { data: sessions } = await sb
    .from('sessions')
    .select('usuario_id, expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  if (!sessions?.length) return null
  const userId = sessions[0].usuario_id
  const { data: usuario } = await sb
    .from('usuarios')
    .select('role, ativo')
    .eq('id', userId)
    .single()
  if (!usuario || !usuario.ativo) return null
  return { usuario_id: userId, role: usuario.role || '' }
}
function isNgp(role: string): boolean { return role === 'ngp' || role === 'admin' }

// Rate limit por usuário/dia/ação. Não é segurança crítica — é proteção contra
// loop bug que poderia explodir a conta OpenAI. Admin é isento.
const RATE_LIMITS: Record<string, number> = {
  resumo: 50,
  criativo: 200,
  comparativo: 50,
}
// deno-lint-ignore no-explicit-any
async function checkRateLimit(sb: any, userId: string, role: string, acao: string): Promise<{ ok: boolean; total?: number; limit?: number }> {
  if (role === 'admin') return { ok: true }
  const limit = RATE_LIMITS[acao]
  if (!limit) return { ok: true }
  const { data, error } = await sb.rpc('ia_usage_increment', { p_usuario_id: userId, p_acao: acao })
  if (error) {
    console.warn('[rate-limit] rpc falhou (ignorando):', error.message)
    return { ok: true } // Se RPC der erro, NÃO bloqueia uso legítimo
  }
  const total = typeof data === 'number' ? data : 0
  return { ok: total <= limit, total, limit }
}

const OPENAI_TIMEOUT_MS = 45000
const MAX_OUTPUT_TOKENS = 700
const MODEL = 'gpt-4o-mini' // mesma família usada em ai-generate-analysis

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as Record<string, unknown>
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e))
}

// Esquemas JSON Schema strict para cada modo. Garante saída previsível.
const SCHEMAS: Record<string, unknown> = {
  resumo: {
    type: 'object',
    additionalProperties: false,
    properties: { texto: { type: 'string' } },
    required: ['texto'],
  },
  criativo: {
    type: 'object',
    additionalProperties: false,
    properties: { porqueGanha: { type: 'string' } },
    required: ['porqueGanha'],
  },
  comparativo: {
    type: 'object',
    additionalProperties: false,
    properties: {
      melhorou: { type: 'array', items: { type: 'string' } },
      piorou: { type: 'array', items: { type: 'string' } },
      neutro: { type: 'array', items: { type: 'string' } },
    },
    required: ['melhorou', 'piorou', 'neutro'],
  },
}

const SYSTEM_PROMPTS: Record<string, string> = {
  resumo:
    'Você está escrevendo um COMUNICADO da agência NGP para o cliente — como se fosse uma mensagem ' +
    'no WhatsApp ou um e-mail curto resumindo o período. NÃO é um relatório técnico; o relatório está ' +
    'aí, com a tabela completa. Este texto é só pra deixar o cliente TRANQUILO ou alertá-lo sobre algo. ' +
    'Tom: conversa profissional, mas humana. Use "esse período", "a gente", "rodamos", "testamos". ' +
    'Evite jargão. Comece direto pelo que importa pro cliente (resultado prático, não métrica). ' +
    '' +
    'IMPORTANTE: você vai receber um campo `historico` com 2 valores possíveis: ' +
    '- "com_periodo_anterior": HÁ dados do período anterior pra comparar. Faça comparação ("mais leads que o período anterior", "CPL caiu", etc). ' +
    '- "sem_periodo_anterior": cliente NOVO ou sem histórico. NÃO COMPARE. Foque no resultado absoluto desta janela. ' +
    'Ex sem histórico: "Essa é a primeira semana rodando para a AWA. A gente entregou um volume de leads dentro do esperado, com CPL competitivo pro nicho." ' +
    '' +
    'Exemplos de boa abertura COM histórico: "Essa semana entregamos mais leads que a anterior, mantendo o investimento." ' +
    '"Tivemos uma semana de ajustes — testamos novos públicos e o resultado já apareceu." ' +
    '"Semana mais cara que a anterior, mas com leads mais qualificados." ' +
    '2 a 4 frases. Última frase deve sinalizar o que vem pela frente ("na próxima semana vamos focar em X"). ' +
    'PROIBIDO: ' +
    '- Começar com "No período de DD/MM a DD/MM"; ' +
    '- Citar valores monetários totais ou números brutos (R$ 1.831, 38 leads, 85.469 pessoas); ' +
    '- Frases tipo "indicam um desempenho estável", "evidenciam eficiência"; ' +
    '- Sigla técnica sem traduzir (em vez de "CPL", fale "custo por lead" — e só se realmente precisar); ' +
    '- COMPARAR com período anterior quando historico=sem_periodo_anterior (não inventar comparação que não existe). ' +
    'NUNCA invente dado. Retorne JSON {texto: string}.',
  criativo:
    'Você está escrevendo uma OBSERVAÇÃO da agência NGP pro cliente, embaixo do anúncio. ' +
    'É como se você estivesse no WhatsApp explicando "olha, esse criativo aqui ficou em X lugar porque...". ' +
    'O cliente JÁ VÊ os números (CTR, CPL, ROAS) ao lado — não precisa repetir. ' +
    '' +
    'ATENÇÃO À POSIÇÃO NO RANKING. O cliente vai receber `posicao` (1, 2, 3, 4) e `total_criativos`. ' +
    'Você DEVE adaptar a fala segundo a posição: ' +
    '- POSIÇÃO 1: explique POR QUE este foi o MELHOR da semana. Tom: "Ele puxou o resultado da semana." ' +
    'Ex: "Saiu na frente porque a pessoa abre falando direto pra câmera, sem rodeios — e isso prende quem está rolando o feed." ' +
    '- POSIÇÃO 2: explique POR QUE ficou ATRÁS DO 1º (não diga que ele "se destaca"; ele perdeu). Tom comparativo: "Ficou em segundo porque, apesar de bom, o 1º…" ' +
    'Ex: "Bom criativo, mas ficou atrás porque a abordagem é mais formal — o 1º trouxe mais proximidade com o cliente." ' +
    '- POSIÇÃO 3+: explique POR QUE rendeu MENOS que os de cima. Tom: "Performou menos porque…" ' +
    'Ex: "Esse rendeu menos. A imagem é bonita mas falta uma chamada direta que os de cima trazem." ' +
    '' +
    'FONTES que você recebe (use AS QUE EXISTIREM, na ordem de prioridade): ' +
    '1) TRANSCRIÇÃO do áudio do vídeo (se vier) — é a fonte mais rica. Descreva o que a pessoa FALA, ' +
    'a ABERTURA do roteiro, a OFERTA mencionada, o TOM (informativo, urgente, emocional, técnico). ' +
    '2) IMAGEM do criativo — descreva o VISUAL que explica a performance (cor, cena, presença humana, oferta destacada). ' +
    '3) CRIATIVOS COMPARATIVOS — cada um carrega sua POSIÇÃO. Use isso pra contrastar com o de CIMA (se você for 2º+) ou com os de BAIXO (se você for 1º). ' +
    '' +
    'Tom: conversa, não relatório. 2 a 3 frases curtas. Se TRANSCRIÇÃO existir, ela DEVE ser a base — ' +
    'visual vira complemento. SEMPRE faça referência à posição (1º/2º/3º) — explícita ou implícita. ' +
    'PROIBIDO: ' +
    '- Citar números: "CTR de 1,13%", "ROAS de 29x", "CPL de R$ 7"; ' +
    '- Frases tipo "demonstra eficiência", "evidencia retorno", "indicando engajamento"; ' +
    '- Começar com "Este criativo se destacou" QUANDO POSICAO > 1 (ele NÃO se destacou — ficou atrás); ' +
    '- Tratar 2º ou 3º como "vencedor" ou "se destaca"; ' +
    '- Citar a transcrição literalmente entre aspas (resuma o que foi dito); ' +
    '- Linguagem de planilha. Linguagem de gente conversando. ' +
    'Retorne JSON {porqueGanha: string}.',
  comparativo:
    'Você está escrevendo BULLETS de comparação semana atual vs anterior, PARA O CLIENTE. ' +
    'Tom: WhatsApp da agência NGP pro cliente. Conversa profissional, mas humana. ' +
    'A tabela JÁ mostra os números — NÃO repita. Sua função é traduzir pro IMPACTO no negócio do cliente. ' +
    '' +
    'Exemplos do tom que quero: ' +
    '"melhorou": ["A gente entregou mais leads sem mexer no investimento.", "O CPL caiu — pagando menos por cada contato.", "Os anúncios alcançaram mais gente que na semana passada."] ' +
    '"piorou": ["A frequência subiu — o público começou a ver muito o mesmo anúncio, vamos trocar a peça.", "O custo de impactar mil pessoas ficou mais caro, hora de rever segmentação."] ' +
    '"neutro": só se for algo que o cliente precisa SABER mesmo sem mudança (ex: "Investimento mantido conforme combinado."). ' +
    '' +
    'PROIBIDO ABSOLUTO: ' +
    '- Citar NÚMEROS BRUTOS: "112 leads", "92.300 pessoas", "R$ 9,94", "R$ 1.113,72", "4.583 cliques"; ' +
    '- Citar variação absoluta: "subiu de 1,2% para 1,4%", "totalizando X"; ' +
    '- Começar com "CTR", "CPL", "ROAS", "CPM", "%"; ' +
    '- Símbolos ✓ ⚠ — no início da frase (já vem do client); ' +
    '- Frases formais tipo "atingindo", "totalizando", "no período"; ' +
    '- Mais de 14 palavras por bullet. ' +
    '' +
    'Cada bullet começa com VERBO ("Conseguimos…", "Pagamos…", "Alcançamos…") ou com o IMPACTO ("O CPL caiu", "A frequência subiu"). ' +
    'Use "a gente", "rodamos", "essa semana", "o público". Linguagem de quem está conversando, não relatando. ' +
    'Retorne JSON {melhorou: string[], piorou: string[], neutro: string[]}.',
}

function buildUserPrompt(mode: string, payload: Record<string, unknown>): string {
  const cliente = String(payload.cliente || 'Cliente')
  const periodo = String(payload.periodo || '')
  const metricas = payload.metricas || {}
  const metricasAnt = payload.metricas_anterior || {}
  const criativo = payload.criativo || null
  const criativosComparativos = Array.isArray(payload.criativos_comparativos) ? payload.criativos_comparativos : []
  const posicao = typeof payload.posicao === 'number' ? payload.posicao : Number(payload.posicao) || 0

  const lines: string[] = []
  lines.push(`Cliente: ${cliente}`)
  if (periodo) lines.push(`Periodo: ${periodo}`)

  if (mode === 'criativo' && criativo) {
    const totalCriativos = payload.total_criativos
    if (posicao && totalCriativos) {
      lines.push(`Posicao no ranking: ${posicao}o lugar de ${totalCriativos} criativos`)
    } else if (posicao) {
      lines.push(`Posicao no ranking: ${posicao}o lugar`)
    }
    lines.push('', `=== CRIATIVO ${posicao || '?'}o LUGAR (este que voce esta analisando) ===`)
    lines.push(JSON.stringify(criativo, null, 2))
    const transcricaoPrincipal = typeof payload.transcricao_principal === 'string' ? payload.transcricao_principal.trim() : ''
    if (transcricaoPrincipal) {
      lines.push('', '=== TRANSCRICAO DO AUDIO DESTE VIDEO ===')
      lines.push(transcricaoPrincipal)
    }
    if (criativosComparativos.length) {
      lines.push('', '=== OUTROS CRIATIVOS DO MESMO PERIODO (para contraste) ===')
      // Marca a posicao de cada um claramente
      for (const cmp of criativosComparativos as Array<Record<string, unknown>>) {
        const pos = cmp.posicao ? `${cmp.posicao}o LUGAR` : 'POSICAO ?'
        lines.push(`--- ${pos} ---`)
        lines.push(JSON.stringify(cmp, null, 2))
      }
    }
    const taskByPos = posicao === 1
      ? 'Tarefa: este criativo foi o MELHOR (1o lugar). Explique POR QUE ele venceu, contrastando com os outros que ficaram atras.'
      : posicao === 2
        ? 'Tarefa: este criativo ficou em 2o lugar. Explique POR QUE ele FICOU ATRAS do 1o lugar. Nao diga que "se destaca" — ele perdeu.'
        : posicao && posicao > 2
          ? `Tarefa: este criativo ficou em ${posicao}o lugar. Explique POR QUE rendeu MENOS que os de cima. Foque no que falta nele em relacao aos melhores.`
          : 'Tarefa: explique a performance deste criativo em relacao aos outros do periodo.'
    lines.push('', taskByPos + ' Se TRANSCRICAO foi enviada, use o roteiro/fala como base. Imagem complementa. NAO recite as metricas — elas ja estao na tabela.')
  } else {
    const historico = typeof payload.historico === 'string' ? payload.historico : ''
    if (historico) lines.push(`Historico: ${historico}`)
    lines.push('', 'Metricas atuais:')
    lines.push(JSON.stringify(metricas, null, 2))
    if (mode === 'comparativo' || mode === 'resumo') {
      if (metricasAnt && Object.keys(metricasAnt as Record<string, unknown>).length) {
        lines.push('', 'Metricas periodo anterior:')
        lines.push(JSON.stringify(metricasAnt, null, 2))
      } else if (mode === 'resumo') {
        lines.push('', 'IMPORTANTE: NAO ha dados do periodo anterior (cliente novo ou primeira janela). NAO COMPARE.')
      }
    }
  }

  lines.push('', 'IMPORTANTE: Nao invente nada. Use SOMENTE os dados acima.')
  return lines.join('\n')
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, mode } = body as { session_token?: string; mode?: string }

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!mode || !SCHEMAS[mode]) {
      return json(req, { error: `mode inválido. Use: ${Object.keys(SCHEMAS).join(', ')}` }, 400)
    }

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    // Valida sessão e role (validateSession já retorna role)
    const session = await validateSession(sb, session_token)
    if (!session) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isNgp(session.role)) {
      return json(req, { error: 'Apenas gestores NGP podem usar IA no relatório.' }, 403)
    }

    // Rate limit — protege contra loop bug explodindo a conta OpenAI
    const rl = await checkRateLimit(sb, session.usuario_id, session.role, mode)
    if (!rl.ok) {
      return json(req, {
        error: `Limite diário de IA atingido (${rl.total}/${rl.limit} chamadas de "${mode}"). Tente amanhã ou peça ao admin.`,
        rate_limited: true,
      }, 429)
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      return json(req, { error: 'OPENAI_API_KEY não configurada nos Supabase Secrets.' }, 500)
    }

    const userText = buildUserPrompt(mode, body)
    const schema = SCHEMAS[mode]
    const systemPrompt = SYSTEM_PROMPTS[mode]

    // Modo criativo: anexa imagem(ns) ao content do user pra análise visual.
    // imagem_principal: imagem do criativo analisado.
    // imagens_comparativas: array de URLs dos outros criativos do mesmo período.
    type UserContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }
    const userContent: UserContent[] = [{ type: 'input_text', text: userText }]
    if (mode === 'criativo') {
      const imgPrincipal = typeof body.imagem_principal === 'string' ? body.imagem_principal : ''
      if (imgPrincipal) {
        userContent.push({ type: 'input_text', text: '\n[CRIATIVO PRINCIPAL — analisar abaixo]' })
        userContent.push({ type: 'input_image', image_url: imgPrincipal })
      }
      const imgsComp = Array.isArray(body.imagens_comparativas) ? body.imagens_comparativas : []
      if (imgsComp.length) {
        userContent.push({ type: 'input_text', text: '\n[CRIATIVOS COMPARATIVOS — para contraste]' })
        for (const u of imgsComp) {
          if (typeof u === 'string' && u) userContent.push({ type: 'input_image', image_url: u })
        }
      }
    }

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
          model: MODEL,
          temperature: 0.4,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: `relatorio_ia_${mode}`,
              strict: true,
              schema,
            },
          },
          input: [
            { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
            { role: 'user', content: userContent },
          ],
        }),
      })
    } catch {
      return json(req, { error: 'A IA demorou demais para responder. Tente novamente.' }, 504)
    }

    const aiData = await aiRes.json().catch(() => ({}))
    if (!aiRes.ok) {
      const message = aiData?.error?.message || `Erro ${aiRes.status} na IA.`
      return json(req, { error: message }, aiRes.status >= 500 ? 502 : 400)
    }

    // Extrai texto da resposta. Padrão da OpenAI Responses API: output[0].content[0].text
    let output = ''
    if (Array.isArray(aiData?.output)) {
      for (const o of aiData.output) {
        if (Array.isArray(o?.content)) {
          for (const c of o.content) {
            if (typeof c?.text === 'string') output += c.text
          }
        }
      }
    }
    if (!output && typeof aiData?.output_text === 'string') output = aiData.output_text

    if (!output) return json(req, { error: 'IA não retornou conteúdo.' }, 502)

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(output)
    } catch {
      return json(req, { error: 'IA retornou formato inválido.' }, 502)
    }

    return json(req, { ok: true, result: parsed })
  } catch (e) {
    console.error('[relatorio-ia] catch:', e)
    return json(req, { error: errMsg(e) }, 500)
  }
})
