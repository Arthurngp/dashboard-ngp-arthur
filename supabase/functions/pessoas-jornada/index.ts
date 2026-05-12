import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

const COLS = ['min_dom','min_seg','min_ter','min_qua','min_qui','min_sex','min_sab'] as const

const DEFAULT_NGP = {
  min_dom: 0,
  min_seg: 540, min_ter: 540, min_qua: 540, min_qui: 540,
  min_sex: 480,
  min_sab: 0,
}

function sanitizeMins(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const int = Math.round(n)
  if (int < 0 || int > 1440) return null
  return int
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)

    if (action === 'obter') {
      const { usuario_id } = body as { usuario_id?: string }
      const targetId = usuario_id || user.usuario_id
      // Permissão: admin pode ver de qualquer um; usuário comum só do próprio.
      if (targetId !== user.usuario_id && !isAdmin(user.role)) {
        return json(req, { error: 'Sem permissão para ver jornada de outro usuário.' }, 403)
      }
      const { data, error } = await sb.from('usuario_jornada')
        .select('*').eq('usuario_id', targetId).maybeSingle()
      if (error) return json(req, { error: 'Erro ao buscar jornada.' }, 500)
      // Se não houver registro, devolve default NGP indicando que ainda não foi customizado.
      return json(req, {
        jornada: data || { usuario_id: targetId, ...DEFAULT_NGP },
        is_default: !data,
      })
    }

    if (action === 'obter_bulk') {
      // Para a tela de registros: obter jornada de vários usuários de uma vez.
      const { usuario_ids } = body as { usuario_ids?: string[] }
      if (!Array.isArray(usuario_ids) || usuario_ids.length === 0) {
        return json(req, { jornadas: {} })
      }
      const isAdminUser = isAdmin(user.role)
      // Não admin: só pode pedir o próprio (filtra os outros).
      const allowed = isAdminUser ? usuario_ids : usuario_ids.filter(id => id === user.usuario_id)
      if (allowed.length === 0) return json(req, { jornadas: {} })
      const { data, error } = await sb.from('usuario_jornada')
        .select('*').in('usuario_id', allowed)
      if (error) return json(req, { error: 'Erro ao buscar jornadas.' }, 500)
      const map: Record<string, any> = {}
      for (const row of data || []) map[row.usuario_id] = row
      return json(req, { jornadas: map })
    }

    if (action === 'salvar') {
      if (!isAdmin(user.role)) {
        return json(req, { error: 'Apenas admins podem alterar jornadas.' }, 403)
      }
      const { usuario_id, jornada } = body as { usuario_id?: string; jornada?: Record<string, unknown> }
      if (!usuario_id) return json(req, { error: 'usuario_id obrigatório.' }, 400)
      if (!jornada || typeof jornada !== 'object') return json(req, { error: 'jornada obrigatória.' }, 400)

      const upsertRow: Record<string, any> = { usuario_id, updated_at: new Date().toISOString() }
      for (const col of COLS) {
        const v = sanitizeMins((jornada as any)[col])
        if (v == null) return json(req, { error: `Campo ${col} inválido (esperado 0..1440).` }, 400)
        upsertRow[col] = v
      }

      const { data, error } = await sb.from('usuario_jornada')
        .upsert(upsertRow, { onConflict: 'usuario_id' })
        .select().single()
      if (error) return json(req, { error: 'Erro ao salvar jornada.' }, 500)
      return json(req, { jornada: data })
    }

    if (action === 'resetar') {
      // Volta ao default NGP (deleta a linha custom).
      if (!isAdmin(user.role)) {
        return json(req, { error: 'Apenas admins podem resetar jornadas.' }, 403)
      }
      const { usuario_id } = body as { usuario_id?: string }
      if (!usuario_id) return json(req, { error: 'usuario_id obrigatório.' }, 400)
      const { error } = await sb.from('usuario_jornada').delete().eq('usuario_id', usuario_id)
      if (error) return json(req, { error: 'Erro ao resetar jornada.' }, 500)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e: any) {
    console.error('[pessoas-jornada] Error:', e)
    return json(req, { error: e?.message || 'Erro interno.' }, 500)
  }
})
