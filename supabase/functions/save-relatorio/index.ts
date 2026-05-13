import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from "../_shared/cors.ts"

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as Record<string, unknown>
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e))
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, cloudId, dados, titulo, periodo, cliente_username, data_inicio, data_fim } = await req.json()

    if (!session_token) {
      return json(req, { error: 'Sessão inválida.' }, 401)
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

    if (!sessao) {
      return json(req, { error: 'Sessão expirada.' }, 401)
    }

    if (cloudId) {
      // Update
      const updatePayload: Record<string, unknown> = {
        dados, titulo, periodo, updated_at: new Date().toISOString(),
      }
      if (cliente_username) updatePayload.cliente_username = cliente_username
      if (data_inicio) updatePayload.data_inicio = data_inicio
      if (data_fim)    updatePayload.data_fim = data_fim

      const { error } = await sb
        .from('relatorios')
        .update(updatePayload)
        .eq('id', cloudId)

      if (error) {
        console.error('[save-relatorio] update error:', JSON.stringify(error))
        return json(req, { error: errMsg(error) }, 500)
      }

      return json(req, { ok: true, id: cloudId })
    } else {
      // Insert
      const insertPayload: Record<string, unknown> = {
        dados, titulo, periodo,
        criado_por: sessao.usuario_id,
      }
      if (cliente_username) insertPayload.cliente_username = cliente_username
      if (data_inicio) insertPayload.data_inicio = data_inicio
      if (data_fim)    insertPayload.data_fim = data_fim

      const { data, error } = await sb
        .from('relatorios')
        .insert(insertPayload)
        .select('id')
        .single()

      if (error) {
        console.error('[save-relatorio] insert error:', JSON.stringify(error))
        return json(req, { error: errMsg(error) }, 500)
      }

      return json(req, { ok: true, id: data.id })
    }

  } catch (e) {
    console.error('[save-relatorio] catch:', e)
    return json(req, { error: errMsg(e) }, 500)
  }
})
