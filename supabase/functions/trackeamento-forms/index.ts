import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { isNgp, validateSession } from '../_shared/roles.ts'

type JsonRecord = Record<string, unknown>
const BUCKET = 'trackeamento-form-assets'
const ASSETS_PREFIX = 'assets'
const RESPONSES_PREFIX = 'responses'

type TrackeamentoForm = {
  id: string
  title: string
  description: string
  fields: unknown[]
  theme: JsonRecord
  settings: JsonRecord
  published: boolean
  createdAt: string
  updatedAt: string
}

type TrackeamentoResponse = {
  id: string
  answers: JsonRecord
  submittedAt: string
}

type TrackeamentoSession = {
  id: string
  formId: string
  status: string
  startedAt: string
  completedAt?: string
  totalTimeMs?: number
  lastFieldId?: string
  steps: unknown[]
}

const INTERNAL_ACTIONS = new Set([
  'list_forms',
  'get_form',
  'save_form',
  'create_builder_asset_upload',
  'delete_builder_asset',
  'delete_form',
  'duplicate_form',
  'list_responses',
  'get_response_counts',
  'get_response_count',
  'list_sessions',
])

function mapForm(row: Record<string, unknown>): TrackeamentoForm {
  return {
    id: row.id as string,
    title: (row.title as string) || '',
    description: (row.description as string) || '',
    fields: (row.fields as unknown[]) || [],
    theme: (row.theme as JsonRecord) || {},
    settings: (row.settings as JsonRecord) || {},
    published: Boolean(row.published),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function mapResponse(row: Record<string, unknown>): TrackeamentoResponse {
  return {
    id: row.id as string,
    answers: (row.answers as JsonRecord) || {},
    submittedAt: row.submitted_at as string,
  }
}

function mapSession(row: Record<string, unknown>): TrackeamentoSession {
  return {
    id: row.id as string,
    formId: row.form_id as string,
    status: row.status as string,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string | null) ?? undefined,
    totalTimeMs: (row.total_time_ms as number | null) ?? undefined,
    lastFieldId: (row.last_field_id as string | null) ?? undefined,
    steps: (row.steps as unknown[]) || [],
  }
}

function makeId() {
  return crypto.randomUUID()
}

function sanitizeFileName(fileName: string) {
  const normalized = (fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  return normalized.length > 0 ? normalized : 'file'
}

function publicUrlFor(sb: ReturnType<typeof createClient>, path: string) {
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

async function createSignedUpload(
  sb: ReturnType<typeof createClient>,
  path: string,
) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path, {
    upsert: false,
  })
  if (error || !data?.token) throw error || new Error('Erro ao gerar upload assinado.')
  return {
    path,
    token: data.token,
    public_url: publicUrlFor(sb, path),
  }
}

function extractPathFromPublicUrl(url: string) {
  const marker = `${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return url.slice(idx + marker.length)
}

async function ensurePublishedForm(sb: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await sb
    .from('trackeamento_forms')
    .select('*')
    .eq('id', id)
    .eq('published', true)
    .single()

  if (error || !data) return null
  return data as Record<string, unknown>
}

async function ensurePublicSession(
  sb: ReturnType<typeof createClient>,
  id: string,
) {
  const { data, error } = await sb
    .from('trackeamento_form_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null

  const publishedForm = await ensurePublishedForm(sb, data.form_id as string)
  if (!publishedForm) return null

  return data as Record<string, unknown>
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const payload = await req.json()
    const action = payload.action as string | undefined

    if (!action) return json(req, { error: 'Ação inválida.' }, 400)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let actor: Awaited<ReturnType<typeof validateSession>> = null
    if (INTERNAL_ACTIONS.has(action)) {
      const sessionToken = payload.session_token as string | undefined
      if (!sessionToken) return json(req, { error: 'Sessão inválida.' }, 401)
      actor = await validateSession(sb, sessionToken)
      if (!actor) return json(req, { error: 'Sessão expirada.' }, 401)
      if (!isNgp(actor.role)) return json(req, { error: 'Acesso negado.' }, 403)
    }

    if (action === 'list_forms') {
      const { data, error } = await sb
        .from('trackeamento_forms')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      return json(req, { forms: (data || []).map((row) => mapForm(row)) })
    }

    if (action === 'get_form') {
      const id = payload.id as string | undefined
      if (!id) return json(req, { error: 'Formulário inválido.' }, 400)

      const { data, error } = await sb
        .from('trackeamento_forms')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') return json(req, { form: null })
        throw error
      }

      return json(req, { form: mapForm(data) })
    }

    if (action === 'get_public_form') {
      const id = payload.id as string | undefined
      if (!id) return json(req, { error: 'Formulário inválido.' }, 400)

      const form = await ensurePublishedForm(sb, id)
      return json(req, { form: form ? mapForm(form) : null })
    }

    if (action === 'save_form') {
      const form = payload.form as TrackeamentoForm | undefined
      if (!form?.id || !actor) return json(req, { error: 'Formulário inválido.' }, 400)

      const { data: existing } = await sb
        .from('trackeamento_forms')
        .select('created_at, created_by')
        .eq('id', form.id)
        .maybeSingle()

      const row = {
        id: form.id,
        title: form.title || '',
        description: form.description || '',
        fields: form.fields || [],
        theme: form.theme || {},
        settings: form.settings || {},
        published: Boolean(form.published),
        created_at: existing?.created_at || form.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: existing?.created_by || actor.usuario_id,
        updated_by: actor.usuario_id,
      }

      const { data, error } = await sb
        .from('trackeamento_forms')
        .upsert(row, { onConflict: 'id' })
        .select('*')
        .single()

      if (error) throw error
      return json(req, { form: mapForm(data) })
    }

    if (action === 'create_builder_asset_upload') {
      const formId = payload.form_id as string | undefined
      const fileName = payload.file_name as string | undefined
      if (!formId || !fileName || !actor) return json(req, { error: 'Upload inválido.' }, 400)

      const path = `${ASSETS_PREFIX}/${formId}/${Date.now()}_${sanitizeFileName(fileName)}`
      return json(req, await createSignedUpload(sb, path))
    }

    if (action === 'delete_form') {
      const id = payload.id as string | undefined
      if (!id) return json(req, { error: 'Formulário inválido.' }, 400)

      await sb.from('trackeamento_form_sessions').delete().eq('form_id', id)
      await sb.from('trackeamento_form_responses').delete().eq('form_id', id)
      const { error } = await sb.from('trackeamento_forms').delete().eq('id', id)
      if (error) throw error
      return json(req, { ok: true })
    }

    if (action === 'delete_builder_asset') {
      const url = payload.url as string | undefined
      if (!url || !actor) return json(req, { error: 'Arquivo inválido.' }, 400)

      const path = extractPathFromPublicUrl(url)
      if (!path || !path.startsWith(`${ASSETS_PREFIX}/`)) {
        return json(req, { error: 'Arquivo inválido.' }, 400)
      }

      const { error } = await sb.storage.from(BUCKET).remove([path])
      if (error) throw error
      return json(req, { ok: true })
    }

    if (action === 'duplicate_form') {
      const id = payload.id as string | undefined
      if (!id || !actor) return json(req, { error: 'Formulário inválido.' }, 400)

      const { data, error } = await sb
        .from('trackeamento_forms')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') return json(req, { form: null })
        throw error
      }

      const duplicated = {
        ...data,
        id: makeId(),
        title: `${(data.title as string) || 'Formulário'} (cópia)`,
        published: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: actor.usuario_id,
        updated_by: actor.usuario_id,
      }

      const { data: saved, error: saveError } = await sb
        .from('trackeamento_forms')
        .insert(duplicated)
        .select('*')
        .single()

      if (saveError) throw saveError
      return json(req, { form: mapForm(saved) })
    }

    if (action === 'list_responses') {
      const formId = payload.form_id as string | undefined
      if (!formId) return json(req, { error: 'Formulário inválido.' }, 400)

      const { data, error } = await sb
        .from('trackeamento_form_responses')
        .select('*')
        .eq('form_id', formId)
        .order('submitted_at', { ascending: false })

      if (error) throw error
      return json(req, { responses: (data || []).map((row) => mapResponse(row)) })
    }

    if (action === 'create_public_response_upload') {
      const formId = payload.form_id as string | undefined
      const fileName = payload.file_name as string | undefined
      if (!formId || !fileName) return json(req, { error: 'Upload inválido.' }, 400)

      const form = await ensurePublishedForm(sb, formId)
      if (!form) return json(req, { error: 'Formulário não publicado.' }, 404)

      const path = `${RESPONSES_PREFIX}/${formId}/${makeId()}_${sanitizeFileName(fileName)}`
      return json(req, await createSignedUpload(sb, path))
    }

    if (action === 'save_public_response') {
      const formId = payload.form_id as string | undefined
      const answers = (payload.answers as JsonRecord | undefined) || {}
      if (!formId) return json(req, { error: 'Formulário inválido.' }, 400)

      const form = await ensurePublishedForm(sb, formId)
      if (!form) return json(req, { error: 'Formulário não publicado.' }, 404)

      const row = {
        id: makeId(),
        form_id: formId,
        answers,
        submitted_at: new Date().toISOString(),
      }

      const { data, error } = await sb
        .from('trackeamento_form_responses')
        .insert(row)
        .select('*')
        .single()

      if (error) throw error
      return json(req, { response: mapResponse(data) })
    }

    if (action === 'get_response_counts') {
      const { data, error } = await sb
        .from('trackeamento_form_responses')
        .select('form_id')

      if (error) throw error

      const counts: Record<string, number> = {}
      for (const row of data || []) {
        const formId = row.form_id as string
        counts[formId] = (counts[formId] || 0) + 1
      }
      return json(req, { counts })
    }

    if (action === 'get_response_count') {
      const formId = payload.form_id as string | undefined
      if (!formId) return json(req, { error: 'Formulário inválido.' }, 400)

      const { count, error } = await sb
        .from('trackeamento_form_responses')
        .select('id', { count: 'exact', head: true })
        .eq('form_id', formId)

      if (error) throw error
      return json(req, { count: count || 0 })
    }

    if (action === 'list_sessions') {
      const formId = payload.form_id as string | undefined
      if (!formId) return json(req, { error: 'Formulário inválido.' }, 400)

      const { data, error } = await sb
        .from('trackeamento_form_sessions')
        .select('*')
        .eq('form_id', formId)
        .order('started_at', { ascending: false })

      if (error) throw error
      return json(req, { sessions: (data || []).map((row) => mapSession(row)) })
    }

    if (action === 'create_public_session') {
      const formId = payload.form_id as string | undefined
      if (!formId) return json(req, { error: 'Formulário inválido.' }, 400)

      const form = await ensurePublishedForm(sb, formId)
      if (!form) return json(req, { error: 'Formulário não publicado.' }, 404)

      const row = {
        id: makeId(),
        form_id: formId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        steps: [],
      }

      const { data, error } = await sb
        .from('trackeamento_form_sessions')
        .insert(row)
        .select('*')
        .single()

      if (error) throw error
      return json(req, { session: mapSession(data) })
    }

    if (action === 'update_public_session') {
      const session = payload.session as TrackeamentoSession | undefined
      if (!session?.id) return json(req, { error: 'Sessão inválida.' }, 400)

      const existing = await ensurePublicSession(sb, session.id)
      if (!existing) return json(req, { error: 'Sessão não encontrada.' }, 404)

      const { error } = await sb
        .from('trackeamento_form_sessions')
        .update({
          status: session.status,
          last_field_id: session.lastFieldId ?? null,
          steps: session.steps || [],
          completed_at: session.completedAt ?? null,
          total_time_ms: session.totalTimeMs ?? null,
        })
        .eq('id', session.id)

      if (error) throw error
      return json(req, { ok: true })
    }

    if (action === 'complete_public_session') {
      const session = payload.session as TrackeamentoSession | undefined
      if (!session?.id || !session.startedAt) return json(req, { error: 'Sessão inválida.' }, 400)

      const existing = await ensurePublicSession(sb, session.id)
      if (!existing) return json(req, { error: 'Sessão não encontrada.' }, 404)

      const completedAt = new Date().toISOString()
      const totalTimeMs = Math.max(0, Date.now() - new Date(session.startedAt).getTime())

      const row = {
        status: 'completed',
        last_field_id: session.lastFieldId ?? null,
        steps: session.steps || [],
        completed_at: completedAt,
        total_time_ms: totalTimeMs,
      }

      const { data, error } = await sb
        .from('trackeamento_form_sessions')
        .update(row)
        .eq('id', session.id)
        .select('*')
        .single()

      if (error) throw error
      return json(req, { session: mapSession(data) })
    }

    if (action === 'abandon_public_session') {
      const session = payload.session as TrackeamentoSession | undefined
      if (!session?.id) return json(req, { error: 'Sessão inválida.' }, 400)

      const existing = await ensurePublicSession(sb, session.id)
      if (!existing) return json(req, { error: 'Sessão não encontrada.' }, 404)

      const { error } = await sb
        .from('trackeamento_form_sessions')
        .update({
          status: 'abandoned',
          last_field_id: session.lastFieldId ?? null,
          steps: session.steps || [],
        })
        .eq('id', session.id)

      if (error) throw error
      return json(req, { ok: true })
    }

    return json(req, { error: 'Ação não suportada.' }, 400)
  } catch (error) {
    console.error('[trackeamento-forms]', error)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
