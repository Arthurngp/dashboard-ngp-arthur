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

    // LIST — listar tarefas de um lead específico
    if (action === 'list') {
      const { lead_id } = params
      if (!lead_id) return json(req, { error: 'lead_id obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_tasks')
        .select('*')
        .eq('lead_id', lead_id)
        .order('due_date', { ascending: true })

      if (error) throw error
      return json(req, { tasks: data || [] })
    }

    // LIST_USER — listar tarefas do usuário logado (Minha Agenda)
    if (action === 'list_user') {
      const { status, date_from, date_to } = params

      let query = sb
        .from('crm_tasks')
        .select('*, crm_leads(company_name, stage_id)')
        .eq('assigned_to', usuario.id)
        .order('due_date', { ascending: true })

      if (status && status !== 'todas') {
        query = query.eq('status', status)
      }
      if (date_from) {
        query = query.gte('due_date', date_from)
      }
      if (date_to) {
        query = query.lte('due_date', date_to)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error

      // Flatten lead data for convenience
      const tasks = (data || []).map((t: any) => ({
        ...t,
        lead_company_name: t.crm_leads?.company_name,
        lead_stage_id: t.crm_leads?.stage_id,
        crm_leads: undefined,
      }))

      return json(req, { tasks })
    }

    // LIST_TEAM — listar tarefas de todo time (visão gerente)
    if (action === 'list_team') {
      const { status, assigned_to, date_from, date_to } = params

      let query = sb
        .from('crm_tasks')
        .select('*, crm_leads(company_name, stage_id)')
        .order('due_date', { ascending: true })

      if (status && status !== 'todas') {
        query = query.eq('status', status)
      }
      if (assigned_to) {
        query = query.eq('assigned_to', assigned_to)
      }
      if (date_from) {
        query = query.gte('due_date', date_from)
      }
      if (date_to) {
        query = query.lte('due_date', date_to)
      }

      const { data, error } = await query.limit(200)

      if (error) throw error

      const tasks = (data || []).map((t: any) => ({
        ...t,
        lead_company_name: t.crm_leads?.company_name,
        lead_stage_id: t.crm_leads?.stage_id,
        crm_leads: undefined,
      }))

      return json(req, { tasks })
    }

    // CREATE — criar nova tarefa
    if (action === 'create') {
      const { lead_id, title, task_type, due_date, due_time, priority, description, assigned_to_id, assigned_to_name: assignName } = params
      if (!lead_id)      return json(req, { error: 'lead_id obrigatório.' }, 400)
      if (!title?.trim()) return json(req, { error: 'title obrigatório.' }, 400)
      if (!task_type)    return json(req, { error: 'task_type obrigatório.' }, 400)
      if (!due_date)     return json(req, { error: 'due_date obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_tasks')
        .insert({
          lead_id,
          title: title.trim(),
          description: description?.trim() || null,
          task_type,
          due_date,
          due_time: due_time || null,
          priority: priority || 'normal',
          assigned_to: assigned_to_id || usuario.id,
          assigned_to_name: assignName || usuario.nome || 'Usuário',
          created_by: usuario.id,
          created_by_name: usuario.nome || 'Usuário',
        })
        .select()
        .single()

      if (error) throw error
      return json(req, { task: data })
    }

    // UPDATE — atualizar tarefa
    if (action === 'update') {
      const { task_id, title, description, task_type, due_date, due_time, priority, assigned_to_id, assigned_to_name: assignName } = params
      if (!task_id) return json(req, { error: 'task_id obrigatório.' }, 400)

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (title !== undefined)       updates.title = title?.trim() || null
      if (description !== undefined) updates.description = description?.trim() || null
      if (task_type !== undefined)   updates.task_type = task_type
      if (due_date !== undefined)    updates.due_date = due_date
      if (due_time !== undefined)    updates.due_time = due_time
      if (priority !== undefined)    updates.priority = priority
      if (assigned_to_id !== undefined) {
        updates.assigned_to = assigned_to_id
        updates.assigned_to_name = assignName || null
      }

      const { data, error } = await sb
        .from('crm_tasks')
        .update(updates)
        .eq('id', task_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { task: data })
    }

    // COMPLETE — marcar tarefa como concluída
    if (action === 'complete') {
      const { task_id } = params
      if (!task_id) return json(req, { error: 'task_id obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_tasks')
        .update({
          status: 'concluida',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', task_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { task: data })
    }

    // REOPEN — reabrir tarefa concluída
    if (action === 'reopen') {
      const { task_id } = params
      if (!task_id) return json(req, { error: 'task_id obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_tasks')
        .update({
          status: 'pendente',
          completed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { task: data })
    }

    // DELETE — excluir tarefa
    if (action === 'delete') {
      const { task_id } = params
      if (!task_id) return json(req, { error: 'task_id obrigatório.' }, 400)

      const { error } = await sb
        .from('crm_tasks')
        .delete()
        .eq('id', task_id)

      if (error) throw error
      return json(req, { ok: true })
    }

    return json(req, { error: `Action '${action}' desconhecida.` }, 400)

  } catch (e) {
    console.error('[crm-manage-tasks]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
