import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'

type Op =
  | 'bootstrap'
  | 'task_create'
  | 'task_update'
  | 'task_delete'
  | 'setor_create'
  | 'setor_update'
  | 'setor_delete'
  | 'setores_list_all'

interface TaskPayload {
  title?: string
  description?: string | null
  status?: string
  priority?: string
  assigned_to?: string | null
  client_id?: string | null
  setor_id?: string | null
  due_date?: string | null
}

interface SetorPayload {
  nome?: string
  cor?: string
  ordem?: number
  ativo?: boolean
  client_id?: string | null
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, op } = body as { session_token?: string; op?: Op }

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!op) return json(req, { error: 'op obrigatório.' }, 400)

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    const userId = sessao.usuario_id as string

    // Carrega papel do usuário (admin x outros) — usado para gates
    const { data: usuario } = await sb
      .from('usuarios')
      .select('id, role')
      .eq('id', userId)
      .single()

    const isAdmin = usuario?.role === 'admin'

    // ── Operações ─────────────────────────────────────────────────────────
    if (op === 'bootstrap') {
      const { client_id_filter } = body as { client_id_filter?: string | null }
      const setoresQuery = sb
        .from('task_setores')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true })

      if (client_id_filter) setoresQuery.eq('client_id', client_id_filter)
      else setoresQuery.is('client_id', null)

      const [tasksRes, colabRes, setoresRes] = await Promise.all([
        sb
          .from('tasks')
          .select(
            '*,assignee:usuarios!tasks_assigned_to_fkey(id,nome,foto_url),cliente:usuarios!tasks_client_id_fkey(id,nome,username,foto_url),setor:task_setores(id,nome,cor,ordem,ativo)'
          )
          .order('created_at', { ascending: false }),
        sb
          .from('usuarios')
          .select('id,nome,foto_url')
          .order('nome', { ascending: true }),
        setoresQuery,
      ])

      return json(req, {
        tasks: tasksRes.data || [],
        colaboradores: colabRes.data || [],
        setores: setoresRes.data || [],
      })
    }

    if (op === 'task_create') {
      const payload = (body.payload as TaskPayload) || {}
      if (!payload.title?.trim()) return json(req, { error: 'title obrigatório.' }, 400)

      const insertData = {
        ...payload,
        created_by: userId,
      }
      const { data, error } = await sb
        .from('tasks')
        .insert(insertData)
        .select('*')
        .single()
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { task: data })
    }

    if (op === 'task_update') {
      const { id, payload } = body as { id?: string; payload?: TaskPayload }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)
      const { data, error } = await sb
        .from('tasks')
        .update(payload || {})
        .eq('id', id)
        .select('*')
        .single()
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { task: data })
    }

    if (op === 'task_delete') {
      const { id } = body as { id?: string }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)
      const { error } = await sb.from('tasks').delete().eq('id', id)
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { ok: true })
    }

    if (op === 'setor_create') {
      const payload = (body.payload as SetorPayload) || {}
      if (!payload.nome?.trim()) return json(req, { error: 'nome obrigatório.' }, 400)
      const insertData = {
        nome: payload.nome.trim(),
        cor: payload.cor || '#3b82f6',
        ordem: payload.ordem ?? 99,
        ativo: payload.ativo ?? true,
        client_id: payload.client_id ?? null,
      }
      const { data, error } = await sb
        .from('task_setores')
        .insert(insertData)
        .select('*')
        .single()
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { setor: data })
    }

    if (op === 'setor_update') {
      if (!isAdmin) return json(req, { error: 'Apenas admin pode alterar setores.' }, 403)
      const { id, payload } = body as { id?: string; payload?: SetorPayload }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)
      const { data, error } = await sb
        .from('task_setores')
        .update(payload || {})
        .eq('id', id)
        .select('*')
        .single()
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { setor: data })
    }

    if (op === 'setor_delete') {
      if (!isAdmin) return json(req, { error: 'Apenas admin pode excluir setores.' }, 403)
      const { id } = body as { id?: string }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)
      const { error } = await sb.from('task_setores').delete().eq('id', id)
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { ok: true })
    }

    if (op === 'setores_list_all') {
      if (!isAdmin) return json(req, { error: 'Apenas admin pode listar todos os setores.' }, 403)
      const { data, error } = await sb
        .from('task_setores')
        .select('*')
        .order('ordem', { ascending: true })
      if (error) return json(req, { error: error.message }, 500)
      return json(req, { setores: data || [] })
    }

    return json(req, { error: `op desconhecido: ${op}` }, 400)
  } catch (e) {
    return json(req, { error: String(e) }, 500)
  }
})
