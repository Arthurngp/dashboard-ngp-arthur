// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, action, ...params } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!action)        return json(req, { error: 'Action obrigatória.' }, 400)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Valida sessão e role
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single()

    if (!usuario || !['ngp', 'admin'].includes(usuario.role)) {
      return json(req, { error: 'Acesso negado.' }, 403)
    }

    // ── ACTIONS ──────────────────────────────────────────────────────────────

    // LIST 
    if (action === 'list') {
      const { pipeline_id } = params
      if (!pipeline_id) return json(req, { error: 'pipeline_id obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_pipeline_fields')
        .select('*')
        .eq('pipeline_id', pipeline_id)
        .order('position', { ascending: true })

      if (error) throw error
      return json(req, { fields: data || [] })
    }

    // CREATE
    if (action === 'create') {
      const { pipeline_id, name, type, options } = params
      if (!pipeline_id) return json(req, { error: 'pipeline_id obrigatório.' }, 400)
      if (!name) return json(req, { error: 'name obrigatório.' }, 400)
      if (!type) return json(req, { error: 'type obrigatório.' }, 400)

      const { data: existing } = await sb
        .from('crm_pipeline_fields')
        .select('position')
        .eq('pipeline_id', pipeline_id)
        .order('position', { ascending: false })
        .limit(1)

      const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0

      const { data, error } = await sb
        .from('crm_pipeline_fields')
        .insert({ pipeline_id, name: name.trim(), type, options: options || [], position: nextPosition })
        .select()
        .single()

      if (error) throw error
      return json(req, { field: data })
    }

    // UPDATE
    if (action === 'update') {
      const { field_id, name, type, options } = params
      if (!field_id) return json(req, { error: 'field_id obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_pipeline_fields')
        .update({ name: name?.trim(), type, options })
        .eq('id', field_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { field: data })
    }

    // DELETE
    if (action === 'delete') {
      const { field_id } = params
      if (!field_id) return json(req, { error: 'field_id obrigatório.' }, 400)

      const { error } = await sb
        .from('crm_pipeline_fields')
        .delete()
        .eq('id', field_id)

      if (error) throw error
      return json(req, { ok: true })
    }

    // REORDER
    if (action === 'reorder') {
      const { pipeline_id, ordered_ids } = params
      if (!pipeline_id || !ordered_ids || !Array.isArray(ordered_ids)) {
        return json(req, { error: 'pipeline_id e ordered_ids obrigatórios.' }, 400)
      }

      await Promise.all(
        ordered_ids.map((id: string, index: number) =>
          sb.from('crm_pipeline_fields')
            .update({ position: index })
            .eq('id', id)
            .eq('pipeline_id', pipeline_id)
        )
      )

      return json(req, { ok: true })
    }

    return json(req, { error: `Action '${action}' desconhecida.` }, 400)

  } catch (e) {
    console.error('[crm-manage-fields]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
