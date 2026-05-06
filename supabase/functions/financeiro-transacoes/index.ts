import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { lastDayOfMonth, normalizeDateOnly, normalizeText, parseCurrencyInput } from "../_shared/financeiro.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeSearchText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function isInternalTransferTransaction(tx: any): boolean {
  const combined = [
    tx?.descricao,
    tx?.observacoes,
    tx?.categoria?.nome,
  ].map(normalizeSearchText).join(' ')

  return (
    combined.includes('transfer') ||
    combined.includes('movimentacao entre contas') ||
    combined.includes('movimentacao interna') ||
    combined.includes('entre contas')
  )
}

function parseImportDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  const iso = normalizeDateOnly(raw)
  if (iso) return iso
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

async function ensureCategoria(sb: any, nome: string, tipo: 'entrada' | 'saida') {
  const normalizedNome = normalizeText(nome)
  if (!normalizedNome) return null
  const existing = await sb.from('fin_categorias')
    .select('id,nome,tipo')
    .eq('ativo', true)
    .eq('nome', normalizedNome)
    .eq('tipo', tipo)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.id) return existing.data.id

  const insert = await sb.from('fin_categorias')
    .insert({ nome: normalizedNome, tipo, cor: tipo === 'entrada' ? '#059669' : '#dc2626' })
    .select('id')
    .single()
  if (insert.error) throw insert.error
  return insert.data.id
}

async function ensureCostCenter(sb: any, nome: string) {
  const normalizedNome = normalizeText(nome)
  if (!normalizedNome) return null
  const existing = await sb.from('fin_cost_centers')
    .select('id,nome')
    .eq('ativo', true)
    .eq('nome', normalizedNome)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.id) return existing.data.id

  const insert = await sb.from('fin_cost_centers')
    .insert({ nome: normalizedNome })
    .select('id')
    .single()
  if (insert.error) throw insert.error
  return insert.data.id
}

async function ensureAccount(sb: any, nome: string) {
  const normalizedNome = normalizeText(nome)
  if (!normalizedNome) return null
  const existing = await sb.from('fin_accounts')
    .select('id,nome')
    .or('ativo.is.null,ativo.eq.true')
    .eq('nome', normalizedNome)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.id) return { id: existing.data.id, created: false, nome: existing.data.nome }

  const insert = await sb.from('fin_accounts')
    .insert({ nome: normalizedNome, tipo: 'banco', saldo_inicial: 0, ativo: true })
    .select('id,nome')
    .single()
  if (insert.error) throw insert.error
  return { id: insert.data.id, created: true, nome: insert.data.nome }
}

async function ensureContato(sb: any, nome: string, tipo: 'entrada' | 'saida', userId: string) {
  const normalizedNome = normalizeText(nome)
  if (!normalizedNome) return { cliente_id: null, fornecedor_id: null }

  if (tipo === 'saida') {
    const existing = await sb.from('fin_fornecedores')
      .select('id,nome')
      .eq('ativo', true)
      .eq('nome', normalizedNome)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data?.id) return { cliente_id: null, fornecedor_id: existing.data.id }

    const insert = await sb.from('fin_fornecedores')
      .insert({ nome: normalizedNome, created_by: userId })
      .select('id')
      .single()
    if (insert.error) throw insert.error
    return { cliente_id: null, fornecedor_id: insert.data.id }
  }

  const existing = await sb.from('fin_clientes')
    .select('id,nome')
    .eq('ativo', true)
    .eq('nome', normalizedNome)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.id) return { cliente_id: existing.data.id, fornecedor_id: null }

  const insert = await sb.from('fin_clientes')
    .insert({ nome: normalizedNome, created_by: userId })
    .select('id')
    .single()
  if (insert.error) throw insert.error
  return { cliente_id: insert.data.id, fornecedor_id: null }
}

function extractOpenAiText(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text
  const parts: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      // Prioriza output_text; se não, qualquer text string. Nunca os dois (duplicaria JSON).
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        parts.push(content.text)
      } else if (typeof content?.text === 'string') {
        parts.push(content.text)
      }
    }
  }
  return parts.join('\n').trim()
}

