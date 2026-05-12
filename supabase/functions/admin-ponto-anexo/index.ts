import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

// =============================================================================
// admin-ponto-anexo
//
// Gerencia anexos (atestado, foto, etc) vinculados a registros tipo 'ausencia'.
// Bucket "ponto-anexos" é PRIVADO — acesso via signed URL temporária só.
//
// Permissões:
//   - admin: pode anexar/baixar/deletar em qualquer registro
//   - usuário comum: só no próprio registro (usuario_id == sessão)
//
// Actions:
//   upload    { record_id, filename, mime_type, content_base64 }
//             → grava no storage, preenche colunas anexo_* do registro
//   get_url   { record_id }
//             → retorna { signed_url, filename, mime_type, size, expires_in }
//   delete    { record_id }
//             → remove arquivo do storage + zera colunas
// =============================================================================

const BUCKET = 'ponto-anexos'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

function extFromMime(mime: string): string {
  switch (mime) {
    case 'application/pdf': return 'pdf'
    case 'image/png': return 'png'
    case 'image/jpeg':
    case 'image/jpg': return 'jpg'
    case 'image/webp': return 'webp'
    default: return 'bin'
  }
}

function base64ToBytes(b64: string): Uint8Array {
  // Aceita data URI ou base64 puro.
  const clean = b64.includes(',') ? b64.split(',', 2)[1] : b64
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action, record_id } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!record_id || typeof record_id !== 'string') {
      return json(req, { error: 'record_id obrigatório.' }, 400)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)

    // Carrega registro + checa permissão
    const { data: reg, error: errLoad } = await sb.from('ponto_registros')
      .select('id, usuario_id, tipo_registro, anexo_path, anexo_mime, anexo_size, observacao')
      .eq('id', record_id)
      .is('deleted_at', null)
      .single()
    if (errLoad || !reg) return json(req, { error: 'Registro não encontrado.' }, 404)

    const ehAdmin = isAdmin(user.role)
    const ehDono = reg.usuario_id === user.usuario_id
    if (!ehAdmin && !ehDono) {
      return json(req, { error: 'Sem permissão pra este registro.' }, 403)
    }

    // -------------------------------------------------------------------------
    // upload
    // -------------------------------------------------------------------------
    if (action === 'upload') {
      if (reg.tipo_registro !== 'ausencia') {
        return json(req, { error: 'Anexo só pode ser vinculado a ausências.' }, 400)
      }
      const { filename, mime_type, content_base64 } = body
      if (!mime_type || !ALLOWED_MIME.has(mime_type)) {
        return json(req, { error: `Formato não aceito: ${mime_type}. Use PDF, PNG, JPG ou WebP.` }, 400)
      }
      if (!content_base64 || typeof content_base64 !== 'string') {
        return json(req, { error: 'Arquivo ausente.' }, 400)
      }

      const bytes = base64ToBytes(content_base64)
      if (bytes.length > MAX_BYTES) {
        return json(req, { error: `Arquivo maior que 5 MB (${(bytes.length / 1024 / 1024).toFixed(1)} MB).` }, 400)
      }

      const ext = extFromMime(mime_type)
      // Path: <usuario_id>/<record_id>.<ext>. Substituir mantém só 1 arquivo
      // por registro (caso o user re-anexe, o anterior é removido antes).
      const newPath = `${reg.usuario_id}/${reg.id}.${ext}`

      // Se já existir anexo, remove o antigo (pode ser de outro mime/ext)
      if (reg.anexo_path && reg.anexo_path !== newPath) {
        await sb.storage.from(BUCKET).remove([reg.anexo_path])
      }

      const { error: errUp } = await sb.storage.from(BUCKET).upload(newPath, bytes, {
        contentType: mime_type,
        upsert: true,
      })
      if (errUp) {
        return json(req, { error: `Erro ao enviar arquivo: ${errUp.message}` }, 500)
      }

      const { error: errMeta } = await sb.from('ponto_registros').update({
        anexo_path: newPath,
        anexo_mime: mime_type,
        anexo_size: bytes.length,
        edited_at: new Date().toISOString(),
        edited_by: user.usuario_id,
      }).eq('id', reg.id)
      if (errMeta) {
        return json(req, { error: `Erro ao salvar metadados: ${errMeta.message}` }, 500)
      }

      return json(req, {
        ok: true,
        anexo: {
          path: newPath,
          mime_type,
          size: bytes.length,
          filename: filename || `anexo.${ext}`,
        },
      })
    }

    // -------------------------------------------------------------------------
    // get_url — gera signed URL temporária (5 min)
    // -------------------------------------------------------------------------
    if (action === 'get_url') {
      if (!reg.anexo_path) return json(req, { error: 'Sem anexo neste registro.' }, 404)
      const { data, error } = await sb.storage.from(BUCKET)
        .createSignedUrl(reg.anexo_path, 300)
      if (error || !data?.signedUrl) {
        return json(req, { error: `Erro ao gerar link: ${error?.message || 'desconhecido'}` }, 500)
      }
      return json(req, {
        ok: true,
        signed_url: data.signedUrl,
        mime_type: reg.anexo_mime,
        size: reg.anexo_size,
        expires_in: 300,
      })
    }

    // -------------------------------------------------------------------------
    // delete
    // -------------------------------------------------------------------------
    if (action === 'delete') {
      if (!reg.anexo_path) return json(req, { ok: true, message: 'Nada a remover.' })
      const { error: errDel } = await sb.storage.from(BUCKET).remove([reg.anexo_path])
      if (errDel) {
        return json(req, { error: `Erro ao remover do storage: ${errDel.message}` }, 500)
      }
      const { error: errMeta } = await sb.from('ponto_registros').update({
        anexo_path: null,
        anexo_mime: null,
        anexo_size: null,
        edited_at: new Date().toISOString(),
        edited_by: user.usuario_id,
      }).eq('id', reg.id)
      if (errMeta) {
        return json(req, { error: `Erro ao zerar metadados: ${errMeta.message}` }, 500)
      }
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[admin-ponto-anexo] Error:', e)
    const msg = e instanceof Error ? e.message : 'Erro interno.'
    return json(req, { error: msg }, 500)
  }
})
