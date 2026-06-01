// @ts-nocheck
// ============================================================================
// NGP Copilot — extração de inteligência de anexos
//
// Entrada: { session_token, asset_id }
// Pega um campaign_asset com extraction_status='pending', baixa do storage,
// extrai por tipo (HTML/PDF/imagem/transcript), atualiza extracted_*.
//
// MVP: planejamento_html, planejamento_pdf, imagem_criativa, carrossel,
//      transcript_reuniao, outro (texto puro)
// Pulado: video_criativo (Fase 2 — Whisper + Vision frames)
//
// Quando termina com sucesso, registra timeline_event do tipo 'asset_ingerido'.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateSession } from '../_shared/roles.ts'
import { corsHeaders } from '../_shared/cors.ts'

const OPENAI_TIMEOUT_MS = 60_000
const MAX_TEXT_BYTES = 200_000   // 200KB de texto extraído máximo
const VISION_MODEL = 'gpt-4o'
const TEXT_MODEL = 'gpt-4o-mini' // mais barato pra sumarizar texto

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

// HTML → texto plano (regex simples; sem JSDOM no Deno edge)
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function downloadFromStorage(sb, path) {
  const { data, error } = await sb.storage.from('copilot-assets-private').download(path)
  if (error) throw new Error(`Storage download falhou: ${error.message}`)
  return data
}

// PDF → texto via pdfjs (port Deno-friendly). Sem dependência: extraímos só
// metadata básica via pdf-parse roda em Node, então usamos esm.sh wrapper.
// Fallback: se falhar, marca asset como failed mas não derruba a request.
async function pdfToText(blob) {
  // Versão mínima: usa pdfjs-serverless via esm.sh
  // Se falhar (versionamento/CDN), retornamos null e marcamos failed.
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const pdfjs = await import('https://esm.sh/pdfjs-serverless@0.5.0')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
    const parts = []
    const maxPages = Math.min(doc.numPages, 50)
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map((it) => it.str).join(' '))
    }
    return parts.join('\n\n').slice(0, MAX_TEXT_BYTES)
  } catch (e) {
    console.error('[asset-ingest] pdf parse fail:', e?.message)
    return null
  }
}

