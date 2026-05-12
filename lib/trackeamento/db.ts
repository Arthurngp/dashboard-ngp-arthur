import { efCall } from '@/lib/api'
import { trackeamentoSupabase } from '@/lib/trackeamento/supabase'
import { TRACKEAMENTO_BUCKET } from '@/lib/trackeamento/constants'
import type { NGPForm, FormResponse, FormSession } from '@/types/trackeamento'

type TrackeamentoPayload = Record<string, unknown> & { action: string }
type SignedUploadPayload = {
  path: string
  token: string
  public_url: string
}

async function callTrackeamento<T>(
  payload: TrackeamentoPayload,
  options?: { skipSession?: boolean },
): Promise<T> {
  const data = await efCall('trackeamento-forms', payload, options)
  if (data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Erro ao carregar módulo de trackeamento.')
  }
  return data as T
}

export async function getForms(): Promise<NGPForm[]> {
  const data = await callTrackeamento<{ forms: NGPForm[] }>({ action: 'list_forms' })
  return data.forms || []
}

export async function getForm(id: string): Promise<NGPForm | null> {
  const data = await callTrackeamento<{ form: NGPForm | null }>({ action: 'get_form', id })
  return data.form || null
}

export async function getPublicForm(id: string): Promise<NGPForm | null> {
  const data = await callTrackeamento<{ form: NGPForm | null }>(
    { action: 'get_public_form', id },
    { skipSession: true },
  )
  return data.form || null
}

export async function saveForm(form: NGPForm): Promise<NGPForm> {
  const data = await callTrackeamento<{ form: NGPForm }>({ action: 'save_form', form })
  return data.form
}

export async function deleteForm(id: string): Promise<void> {
  await callTrackeamento({ action: 'delete_form', id })
}

export async function duplicateForm(id: string): Promise<NGPForm | null> {
  const data = await callTrackeamento<{ form: NGPForm | null }>({ action: 'duplicate_form', id })
  return data.form || null
}

export async function getResponses(formId: string): Promise<FormResponse[]> {
  const data = await callTrackeamento<{ responses: FormResponse[] }>({ action: 'list_responses', form_id: formId })
  return data.responses || []
}

export async function saveResponse(
  formId: string,
  answers: FormResponse['answers'],
): Promise<FormResponse> {
  const data = await callTrackeamento<{ response: FormResponse }>(
    { action: 'save_public_response', form_id: formId, answers },
    { skipSession: true },
  )
  return data.response
}

export async function getAllResponseCounts(): Promise<Record<string, number>> {
  const data = await callTrackeamento<{ counts: Record<string, number> }>({ action: 'get_response_counts' })
  return data.counts || {}
}

export async function getResponseCount(formId: string): Promise<number> {
  const data = await callTrackeamento<{ count: number }>({ action: 'get_response_count', form_id: formId })
  return data.count || 0
}

export async function getSessions(formId: string): Promise<FormSession[]> {
  const data = await callTrackeamento<{ sessions: FormSession[] }>({ action: 'list_sessions', form_id: formId })
  return data.sessions || []
}

export async function createSession(formId: string): Promise<FormSession> {
  const data = await callTrackeamento<{ session: FormSession }>(
    { action: 'create_public_session', form_id: formId },
    { skipSession: true },
  )
  return data.session
}

export async function updateSession(session: FormSession): Promise<void> {
  await callTrackeamento(
    { action: 'update_public_session', session },
    { skipSession: true },
  )
}

export async function completeSession(session: FormSession): Promise<FormSession> {
  const data = await callTrackeamento<{ session: FormSession }>(
    { action: 'complete_public_session', session },
    { skipSession: true },
  )
  return data.session
}

export async function abandonSession(session: FormSession): Promise<void> {
  await callTrackeamento(
    { action: 'abandon_public_session', session },
    { skipSession: true },
  )
}

export async function uploadImage(file: File, formId: string): Promise<string> {
  const upload = await callTrackeamento<SignedUploadPayload>({
    action: 'create_builder_asset_upload',
    form_id: formId,
    file_name: file.name,
  })

  const { error } = await trackeamentoSupabase.storage
    .from(TRACKEAMENTO_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, file, {
      upsert: true,
      contentType: file.type,
    })

  if (error) throw error

  return upload.public_url
}

export async function deleteImage(url: string): Promise<void> {
  await callTrackeamento({
    action: 'delete_builder_asset',
    url,
  })
}

export async function uploadFile(file: File, formId: string): Promise<string> {
  const upload = await callTrackeamento<SignedUploadPayload>(
    {
      action: 'create_public_response_upload',
      form_id: formId,
      file_name: file.name,
    },
    { skipSession: true },
  )

  const { error } = await trackeamentoSupabase.storage
    .from(TRACKEAMENTO_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, file, {
      upsert: false,
      contentType: file.type,
    })

  if (error) throw error

  return upload.public_url
}
