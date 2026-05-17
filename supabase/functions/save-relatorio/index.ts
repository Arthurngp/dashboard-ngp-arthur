import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from "../_shared/cors.ts"

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const obj = e as Record<string, unknown>
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e))
}

// Limite de payload: relatórios podem ter base64 de imagens nos campos antigos.
// Hoje subimos pro Storage e guardamos URL — payload caiu pra <500KB típicos.
// 5MB cobre relatórios extensos sem permitir flood/DoS.
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    // Lê texto pra checar tamanho antes do parse JSON.
    const raw = await req.text()
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return json(req, { error: `Relatório muito grande (${raw.length} bytes, máx ${MAX_PAYLOAD_BYTES}). Reduza anexos/imagens.` }, 413)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw)
    } catch {
      return json(req, { error: 'JSON inválido.' }, 400)
    }
    const { session_token, cloudId, dados, titulo, periodo, cliente_username, cliente_id: cliente_id_in, data_inicio, data_fim } = parsed as {
      session_token?: string; cloudId?: string; dados?: unknown; titulo?: string; periodo?: string;
      cliente_username?: string; cliente_id?: string; data_inicio?: string; data_fim?: string;
    }

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

    // Resolve cliente_id: pode chegar como clientes.id (caso ideal) OU
    // usuarios.id (frontend manda viewing.id, que vem de get-ngp-data que
    // busca em usuarios). Se não bater em clientes diretamente, tenta via
    // clientes.usuario_id. Se ainda assim não achar, grava NULL.
    let cliente_id: string | null = null
    if (cliente_id_in) {
      const { data: cliMatch } = await sb
        .from('clientes')
        .select('id')
        .eq('id', cliente_id_in)
        .maybeSingle()
      if (cliMatch) {
        cliente_id = cliMatch.id
      } else {
        const { data: cliByUser } = await sb
          .from('clientes')
          .select('id')
          .eq('usuario_id', cliente_id_in)
          .maybeSingle()
        if (cliByUser) cliente_id = cliByUser.id
      }
    }

    if (cloudId) {
      // Update
      const updatePayload: Record<string, unknown> = {
        dados, titulo, periodo, updated_at: new Date().toISOString(),
      }
      if (cliente_username) updatePayload.cliente_username = cliente_username
      if (cliente_id) updatePayload.cliente_id = cliente_id
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
      if (cliente_id) insertPayload.cliente_id = cliente_id
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
