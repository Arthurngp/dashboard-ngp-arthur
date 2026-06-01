// Transcreve áudio de vídeo de criativo da Meta via Whisper.
//
// Fluxo:
//   1. Cache: SELECT relatorio_transcricoes pelo video_id. Se hit, retorna direto.
//   2. Resolve source URL: Graph /{video_id}?fields=source (precisa do meta_token)
//   3. Baixa o MP4 (com timeout + cap de 24MB pra não estourar limite Whisper)
//   4. Manda pro Whisper API (model=whisper-1, language=pt)
//   5. INSERT no cache, retorna { texto }
//
// Auth: session_token + role NGP. Cliente nunca chama isto.
// Mesmo padrão de meta-proxy pra recuperar meta_token (token de NGP ativo).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// === Inline cors helpers (mesmo padrão de _shared/cors.ts mas inline pra
// evitar problemas de bundling no deploy via MCP) ===
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

const OPENAI_TIMEOUT_MS = 60000
const META_FETCH_TIMEOUT_MS = 30000
const MAX_VIDEO_BYTES = 24 * 1024 * 1024 // Whisper limita em 25MB; 24 dá folga

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as Record<string, unknown>
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e))
}

// Mesma cadeia de fallback usada em meta-proxy: token do usuário logado,
// env META_ACCESS_TOKEN, ou qualquer NGP ativo. Garante que a edge function
// não precisa receber token do client (que não tem acesso a ele).
async function getMetaToken(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data: tokenUser } = await sb
    .from('usuarios')
    .select('meta_token')
    .eq('id', userId)
    .single()
  let token = (tokenUser as { meta_token?: string } | null)?.meta_token
    || Deno.env.get('META_ACCESS_TOKEN')
    || ''
  if (token) return token
  const { data: ngpList } = await sb
    .from('usuarios')
    .select('meta_token')
    .eq('role', 'ngp')
    .eq('ativo', true)
    .not('meta_token', 'is', null)
    .limit(5)
  if (Array.isArray(ngpList)) {
    for (const u of ngpList as Array<{ meta_token?: string }>) {
      if (u.meta_token && u.meta_token.trim().length > 0) return u.meta_token
    }
  }
  return null
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, video_id } = body as {
      session_token?: string
      video_id?: string
    }

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!video_id || typeof video_id !== 'string') {
      return json(req, { error: 'video_id obrigatório.' }, 400)
    }

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    // === Auth: session válida + role NGP ===
    const { data: sessions } = await sb
      .from('sessions')
      .select('usuario_id, expires_at')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
    if (!sessions?.length) return json(req, { error: 'Sessão expirada.' }, 401)
    const userId = (sessions[0] as { usuario_id: string }).usuario_id

    const { data: usuario } = await sb
      .from('usuarios')
      .select('role, ativo')
      .eq('id', userId)
      .single()
    const u = usuario as { role?: string; ativo?: boolean } | null
    if (!u || !u.ativo) return json(req, { error: 'Usuário inativo.' }, 403)
    if (u.role !== 'ngp' && u.role !== 'admin') {
      return json(req, { error: 'Apenas gestores NGP podem transcrever criativos.' }, 403)
    }

    // === Cache: SELECT antes de gastar Whisper ===
    const { data: cached } = await sb
      .from('relatorio_transcricoes')
      .select('texto')
      .eq('video_id', video_id)
      .maybeSingle()
    if (cached && (cached as { texto?: string }).texto) {
      return json(req, { texto: (cached as { texto: string }).texto, cached: true })
    }

    // Rate limit — Whisper é caro, protege contra loop bug.
    // Cache hit acima NÃO conta (não chama OpenAI). Só conta quando vai transcrever de verdade.
    // Admin é isento.
    if (u.role !== 'admin') {
      const { data: rlData, error: rlError } = await sb.rpc('ia_usage_increment', { p_usuario_id: userId, p_acao: 'whisper' })
      if (!rlError && typeof rlData === 'number' && rlData > 100) {
        return json(req, {
          error: `Limite diário de transcrição atingido (${rlData}/100). Tente amanhã ou peça ao admin.`,
          rate_limited: true,
        }, 429)
      }
    }

    // === Resolve source URL via Graph ===
    const metaToken = await getMetaToken(sb, userId)
    if (!metaToken) {
      return json(req, { error: 'Meta token não configurado.' }, 503)
    }

    const graphUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(video_id)}?fields=source,length&access_token=${encodeURIComponent(metaToken)}`
    const graphRes = await fetch(graphUrl, {
      signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
    })
    if (!graphRes.ok) {
      const errText = await graphRes.text().catch(() => '')
      console.warn('[transcrever] Graph falhou', graphRes.status, errText)
      return json(req, { error: 'Vídeo não disponível na Meta (pode estar deletado).' }, 404)
    }
    const graphJson = await graphRes.json()
    const sourceUrl = graphJson.source as string | undefined
    const lengthSec = typeof graphJson.length === 'number' ? graphJson.length : undefined
    if (!sourceUrl) {
      return json(req, { error: 'Vídeo sem source URL (formato não suportado).' }, 404)
    }

    // === Baixa o MP4 (com cap de tamanho) ===
    const vidRes = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
    })
    if (!vidRes.ok) {
      return json(req, { error: `Falha ao baixar vídeo (status ${vidRes.status}).` }, 502)
    }
    const contentLength = parseInt(vidRes.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_VIDEO_BYTES) {
      return json(req, {
        error: `Vídeo muito grande (${(contentLength / 1024 / 1024).toFixed(1)} MB). Whisper limita em 25 MB.`,
        skipped: true,
      }, 413)
    }
    const buf = await vidRes.arrayBuffer()
    if (buf.byteLength > MAX_VIDEO_BYTES) {
      return json(req, {
        error: `Vídeo muito grande (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB). Whisper limita em 25 MB.`,
        skipped: true,
      }, 413)
    }

    // === Whisper transcription ===
    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      return json(req, { error: 'OPENAI_API_KEY não configurada.' }, 500)
    }

    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'video/mp4' }), 'video.mp4')
    form.append('model', 'whisper-1')
    form.append('language', 'pt')
    form.append('response_format', 'text')

    const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${openAiKey}` },
      body: form,
    })
    if (!wRes.ok) {
      const errBody = await wRes.text().catch(() => '')
      console.error('[transcrever] Whisper falhou', wRes.status, errBody)
      return json(req, { error: `Whisper retornou ${wRes.status}.` }, 502)
    }
    // response_format=text retorna texto puro, não JSON
    const texto = (await wRes.text()).trim()
    if (!texto) {
      return json(req, { texto: '', empty: true })
    }

    // === Cache: INSERT (ignore conflict) ===
    await sb.from('relatorio_transcricoes').upsert({
      video_id,
      texto,
      duracao_seg: lengthSec,
      bytes_video: buf.byteLength,
    }, { onConflict: 'video_id' })

    return json(req, { texto, cached: false })
  } catch (e) {
    console.error('[relatorio-transcrever-video] erro:', e)
    return json(req, { error: errMsg(e) }, 500)
  }
})
