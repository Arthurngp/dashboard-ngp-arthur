// @ts-nocheck
import { createClient } from 'supabase'
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

    // Busca dados do usuário
    const { data: usuario } = await sb
      .from('usuarios')
      .select('id, role, nome')
      .eq('id', sessao.usuario_id)
      .single()

    if (!usuario || !['ngp', 'admin'].includes(usuario.role)) {
      return json(req, { error: 'Acesso negado.' }, 403)
    }

    // ── ACTIONS ──────────────────────────────────────────────────────────────

    // LIST — listar atividades de um lead
    if (action === 'list') {
      const { lead_id, limit: rawLimit } = params
      if (!lead_id) return json(req, { error: 'lead_id obrigatório.' }, 400)

      const queryLimit = Math.min(parseInt(rawLimit) || 50, 200)

      const { data, error } = await sb
        .from('crm_activities')
        .select('*')
        .eq('lead_id', lead_id)
        .order('created_at', { ascending: false })
        .limit(queryLimit)

      if (error) throw error
      return json(req, { activities: data || [] })
    }

    // CREATE — registrar atividade manual
    if (action === 'create') {
      const { lead_id, activity_type, title, description, duration_minutes } = params
      if (!lead_id)       return json(req, { error: 'lead_id obrigatório.' }, 400)
      if (!activity_type) return json(req, { error: 'activity_type obrigatório.' }, 400)
      if (!title?.trim())  return json(req, { error: 'title obrigatório.' }, 400)

      const allowedTypes = ['ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'nota_interna']
      if (!allowedTypes.includes(activity_type)) {
        return json(req, { error: `activity_type inválido. Permitidos: ${allowedTypes.join(', ')}` }, 400)
      }

      const { data, error } = await sb
        .from('crm_activities')
        .insert({
          lead_id,
          activity_type,
          title: title.trim(),
          description: description?.trim() || null,
          duration_minutes: duration_minutes || null,
          created_by: usuario.id,
          created_by_name: usuario.nome || 'Usuário',
          metadata: {},
        })
        .select()
        .single()

      if (error) throw error
      return json(req, { activity: data })
    }

    // LOG_AUTO — registrar atividade automática do sistema
    if (action === 'log_auto') {
      const { lead_id, activity_type, title, metadata } = params
      if (!lead_id)       return json(req, { error: 'lead_id obrigatório.' }, 400)
      if (!activity_type) return json(req, { error: 'activity_type obrigatório.' }, 400)
      if (!title?.trim())  return json(req, { error: 'title obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_activities')
        .insert({
          lead_id,
          activity_type,
          title: title.trim(),
          metadata: metadata || {},
          created_by: usuario.id,
          created_by_name: usuario.nome || 'Sistema',
        })
        .select()
        .single()

      if (error) throw error
      return json(req, { activity: data })
    }

    return json(req, { error: `Action '${action}' desconhecida.` }, 400)

  } catch (e) {
    console.error('[crm-manage-activities]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