async function visionDescribe(openAiKey, signedUrl, assetType) {
  const visionInstruction = assetType === 'imagem_criativa' || assetType === 'carrossel'
    ? `Analise esta imagem como CRIATIVO DE ANÚNCIO. Retorne JSON com:
- copy_no_arte: texto visível na imagem (transcrito)
- hook_visual: o que prende o olhar nos primeiros 2s
- elemento_central: o que está no foco
- cta_visivel: existe call-to-action visível? Qual?
- paleta: cores predominantes (3-4 cores)
- qualidade_producao: amador | razoavel | profissional
- estilo: lifestyle | produto | depoimento | infográfico | outro
- observacoes: 1-2 frases sobre o que provavelmente funciona ou não
`
    : `Descreva esta imagem em até 200 palavras, com foco no que é relevante para entender intenção de comunicação.`

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_output_tokens: 800,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: visionInstruction },
          { type: 'input_image', image_url: signedUrl },
        ],
      }],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Vision falhou (${res.status})`)
  return extractOpenAiText(data)
}

async function summarizeText(openAiKey, text, assetType) {
  const instr = assetType === 'transcript_reuniao'
    ? 'Resuma esta transcrição de reunião em PT-BR. Foque em: decisões tomadas, pendências, feedback de cliente, próximos passos. Máximo 300 palavras.'
    : assetType === 'planejamento_html' || assetType === 'planejamento_pdf'
    ? 'Resuma este planejamento de marketing/tráfego em PT-BR. Foque em: objetivos, KPIs, budget, campanhas propostas, períodos. Máximo 400 palavras.'
    : 'Resuma este conteúdo em PT-BR em até 250 palavras, focando em informação acionável.'

  const trimmed = text.slice(0, MAX_TEXT_BYTES)
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      max_output_tokens: 800,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: instr }] },
        { role: 'user', content: [{ type: 'input_text', text: trimmed }] },
      ],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Summarize falhou (${res.status})`)
  return extractOpenAiText(data)
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

    const body = await req.json().catch(() => ({}))
    const { session_token, asset_id } = body || {}
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!asset_id) return json(req, { error: 'asset_id obrigatório.' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (user.role !== 'admin' && user.role !== 'ngp') return json(req, { error: 'Apenas equipe NGP.' }, 403)

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) return json(req, { error: 'OPENAI_API_KEY não configurada.' }, 500)

    // Pega o asset (precisa estar pending pra evitar reprocessamento)
    const { data: asset, error: assetErr } = await sb
      .from('campaign_assets')
      .select('*')
      .eq('id', asset_id)
      .single()
    if (assetErr || !asset) return json(req, { error: 'Asset não encontrado.' }, 404)
    if (asset.extraction_status === 'processing') {
      return json(req, { error: 'Asset já está sendo processado.' }, 409)
    }
    if (asset.extraction_status === 'done') {
      return json(req, { status: 'done', message: 'Já processado anteriormente.' })
    }

    // Marca processing
    await sb.from('campaign_assets')
      .update({ extraction_status: 'processing', extraction_error: null })
      .eq('id', asset_id)

    try {
      let extractedText = null
      let extractedSummary = null
      let extractedMetadata = {}
      let modelUsed = null

      if (asset.asset_type === 'video_criativo') {
        // Fase 2 — pulamos por enquanto
        await sb.from('campaign_assets').update({
          extraction_status: 'skipped',
          extraction_error: 'Extração de vídeo será habilitada na Fase 2 (Whisper + Vision frames).',
          extracted_at: new Date().toISOString(),
        }).eq('id', asset_id)
        return json(req, { status: 'skipped', reason: 'video_extraction_phase_2' })
      }

      const isImage = asset.asset_type === 'imagem_criativa' || asset.asset_type === 'carrossel'

      if (isImage) {
        if (!asset.storage_path) throw new Error('Imagem sem storage_path')
        const { data: signed, error: signErr } = await sb.storage
          .from('copilot-assets-private').createSignedUrl(asset.storage_path, 300)
        if (signErr || !signed?.signedUrl) throw new Error(`Signed URL falhou: ${signErr?.message}`)
        const visionResult = await visionDescribe(openAiKey, signed.signedUrl, asset.asset_type)
        extractedSummary = visionResult
        modelUsed = VISION_MODEL
        // Tenta parsear JSON se a IA retornar estruturado
        try {
          const cleaned = visionResult.replace(/```json|```/g, '').trim()
          if (cleaned.startsWith('{')) extractedMetadata = JSON.parse(cleaned)
        } catch (_) { /* mantém só texto */ }
      } else if (asset.asset_type === 'planejamento_html') {
        if (!asset.storage_path) throw new Error('HTML sem storage_path')
        const blob = await downloadFromStorage(sb, asset.storage_path)
        const html = await blob.text()
        extractedText = htmlToText(html).slice(0, MAX_TEXT_BYTES)
        extractedSummary = await summarizeText(openAiKey, extractedText, asset.asset_type)
        modelUsed = TEXT_MODEL
      } else if (asset.asset_type === 'planejamento_pdf') {
        if (!asset.storage_path) throw new Error('PDF sem storage_path')
        const blob = await downloadFromStorage(sb, asset.storage_path)
        const text = await pdfToText(blob)
        if (text === null) throw new Error('Falha ao extrair texto do PDF')
        extractedText = text
        extractedSummary = await summarizeText(openAiKey, extractedText, asset.asset_type)
        modelUsed = TEXT_MODEL
      } else if (asset.asset_type === 'transcript_reuniao' || asset.asset_type === 'outro') {
        // Se tem extracted_text já vindo (transcript colado), usa
        // Senão tenta baixar como texto puro
        if (asset.extracted_text) {
          extractedText = asset.extracted_text
        } else if (asset.storage_path) {
          const blob = await downloadFromStorage(sb, asset.storage_path)
          extractedText = (await blob.text()).slice(0, MAX_TEXT_BYTES)
        } else {
          throw new Error('Sem texto e sem storage_path pra extrair')
        }
        extractedSummary = await summarizeText(openAiKey, extractedText, asset.asset_type)
        modelUsed = TEXT_MODEL
      }

      // Persiste resultado
      await sb.from('campaign_assets').update({
        extracted_text: extractedText,
        extracted_summary: extractedSummary,
        extracted_metadata: extractedMetadata,
        extraction_model: modelUsed,
        extraction_status: 'done',
        extraction_error: null,
        extracted_at: new Date().toISOString(),
      }).eq('id', asset_id)

      // Timeline event de ingestão
      await sb.from('client_timeline_events').insert({
        client_id: asset.client_id,
        event_type: 'asset_ingerido',
        title: `Anexo ingerido: ${asset.label || asset.asset_type}`,
        description: extractedSummary ? extractedSummary.slice(0, 500) : null,
        reference_table: 'campaign_assets',
        reference_id: asset_id,
        created_by_agent: true,
        created_by_usuario_id: user.usuario_id,
      })

      return json(req, {
        status: 'done',
        asset_id,
        extracted_summary: extractedSummary,
        model_used: modelUsed,
      })
    } catch (e) {
      const errMsg = e?.message || String(e)
      console.error('[asset-ingest] extract fail:', errMsg)
      await sb.from('campaign_assets').update({
        extraction_status: 'failed',
        extraction_error: errMsg.slice(0, 1000),
      }).eq('id', asset_id)
      return json(req, { status: 'failed', error: errMsg }, 500)
    }
  } catch (e) {
    console.error('[asset-ingest]', e?.message || e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