async function analyzeImportWithAi(rows: any[], accountName: string) {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return null

  const sample = rows.slice(0, 80).map((row, index) => ({
    linha: index + 2,
    tipo: row.tipo,
    descricao: row.descricao,
    categoria: row.categoria,
    contato: row.contato,
    valor: row.valor,
    status: row.status,
    competence_date: row.competence_date,
    payment_date: row.payment_date,
  }))

  const totals = rows.reduce((acc, row) => {
    if (row.tipo === 'entrada') acc.entradas += Number(row.valor || 0)
    else acc.saidas += Number(row.valor || 0)
    return acc
  }, { entradas: 0, saidas: 0 })

  const categoryCounts = Object.entries(rows.reduce((acc: Record<string, number>, row) => {
    const key = normalizeText(row.categoria) || 'Sem categoria'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12)

  const prompt = {
    conta: accountName,
    total_linhas: rows.length,
    entradas: totals.entradas,
    saidas: totals.saidas,
    categorias_mais_frequentes: categoryCounts,
    amostra: sample,
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      summary: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } },
      opportunities: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['headline', 'summary', 'warnings', 'opportunities', 'confidence'],
  }

  const aiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'Você analisa importações financeiras de CSV antes da gravação. Seja conservador. Alerte inconsistências, duplicidades prováveis, categorias estranhas, transferências suspeitas e padrões que mereçam revisão humana. Não invente fatos. Responda em português do Brasil.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify(prompt),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'finance_import_review',
          schema,
          strict: true,
        },
      },
      max_output_tokens: 700,
    }),
  })

  if (!aiRes.ok) return null
  const aiData = await aiRes.json()
  const raw = extractOpenAiText(aiData)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function matchDuplicatesWithAi(
  sb: any,
  csvRows: any[],
  accountId: string | null,
  accountName: string,
): Promise<{ matches: any[]; debug: any }> {
  const debug: any = {
    csv_rows_count: csvRows.length,
    account_id: accountId,
    account_name: accountName,
    has_openai_key: !!Deno.env.get('OPENAI_API_KEY'),
  }
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (csvRows.length === 0) { debug.exit = 'no_csv_rows'; return { matches: [], debug } }

  // Determina range de datas do CSV (ampliado em 5 dias)
  const dates = csvRows.map(r => r.competence_date).filter(Boolean).sort()
  debug.csv_dates_count = dates.length
  debug.csv_first_row_sample = csvRows[0] ? {
    competence_date: csvRows[0].competence_date,
    descricao: csvRows[0].descricao,
    valor: csvRows[0].valor,
  } : null
  if (dates.length === 0) { debug.exit = 'no_dates_in_csv'; return { matches: [], debug } }

  const minDateObj = new Date(dates[0])
  minDateObj.setDate(minDateObj.getDate() - 5)
  const minDate = minDateObj.toISOString().split('T')[0]

  const maxDateObj = new Date(dates[dates.length - 1])
  maxDateObj.setDate(maxDateObj.getDate() + 5)
  const maxDate = maxDateObj.toISOString().split('T')[0]

  debug.search_range = { minDate, maxDate }

  // Busca lançamentos existentes no range de datas (na mesma conta, se fornecida)
  // Busca tanto por competence_date quanto payment_date (cobre ambos os casos)
  let q = sb.from('fin_transacoes')
    .select('id,tipo,descricao,valor,competence_date,payment_date,status,account_id,categoria:fin_categorias(nome),cliente:fin_clientes(nome),fornecedor:fin_fornecedores(nome)')
    .or(`and(competence_date.gte.${minDate},competence_date.lte.${maxDate}),and(payment_date.gte.${minDate},payment_date.lte.${maxDate})`)
    .limit(500)
  if (accountId) q = q.eq('account_id', accountId)

  const { data: existing, error: existingErr } = await q
  if (existingErr) {
    debug.exit = 'db_query_error'
    debug.error = String(existingErr.message || existingErr)
    return { matches: [], debug }
  }
  debug.existing_count = existing?.length || 0
  if (!existing || existing.length === 0) {
    debug.exit = 'no_existing_in_range'
    return { matches: [], debug }
  }

  // Pré-filtro: agrupa por valor + proximidade de data (até 5 dias)
  // Compara contra COMPETENCE_DATE *e* PAYMENT_DATE do existente
  type Candidate = {
    csv_index: number
    csv_desc: string
    csv_tipo: string
    csv_valor: number
    csv_date: string
    csv_status: string
    csv_contato: string
    existing_id: string
    existing_desc: string
    existing_tipo: string
    existing_valor: number
    existing_date: string
    existing_status: string
    existing_categoria: string
    existing_contato: string
  }

  // Para cada linha do CSV, coleta candidatos e limita aos 3 mais próximos por data
  type CandidateWithDiff = Candidate & { _diffDays: number }
  const candidates: Candidate[] = []
  for (let i = 0; i < csvRows.length; i++) {
    const row = csvRows[i]
    const csvValor = Math.abs(Number(row.valor || 0))
    const csvDate = row.competence_date
    if (!csvDate || csvValor <= 0) continue

    const rowCandidates: CandidateWithDiff[] = []
    for (const ex of existing) {
      const exValor = Math.abs(Number(ex.valor || 0))
      const exDates = [ex.competence_date, ex.payment_date].filter(Boolean) as string[]
      let bestDiffDays = Infinity
      let bestExDate = ''
      for (const exDate of exDates) {
        const d1 = new Date(csvDate)
        const d2 = new Date(exDate)
        const diff = Math.abs((d1.getTime() - d2.getTime()) / (1000 * 3600 * 24))
        if (diff < bestDiffDays) { bestDiffDays = diff; bestExDate = exDate }
      }

      // Candidatos: mesmo valor (tolerância R$0.05) e até 5 dias de diferença
      if (Math.abs(csvValor - exValor) <= 0.05 && bestDiffDays <= 5) {
        rowCandidates.push({
          csv_index: i,
          csv_desc: String(row.descricao || ''),
          csv_tipo: String(row.tipo || ''),
          csv_valor: csvValor,
          csv_date: csvDate,
          csv_status: String(row.status || ''),
          csv_contato: String(row.contato || ''),
          existing_id: ex.id,
          existing_desc: ex.descricao,
          existing_tipo: ex.tipo,
          existing_valor: exValor,
          existing_date: bestExDate || ex.competence_date,
          existing_status: ex.status,
          existing_categoria: ex.categoria?.nome || '',
          existing_contato: ex.cliente?.nome || ex.fornecedor?.nome || '',
          _diffDays: bestDiffDays,
        })
      }
    }

    // Mantém só os 3 candidatos mais próximos por data (evita explosão em CSV de taxas repetitivas)
    rowCandidates.sort((a, b) => a._diffDays - b._diffDays)
    for (const c of rowCandidates.slice(0, 3)) {
      const { _diffDays, ...clean } = c
      candidates.push(clean)
    }
  }

  debug.candidates_count = candidates.length
  if (candidates.length === 0) {
    debug.exit = 'no_candidates_matched_value_and_date'
    // Adiciona amostra dos valores no DB pra debug
    debug.db_sample_values = existing.slice(0, 5).map((e: any) => ({
      desc: e.descricao,
      valor: e.valor,
      date: e.competence_date,
    }))
    debug.csv_sample_values = csvRows.slice(0, 5).map((r: any) => ({
      desc: r.descricao,
      valor: r.valor,
      date: r.competence_date,
    }))
    return { matches: [], debug }
  }

  // Sem OpenAI: NÃO usa heurística (geraria falsos positivos demais).
  // Retorna vazio com flag pra UI mostrar banner explicando.
  if (!openAiKey) {
    debug.exit = 'no_openai_key'
    debug.error_user_facing = 'Detecção por IA indisponível: configure OPENAI_API_KEY nas Edge Functions do Supabase.'
    return { matches: [], debug }
  }

  // Limita candidatos para não estourar tokens (max 60 pares)
  const limitedCandidates = candidates.slice(0, 60)
  debug.limited_candidates_count = limitedCandidates.length

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pair_index: { type: 'number' },
            is_duplicate: { type: 'boolean' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
          required: ['pair_index', 'is_duplicate', 'confidence', 'reason'],
        },
      },
    },
    required: ['matches'],
  }

  const pairsForAi = limitedCandidates.map((c, idx) => ({
    pair_index: idx,
    csv: {
      descricao: c.csv_desc,
      tipo: c.csv_tipo,
      valor: c.csv_valor,
      data: c.csv_date,
      status: c.csv_status,
      contato: c.csv_contato,
    },
    existente: {
      descricao: c.existing_desc,
      tipo: c.existing_tipo,
      valor: c.existing_valor,
      data: c.existing_date,
      status: c.existing_status,
      categoria: c.existing_categoria,
      contato: c.existing_contato,
    },
  }))

  try {
    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: [
                'Você é especialista em conciliação financeira. Recebe pares (CSV vindo de extrato bancário/Asaas vs lançamento já cadastrado no sistema).',
                'Todos os pares já bateram em VALOR e DATA próxima. Sua tarefa: decidir se é a MESMA transação.',
                '',
                'REGRA #1 — CONTATO/CLIENTE/FORNECEDOR É O SINAL MAIS FORTE:',
                '- Se ambos têm contato e os contatos referem-se a pessoas/empresas DIFERENTES → NÃO é duplicata (is_duplicate=false), mesmo com valor e data iguais. É coincidência.',
                '- Exemplo: "Mariana Duarte" vs "Espaço Maurício Vanute" → NÃO é match.',
                '- Exemplo: "CF Serviços de Engenharia" vs "Santa Cruz Confecções" → NÃO é match.',
                '',
                'REGRA #2 — MESMO CONTATO/CLIENTE = MATCH FORTE:',
                '- Se contatos batem (mesmo nome ou um contém o outro), confidence=high.',
                '- Exemplo: sistema "Solucione Energia Eletrica" + CSV "SOLUCIONE ENERGIA ELÉTRICA LTDA" → high (mesma empresa).',
                '- Exemplo: sistema "Santa Cruz Confecções" + CSV "fatura SANTA CRUZ CONFECCOES LTDA" → high.',
                '- Exemplo: descrição do plano sem contato no CSV (ex: sistema "Plano Elite – Solucione" + CSV "fatura SOLUCIONE ENERGIA"), inferir do nome → high.',
                '',
                'REGRA #3 — SEM CONTATO EM AMBOS:',
                '- Compare descrições. Cobrança/fatura genérica do CSV pode ser plano/serviço específico do sistema → medium.',
                '- Se descrições são incompatíveis → false.',
                '',
                'REGRA #4 — TRANSFERÊNCIAS NGP→NGP:',
                '- Se ambos mencionam "NGP", "NOVA GESTAO", "NGP NOVA GESTAO" ou similar (transferência interna entre contas da empresa), marque is_duplicate=true com confidence=medium e na reason inclua "TRANSFERÊNCIA INTERNA NGP→NGP".',
                '- Múltiplas linhas idênticas no mesmo dia entre contas NGP são transferências separadas — não consolidar.',
                '',
                'CONFIANÇA:',
                '- high: contatos batem claramente OU descrições idênticas.',
                '- medium: forte indicação mas algum campo diverge (ex: contato só em um dos lados).',
                '- low: incerteza grande.',
                '',
                'Para cada par retorne: pair_index, is_duplicate (true/false), confidence (high/medium/low), reason (1 frase em PT-BR explicando a decisão).',
              ].join('\n'),
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: JSON.stringify({ conta: accountName, pares: pairsForAi }),
            }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'duplicate_matching',
            schema,
            strict: true,
          },
        },
        max_output_tokens: 4000,
      }),
    })

    // Falhas da IA: NÃO faz fallback heurístico (geraria ruído).
    // Sinaliza erro pra UI mostrar banner.
    const aiFailure = (reason: string) => {
      debug.exit = 'openai_failed'
      debug.error_user_facing = `Detecção por IA falhou: ${reason}. Verifique a API key da OpenAI.`
      return { matches: [], debug }
    }

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => 'unknown')
      console.error('[matchDuplicatesWithAi] OpenAI HTTP error:', aiRes.status, errText)
      return aiFailure(`HTTP ${aiRes.status}: ${errText.slice(0, 200)}`)
    }
    const aiData = await aiRes.json()
    const raw = extractOpenAiText(aiData)
    if (!raw) {
      console.error('[matchDuplicatesWithAi] OpenAI empty response:', JSON.stringify(aiData).slice(0, 500))
      return aiFailure('resposta vazia')
    }
    debug.ai_raw_first_300 = raw.slice(0, 300)
    debug.ai_raw_length = raw.length

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch (_e) {
      console.error('[matchDuplicatesWithAi] Failed to parse AI JSON:', raw.slice(0, 500))
      debug.ai_parse_error = String(_e).slice(0, 200)
      return aiFailure('JSON inválido')
    }

    const allMatches: any[] = []
    debug.ai_matches_total = parsed.matches?.length || 0
    debug.ai_matches_breakdown = { high: 0, medium: 0, low: 0, false: 0 }

    for (const match of parsed.matches || []) {
      if (!match.is_duplicate) { debug.ai_matches_breakdown.false++; continue }
      debug.ai_matches_breakdown[match.confidence as 'high' | 'medium' | 'low']++
      // Aceita high, medium e low — usuário decide
      const candidate = limitedCandidates[match.pair_index]
      if (!candidate) continue

      allMatches.push({
        csv_index: candidate.csv_index,
        existing_id: candidate.existing_id,
        existing_descricao: candidate.existing_desc,
        existing_valor: candidate.existing_valor,
        existing_date: candidate.existing_date,
        existing_status: candidate.existing_status,
        existing_contato: candidate.existing_contato,
        confidence: match.confidence,
        reason: match.reason,
      })
    }

    // Dedupe por csv_index: 1 linha do CSV = 1 match (escolhe high antes de medium)
    const byIndex = new Map<number, any>()
    for (const m of allMatches) {
      const existing = byIndex.get(m.csv_index)
      if (!existing) { byIndex.set(m.csv_index, m); continue }
      // Prioriza high > medium
      if (existing.confidence === 'medium' && m.confidence === 'high') byIndex.set(m.csv_index, m)
    }
    const results = Array.from(byIndex.values())

    debug.exit = results.length === 0 ? 'ai_rejected_all' : 'ok'
    debug.results_count = results.length
    debug.ai_raw_matches_before_dedupe = allMatches.length
    return { matches: results, debug }
  } catch (e) {
    console.error('[matchDuplicatesWithAi]', e)
    debug.exit = 'exception'
    debug.error = String(e)
    debug.error_user_facing = `Erro inesperado na detecção: ${String(e).slice(0, 150)}`
    return { matches: [], debug }
  }
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action, ...payload } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    // ── LISTAR ──────────────────────────────────────────────────────────────
    if (action === 'listar') {
      const { tipo, account_id, view = 'competencia', date_start, date_end } = payload
      const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'

      let q = sb.from('fin_transacoes')
        .select([
          '*',
          'categoria:fin_categorias(id,nome,cor)',
          'cliente:fin_clientes(id,nome)',
          'fornecedor:fin_fornecedores(id,nome)',
          'account:fin_accounts!inner(id,nome,tipo,ativo)',
          'cost_center:fin_cost_centers(id,nome)',
          'product:fin_products(id,nome,tipo)',
        ].join(','))
        .order(dateField, { ascending: false })

      if (!account_id) {
        q = q.eq('account.ativo', true)
      }

      if (tipo) q = q.eq('tipo', tipo)
      if (account_id) q = q.eq('account_id', account_id)

      if (date_start && date_end) {
        if (view === 'caixa') {
          q = q.not('payment_date', 'is', null)
            .eq('status', 'confirmado')
            .gte('payment_date', date_start).lte('payment_date', date_end)
        } else {
          q = q.gte('competence_date', date_start).lte('competence_date', date_end)
        }
      }

      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao buscar transações.' }, 500)
      return json(req, { transacoes: data })
    }

    if (action === 'importar_csv') {
      const { account_id, rows, skip_indices } = payload as { account_id?: string; rows?: any[]; skip_indices?: number[] }
      const skipSet = new Set(skip_indices || [])
      if (!Array.isArray(rows) || rows.length === 0) return json(req, { error: 'Nenhuma linha válida para importar.' }, 400)

      let fixedAccountId: string | null = null
      if (account_id) {
        const accountCheck = await sb.from('fin_accounts').select('id,nome').eq('id', account_id).or('ativo.is.null,ativo.eq.true').maybeSingle()
        if (accountCheck.error) return json(req, { error: 'Erro ao validar conta.' }, 500)
        if (!accountCheck.data?.id) return json(req, { error: 'Conta não encontrada.' }, 404)
        fixedAccountId = accountCheck.data.id
      }

      const categoriaCache = new Map<string, string | null>()
      const centroCache = new Map<string, string | null>()
      const contatoCache = new Map<string, { cliente_id: string | null; fornecedor_id: string | null }>()
      const accountCache = new Map<string, string | null>()
      const createdAccounts = new Set<string>()

      // Normaliza todas as linhas primeiro para poder carregar duplicatas em bulk
      type NormalizedRow = {
        tipo: 'entrada' | 'saida'
        descricao: string
        competence_date: string
        payment_date: string | null
        valor: number
        rowAccountName: string | null
        categoria: string | null
        cost_center: string | null
        contato: string | null
        status_raw: string
        due_date: string | null
        tags: string | null
        additional_info: string | null
        attachments: string | null
      }

      const normalizedRows: NormalizedRow[] = []
      let skipped = 0

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        if (skipSet.has(rowIdx)) { skipped += 1; continue }
        const row = rows[rowIdx]
        const tipo: 'entrada' | 'saida' | 'transferencia' = row.tipo === 'saida' ? 'saida' : row.tipo === 'transferencia' ? 'transferencia' : 'entrada'
        const descricao = normalizeText(row.descricao)
        const competence_date = parseImportDate(row.competence_date)
        const payment_date = parseImportDate(row.payment_date)
        const parsedValor = parseCurrencyInput(row.valor)
        const valor = parsedValor == null ? null : Math.abs(parsedValor)
        const rowAccountName = normalizeText(row.account_name)

        if (!descricao || !competence_date || valor == null || valor <= 0) {
          skipped += 1
          continue
        }
        if (!fixedAccountId && !rowAccountName) {
          skipped += 1
          continue
        }

        normalizedRows.push({
          tipo, descricao, competence_date, payment_date, valor,
          rowAccountName: rowAccountName || null,
          categoria: normalizeText(row.categoria) || null,
          cost_center: normalizeText(row.cost_center) || null,
          contato: normalizeText(row.contato) || null,
          status_raw: String(row.status || ''),
          due_date: row.due_date || null,
          tags: row.tags || null,
          additional_info: row.additional_info || null,
          attachments: row.attachments || null,
        })
      }

      // Resolve contas únicas em batch antes de verificar duplicatas
      const uniqueAccountNames = Array.from(new Set(
        normalizedRows.map(r => r.rowAccountName).filter(Boolean) as string[]
      ))
      for (const name of uniqueAccountNames) {
        const key = normalizeKey(name)
        if (!accountCache.has(key)) {
          const ensured = await ensureAccount(sb, name)
          accountCache.set(key, ensured?.id || null)
          if (ensured?.created && ensured.nome) createdAccounts.add(ensured.nome)
        }
      }

      // Carrega duplicatas existentes em bulk por conta para evitar 1 query por linha
      // Agrupa linhas por account_id resolvido
      type AccountGroup = { accountId: string; rows: NormalizedRow[] }
      const byAccount = new Map<string, NormalizedRow[]>()
      for (const row of normalizedRows) {
        const aid = fixedAccountId || accountCache.get(normalizeKey(row.rowAccountName!)) || null
        if (!aid) { skipped += 1; continue }
        if (!byAccount.has(aid)) byAccount.set(aid, [])
        byAccount.get(aid)!.push(row)
      }

      // Para cada conta, carrega chaves existentes de uma vez
      type DedupKey = string
      const existingKeys = new Set<DedupKey>()
      for (const [aid, accRows] of byAccount) {
        const minDate = accRows.reduce((m, r) => r.competence_date < m ? r.competence_date : m, accRows[0].competence_date)
        const maxDate = accRows.reduce((m, r) => r.competence_date > m ? r.competence_date : m, accRows[0].competence_date)
        const { data: existing } = await sb.from('fin_transacoes')
          .select('tipo,descricao,competence_date,valor')
          .eq('account_id', aid)
          .gte('competence_date', minDate)
          .lte('competence_date', maxDate)
        for (const e of existing || []) {
          existingKeys.add(`${aid}|${e.tipo}|${e.descricao}|${e.competence_date}|${Number(e.valor)}`)
        }
      }

      let imported = 0
      const toInsert: any[] = []

      for (const [aid, accRows] of byAccount) {
        for (const row of accRows) {
          const dupKey = `${aid}|${row.tipo}|${row.descricao}|${row.competence_date}|${row.valor}`
          if (existingKeys.has(dupKey)) { skipped += 1; continue }
          // marca para não inserir duplicata dentro do mesmo batch
          existingKeys.add(dupKey)

          const catKey = `${row.tipo}:${normalizeKey(row.categoria || '')}`
          if (row.categoria && !categoriaCache.has(catKey)) {
            categoriaCache.set(catKey, await ensureCategoria(sb, row.categoria, row.tipo))
          }
          const categoria_id = row.categoria ? (categoriaCache.get(catKey) || null) : null

          const centerKey = normalizeKey(row.cost_center || '')
          if (row.cost_center && !centroCache.has(centerKey)) {
            centroCache.set(centerKey, await ensureCostCenter(sb, row.cost_center))
          }
          const cost_center_id = row.cost_center ? (centroCache.get(centerKey) || null) : null

          const contactKey = `${row.tipo}:${normalizeKey(row.contato || '')}`
          if (row.contato && !contatoCache.has(contactKey)) {
            contatoCache.set(contactKey, await ensureContato(sb, row.contato, row.tipo, user.usuario_id))
          }
          const contato = row.contato ? contatoCache.get(contactKey) : null
          const cliente_id = contato?.cliente_id || null
          const fornecedor_id = contato?.fornecedor_id || null

          const status = row.status_raw === 'pendente' || !row.payment_date ? 'pendente' : 'confirmado'
          const observacoes = normalizeText([
            row.due_date ? `Vencimento: ${row.due_date}` : '',
            row.tags ? `Tags: ${row.tags}` : '',
            row.additional_info ? `Informações adicionais: ${row.additional_info}` : '',
            row.attachments ? `Anexos: ${row.attachments}` : '',
          ].filter(Boolean).join('\n'))

          toInsert.push({
            tipo: row.tipo,
            descricao: row.descricao,
            valor: row.valor,
            data_transacao: row.competence_date,
            competence_date: row.competence_date,
            payment_date: status === 'confirmado' ? row.payment_date || row.competence_date : null,
            categoria_id,
            cliente_id,
            fornecedor_id,
            account_id: aid,
            cost_center_id,
            status,
            observacoes,
            created_by: user.usuario_id,
          })
        }
      }

      // Insere em batches de 200 para não estourar limites do PostgREST
      const BATCH = 200
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH)
        const ins = await sb.from('fin_transacoes').insert(batch)
        if (ins.error) return json(req, { error: `Erro ao importar lote ${Math.floor(i / BATCH) + 1}: ${ins.error.message}` }, 500)
        imported += batch.length
      }

      return json(req, { imported, skipped, created_accounts: Array.from(createdAccounts) })
    }

    if (action === 'combinar_transacao') {
      const { existing_id, chosen_status, csv_payment_date } = payload as {
        existing_id: string
        chosen_status: 'confirmado' | 'pendente'
        csv_payment_date?: string | null
      }
      if (!existing_id) return json(req, { error: 'ID do lançamento existente obrigatório.' }, 400)
      if (!chosen_status) return json(req, { error: 'Status escolhido obrigatório.' }, 400)

      const { data: existing, error: fetchErr } = await sb.from('fin_transacoes')
        .select('id, status, competence_date, payment_date')
        .eq('id', existing_id)
        .single()
      if (fetchErr || !existing) return json(req, { error: 'Lançamento não encontrado.' }, 404)

      const update: Record<string, any> = {
        status: chosen_status,
        updated_at: new Date().toISOString(),
      }

      if (chosen_status === 'confirmado') {
        const payDate = parseImportDate(csv_payment_date)
        update.payment_date = payDate || existing.payment_date || existing.competence_date
      } else {
        update.payment_date = null
      }

      const { error: updateErr } = await sb.from('fin_transacoes')
        .update(update)
        .eq('id', existing_id)
      if (updateErr) return json(req, { error: 'Erro ao combinar lançamento.' }, 500)

      return json(req, { ok: true, combined_id: existing_id })
    }

    if (action === 'analisar_importacao_csv') {
      const { account_id, rows } = payload as { account_id?: string; rows?: any[] }
      if (!Array.isArray(rows) || rows.length === 0) return json(req, { error: 'Nenhuma linha válida para analisar.' }, 400)

      let accountName = 'Importação multi-conta'
      if (account_id) {
        const accountCheck = await sb.from('fin_accounts').select('id,nome').eq('id', account_id).or('ativo.is.null,ativo.eq.true').maybeSingle()
        if (accountCheck.error) return json(req, { error: 'Erro ao validar conta.' }, 500)
        if (!accountCheck.data?.id) return json(req, { error: 'Conta não encontrada.' }, 404)
        accountName = accountCheck.data.nome
      }

      const importedRows = rows
      const summary = importedRows.reduce((acc, row) => {
        const valor = Number(row.valor || 0)
        if (row.tipo === 'entrada') {
          acc.entradas += 1
          acc.total_entradas += valor
        } else {
          acc.saidas += 1
          acc.total_saidas += valor
        }
        if (row.status === 'pendente') acc.pendentes += 1
        else acc.confirmados += 1
        return acc
      }, {
        entradas: 0,
        saidas: 0,
        confirmados: 0,
        pendentes: 0,
        total_entradas: 0,
        total_saidas: 0,
      })

      const warnings: string[] = []
      const duplicateKeys = new Set<string>()
      const seen = new Set<string>()
      const transferRows = importedRows.filter(row => /transfer/i.test(String(row.descricao || '')))
      const noCategory = importedRows.filter(row => !normalizeText(row.categoria)).length
      const noContact = importedRows.filter(row => !normalizeText(row.contato)).length

      for (const row of importedRows) {
        const key = [row.tipo, normalizeKey(row.descricao), row.competence_date, Number(row.valor || 0)].join('|')
        if (seen.has(key)) duplicateKeys.add(key)
        seen.add(key)
      }

      if (duplicateKeys.size > 0) warnings.push(`${duplicateKeys.size} lançamentos parecem duplicados dentro do próprio arquivo.`)
      if (transferRows.length > 0) warnings.push(`${transferRows.length} lançamentos parecem transferências entre contas e merecem revisão.`)
      if (noCategory > 0) warnings.push(`${noCategory} linhas vieram sem categoria e dependerão de fallback automático.`)
      if (noContact > 0) warnings.push(`${noContact} linhas vieram sem contato identificado.`)

      const detectedAccounts = Array.from(new Set(
        importedRows.map(row => normalizeText(row.account_name)).filter(Boolean),
      )) as string[]
      const accountsToCreate: string[] = []
      if (!account_id && detectedAccounts.length > 0) {
        const { data: existingAccounts } = await sb.from('fin_accounts')
          .select('nome')
          .or('ativo.is.null,ativo.eq.true')
          .in('nome', detectedAccounts)
        const existingNames = new Set((existingAccounts ?? []).map((a: any) => a.nome))
        for (const detected of detectedAccounts) {
          if (!existingNames.has(detected)) accountsToCreate.push(detected)
        }
      }

      const aiReview = await analyzeImportWithAi(importedRows, accountName)

      // Cruzamento inteligente com IA para detectar duplicatas já existentes no banco
      const dupResult = await matchDuplicatesWithAi(
        sb, importedRows, account_id || null, accountName,
      )
      console.log('[duplicate_match_debug]', JSON.stringify(dupResult.debug))

      return json(req, {
        account_name: accountName,
        summary,
        accounts_detected: detectedAccounts,
        accounts_to_create: accountsToCreate,
        warnings,
        sample: importedRows.slice(0, 8),
        ai_review: aiReview,
        potential_duplicates: dupResult.matches,
        duplicate_debug: dupResult.debug,
      })
    }

    // ── CRIAR ────────────────────────────────────────────────────────────────
    if (action === 'criar') {
      const {
        tipo, descricao, valor, competence_date, payment_date,
        categoria_id, cliente_id, fornecedor_id,
        account_id, cost_center_id, product_id,
        status, observacoes,
      } = payload

      const parsedValor = parseCurrencyInput(valor)
      const normalizedDescricao = normalizeText(descricao)
      const normalizedCompetenceDate = normalizeDateOnly(competence_date)
      const normalizedPaymentDate = normalizeDateOnly(payment_date)

      if (!tipo || !normalizedDescricao || parsedValor == null || parsedValor <= 0 || !normalizedCompetenceDate) {
        return json(req, { error: 'Campos obrigatórios: tipo, descricao, valor, competence_date.' }, 400)
      }

      // status confirmado sem payment_date => usa competence_date como fallback
      const resolvedPaymentDate = status === 'confirmado'
        ? (normalizedPaymentDate || normalizedCompetenceDate)
        : null

      const { data, error } = await sb.from('fin_transacoes').insert({
        tipo,
        descricao: normalizedDescricao,
        valor: parsedValor,
        data_transacao: normalizedCompetenceDate, // mantém campo legado preenchido
        competence_date: normalizedCompetenceDate,
        payment_date: resolvedPaymentDate,
        categoria_id: categoria_id || null,
        cliente_id: cliente_id || null,
        fornecedor_id: fornecedor_id || null,
        account_id: account_id || null,
        cost_center_id: cost_center_id || null,
        product_id: product_id || null,
        status: status || 'confirmado',
        observacoes: normalizeText(observacoes),
        created_by: user.usuario_id,
      }).select([
        '*',
        'categoria:fin_categorias(id,nome,cor)',
        'account:fin_accounts(id,nome)',
        'cost_center:fin_cost_centers(id,nome)',
        'product:fin_products(id,nome)',
      ].join(',')).single()

      if (error) return json(req, { error: 'Erro ao criar transação.' }, 500)
      return json(req, { transacao: data })
    }

    // ── ATUALIZAR ────────────────────────────────────────────────────────────
    if (action === 'atualizar') {
      const { id, ...fields } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)

      const currentResult = await sb.from('fin_transacoes')
        .select('competence_date, payment_date, status')
        .eq('id', id)
        .single()
      if (currentResult.error || !currentResult.data) {
        return json(req, { error: 'Transação não encontrada.' }, 404)
      }

      const allowed = [
        'tipo', 'descricao', 'valor',
        'competence_date', 'payment_date',
        'categoria_id', 'cliente_id', 'fornecedor_id',
        'account_id', 'cost_center_id', 'product_id',
        'status', 'observacoes',
      ]
      const update: Record<string, any> = { updated_at: new Date().toISOString() }
      for (const k of allowed) {
        if (fields[k] !== undefined) update[k] = fields[k]
      }

      if (update.valor !== undefined) {
        const parsedValor = parseCurrencyInput(update.valor)
        if (parsedValor == null || parsedValor <= 0) return json(req, { error: 'Valor inválido.' }, 400)
        update.valor = parsedValor
      }
      if (update.descricao !== undefined) {
        const normalizedDescricao = normalizeText(update.descricao)
        if (!normalizedDescricao) return json(req, { error: 'Descrição obrigatória.' }, 400)
        update.descricao = normalizedDescricao
      }
      if (update.competence_date !== undefined) {
        const normalizedCompetenceDate = normalizeDateOnly(update.competence_date)
        if (!normalizedCompetenceDate) return json(req, { error: 'Data de competência inválida.' }, 400)
        update.competence_date = normalizedCompetenceDate
      }
      if (update.payment_date !== undefined) {
        const normalizedPaymentDate = normalizeDateOnly(update.payment_date)
        if (update.payment_date !== null && !normalizedPaymentDate) {
          return json(req, { error: 'Data de pagamento inválida.' }, 400)
        }
        update.payment_date = normalizedPaymentDate
      }
      if (update.observacoes !== undefined) update.observacoes = normalizeText(update.observacoes)

      // Sincroniza data_transacao legado com competence_date se presente
      if (update.competence_date) update.data_transacao = update.competence_date

      // Limpa payment_date quando status volta para pendente
      if (update.status === 'pendente') update.payment_date = null
      if (update.status === 'confirmado' && !update.payment_date) {
        update.payment_date = currentResult.data.payment_date || update.competence_date || currentResult.data.competence_date
      }

      const { data, error } = await sb.from('fin_transacoes')
        .update(update).eq('id', id)
        .select([
          '*',
          'categoria:fin_categorias(id,nome,cor)',
          'account:fin_accounts(id,nome)',
          'cost_center:fin_cost_centers(id,nome)',
          'product:fin_products(id,nome)',
        ].join(',')).single()

      if (error) return json(req, { error: 'Erro ao atualizar transação.' }, 500)
      return json(req, { transacao: data })
    }

    // ── DELETAR ──────────────────────────────────────────────────────────────
    if (action === 'deletar') {
      const { id } = payload
      if (!id) return json(req, { error: 'ID obrigatório.' }, 400)
      const { error } = await sb.from('fin_transacoes').delete().eq('id', id)
      if (error) return json(req, { error: 'Erro ao deletar transação.' }, 500)
      return json(req, { ok: true })
    }

    // ── RESUMO ───────────────────────────────────────────────────────────────
    if (action === 'resumo') {
      const { view = 'competencia', account_id, date_start, date_end } = payload

      let q = sb.from('fin_transacoes').select('tipo, valor, status, payment_date, account_id, descricao, observacoes, categoria:fin_categorias(nome), account:fin_accounts!inner(id,ativo)')
      let accountsQuery = sb.from('fin_accounts').select('id, saldo_inicial')
      if (account_id) {
        q = q.eq('account_id', account_id)
        accountsQuery = accountsQuery.eq('id', account_id)
      } else {
        q = q.eq('account.ativo', true)
        accountsQuery = accountsQuery.eq('ativo', true)
      }

      if (date_start && date_end) {
        if (view === 'caixa') {
          q = q.not('payment_date', 'is', null)
            .gte('payment_date', date_start).lte('payment_date', date_end)
            .eq('status', 'confirmado')
        } else {
          q = q.gte('competence_date', date_start).lte('competence_date', date_end)
        }
      }

      const { data, error } = await q
      if (error) return json(req, { error: 'Erro ao buscar resumo.' }, 500)

      const dataSemTransferenciasInternas = (data ?? []).filter((t: any) => !isInternalTransferTransaction(t))

      const entradas = dataSemTransferenciasInternas
        .filter((t: any) => t.tipo === 'entrada')
        .reduce((s: number, t: any) => s + Number(t.valor), 0)
      const saidas = dataSemTransferenciasInternas
        .filter((t: any) => t.tipo === 'saida')
        .reduce((s: number, t: any) => s + Number(t.valor), 0)

      const { data: accounts, error: accountsError } = await accountsQuery
      if (accountsError) return json(req, { error: 'Erro ao buscar contas para o saldo geral.' }, 500)

      let saldoGeral = (accounts ?? []).reduce((sum: number, account: any) => sum + Number(account.saldo_inicial || 0), 0)
      const accountIds = (accounts ?? []).map((account: any) => account.id).filter(Boolean)

      if (!account_id && accountIds.length === 0) {
        return json(req, { entradas, saidas, saldo: saldoGeral, view })
      }

      let saldoTxQuery = sb.from('fin_transacoes')
        .select('account_id, tipo, valor')
        .eq('status', 'confirmado')
        .not('account_id', 'is', null)

      if (account_id) saldoTxQuery = saldoTxQuery.eq('account_id', account_id)
      else saldoTxQuery = saldoTxQuery.in('account_id', accountIds)

      const { data: saldoTxs, error: saldoTxsError } = await saldoTxQuery
      if (saldoTxsError) return json(req, { error: 'Erro ao buscar transações para o saldo geral.' }, 500)

      for (const tx of (saldoTxs ?? [])) {
        saldoGeral += tx.tipo === 'entrada' ? Number(tx.valor || 0) : -Number(tx.valor || 0)
      }

      return json(req, { entradas, saidas, saldo: saldoGeral, view })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[financeiro-transacoes]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
