// Recebe URL temporária da thumb de criativo da Meta API (scontent-*) ou
// qualquer outra URL pública de imagem, baixa, sobe pro Storage do Supabase
// e retorna a URL permanente. Necessário porque thumbnails do Meta expiram
// em ~48h e quebram nos relatórios antigos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'

const BUCKET = 'relatorio-thumbs'
const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const FETCH_TIMEOUT_MS = 15000

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as Record<string, unknown>
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e))
}

// Hash determinístico curto da URL — mesma imagem reaproveita arquivo,
// não duplica no storage se o mesmo ad for re-importado.
async function hashUrl(url: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url))
  const arr = Array.from(new Uint8Array(buf))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function extOf(contentType: string): string {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  return 'jpg'
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, source_url, relatorio_id } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!source_url || typeof source_url !== 'string') {
      return json(req, { error: 'source_url obrigatório.' }, 400)
    }
    // Só http(s). Bloqueia data:, file:, javascript:, etc.
    if (!/^https?:\/\//i.test(source_url)) {
      return json(req, { error: 'URL inválida.' }, 400)
    }

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    // Valida sessão
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    // Baixa a imagem com timeout
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(source_url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      return json(req, { error: `Falha ao baixar imagem: HTTP ${res.status}` }, 502)
    }
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) {
      return json(req, { error: `Content-Type inesperado: ${contentType}` }, 400)
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0) return json(req, { error: 'Imagem vazia.' }, 400)
    if (buf.byteLength > MAX_BYTES) {
      return json(req, { error: `Imagem maior que ${MAX_BYTES} bytes.` }, 400)
    }

    // Path determinístico — mesma URL produz mesmo arquivo
    const hash = await hashUrl(source_url)
    const ext = extOf(contentType)
    const folder = relatorio_id && typeof relatorio_id === 'string' ? relatorio_id : 'shared'
    const path = `${folder}/${hash}.${ext}`

    // Upload com upsert: se já existe, não falha
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, buf, { contentType, upsert: true })

    if (upErr) {
      console.error('[relatorio-pin-thumb] upload error:', JSON.stringify(upErr))
      return json(req, { error: errMsg(upErr) }, 500)
    }

    // Public URL — o bucket precisa ter leitura pública configurada
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)

    return json(req, { ok: true, url: pub.publicUrl, path })
  } catch (e) {
    console.error('[relatorio-pin-thumb] catch:', e)
    return json(req, { error: errMsg(e) }, 500)
  }
})
