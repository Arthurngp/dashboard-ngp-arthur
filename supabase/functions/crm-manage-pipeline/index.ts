import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'

Deno.serve(async (req) => {
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

    // Valida sessão
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    // Valida role
    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single()

    if (!usuario || !['ngp', 'admin'].includes(usuario.role)) {
      return json(req, { error: 'Acesso negado.' }, 403)
    }

    // ── ACTIONS ──────────────────────────────────────────────────────────────

    // LIST — listar todos os funis ativos
    if (action === 'list') {
      const { data, error } = await sb
        .from('crm_pipelines')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (error) throw error
      return json(req, { pipelines: data })
    }

    // CREATE — criar novo funil com etapas default
    if (action === 'create') {
      const { name, description } = params
      if (!name?.trim()) return json(req, { error: 'Nome obrigatório.' }, 400)

      const { data: pipeline, error: errP } = await sb
        .from('crm_pipelines')
        .insert({ name: name.trim(), description: description?.trim() || null })
        .select()
        .single()

      if (errP) throw errP

      const defaultStages = [
        { name: 'Prospecção',   position: 0, color: '#9ca3af' },
        { name: 'Qualificação', position: 1, color: '#60a5fa' },
        { name: 'Reunião',      position: 2, color: '#facc15' },
        { name: 'Proposta',     position: 3, color: '#fb923c' },
        { name: 'Fechamento',   position: 4, color: '#4ade80' },
      ]

      const { data: stages, error: errS } = await sb
        .from('crm_pipeline_stages')
        .insert(defaultStages.map(s => ({ ...s, pipeline_id: pipeline.id })))
        .select()

      if (errS) throw errS
      return json(req, { pipeline, stages })
    }

    // RENAME — renomear funil
    if (action === 'rename') {
      const { pipeline_id, name } = params
      if (!pipeline_id) return json(req, { error: 'pipeline_id obrigatório.' }, 400)
      if (!name?.trim()) return json(req, { error: 'Nome obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_pipelines')
        .update({ name: name.trim() })
        .eq('id', pipeline_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { pipeline: data })
    }

    // DELETE — excluir funil (bloqueia se tiver leads)
    if (action === 'delete') {
      const { pipeline_id } = params
      if (!pipeline_id) return json(req, { error: 'pipeline_id obrigatório.' }, 400)

      const { count } = await sb
        .from('crm_leads')
        .select('*', { count: 'exact', head: true })
        .eq('pipeline_id', pipeline_id)

      if (count && count > 0) {
        return json(req, {
          error: `Não é possível excluir: este funil possui ${count} lead(s). Mova ou exclua os leads primeiro.`,
          leads_count: count,
        }, 409)
      }

      const { error } = await sb
        .from('crm_pipelines')
        .delete()
        .eq('id', pipeline_id)

      if (error) throw error
      return json(req, { ok: true })
    }

    return json(req, { error: `Action '${action}' desconhecida.` }, 400)

  } catch (e) {
    console.error('[crm-manage-pipeline]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
