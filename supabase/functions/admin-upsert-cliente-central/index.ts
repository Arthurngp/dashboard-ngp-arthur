import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isNgp } from "../_shared/roles.ts"

const PBKDF2_ITERATIONS = 100_000

async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  if (!salt) salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  const hashHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${saltHex}:${hashHex}`
}

async function ensureDefaultPipeline(sb: any, clienteId: string, clienteNome: string, pipelineName?: string | null) {
  const { data: existing } = await sb
    .from('crm_pipelines')
    .select('id, name')
    .eq('cliente_id', clienteId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) return existing

  const { data: pipeline, error: pipelineError } = await sb
    .from('crm_pipelines')
    .insert({
      name: pipelineName?.trim() || `CRM de ${clienteNome}`,
      description: `CRM digital do cliente ${clienteNome}`,
      cliente_id: clienteId,
    })
    .select('id, name')
    .single()

  if (pipelineError) throw pipelineError

  const stages = [
    { name: 'Prospecção', position: 0, color: '#9ca3af' },
    { name: 'Qualificação', position: 1, color: '#60a5fa' },
    { name: 'Reunião', position: 2, color: '#facc15' },
    { name: 'Proposta', position: 3, color: '#fb923c' },
    { name: 'Fechamento', position: 4, color: '#4ade80' },
  ]

  const { error: stagesError } = await sb
    .from('crm_pipeline_stages')
    .insert(stages.map((stage) => ({ ...stage, pipeline_id: pipeline.id })))

  if (stagesError) throw stagesError
  return pipeline
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const {
      session_token,
      id,
      nome,
      email,
      password,
      meta_account_id,
      ativo,
      analytics_enabled,
      reports_enabled,
      crm_enabled,
      crm_pipeline_name,
    } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!nome?.trim()) return json(req, { error: 'Nome do cliente é obrigatório.' }, 400)
    if (!email?.trim()) return json(req, { error: 'Email do cliente é obrigatório.' }, 400)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const actor = await validateSession(sb, session_token)
    if (!actor) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isNgp(actor.role)) return json(req, { error: 'Acesso negado.' }, 403)

    const nomeClean = String(nome).trim()
    const emailClean = String(email).trim().toLowerCase()
    const usernameClean = emailClean
    const metaAccountClean = meta_account_id ? String(meta_account_id).trim().replace(/^act_/, '') : null

    if (metaAccountClean && !/^\d+$/.test(metaAccountClean)) {
      return json(req, { error: 'Meta Account ID inválido. Use somente números ou act_123456.' }, 400)
    }

    if (!id && (!password || String(password).length < 6)) {
      return json(req, { error: 'A senha inicial deve ter pelo menos 6 caracteres.' }, 400)
    }

    let clienteId = id as string | undefined
    let authUserId: string | null = null

    if (clienteId) {
      const { data: existingCliente, error: existingError } = await sb
        .from('usuarios')
        .select('id, auth_user_id, email')
        .eq('id', clienteId)
        .eq('role', 'cliente')
        .single()

      if (existingError || !existingCliente) {
        return json(req, { error: 'Cliente não encontrado.' }, 404)
      }
      authUserId = existingCliente.auth_user_id

      const { data: duplicatedEmail } = await sb
        .from('usuarios')
        .select('id')
        .eq('email', emailClean)
        .neq('id', clienteId)
        .maybeSingle()

      if (duplicatedEmail) return json(req, { error: 'Esse email já está em uso por outro usuário.' }, 409)

      const updateAuthPayload: Record<string, unknown> = {
        email: emailClean,
        email_confirm: true,
      }
      if (password) updateAuthPayload.password = String(password)

      if (authUserId) {
        const { error: authUpdateError } = await sb.auth.admin.updateUserById(authUserId, updateAuthPayload)
        if (authUpdateError) {
          console.error('[admin-upsert-cliente-central] auth update error', authUpdateError)
          return json(req, { error: authUpdateError.message || 'Erro ao atualizar acesso do cliente.' }, 500)
        }
      }

      const updatePayload: Record<string, unknown> = {
        nome: nomeClean,
        username: usernameClean,
        email: emailClean,
        meta_account_id: metaAccountClean,
        ativo: ativo !== false,
      }

      if (password) updatePayload.password_hash = await hashPassword(String(password))

      const { error: updateClienteError } = await sb
        .from('usuarios')
        .update(updatePayload)
        .eq('id', clienteId)
        .eq('role', 'cliente')

      if (updateClienteError) {
        console.error('[admin-upsert-cliente-central] updateClienteError', updateClienteError)
        return json(req, { error: 'Erro ao atualizar cadastro do cliente.' }, 500)
      }
    } else {
      const { data: duplicatedEmail } = await sb
        .from('usuarios')
        .select('id')
        .or(`email.eq.${emailClean},username.eq.${usernameClean}`)
        .maybeSingle()

      if (duplicatedEmail) return json(req, { error: 'Esse email já está em uso.' }, 409)

      const { data: authData, error: authError } = await sb.auth.admin.createUser({
        email: emailClean,
        password: String(password),
        email_confirm: true,
      })

      if (authError || !authData?.user) {
        console.error('[admin-upsert-cliente-central] auth create error', authError)
        return json(req, { error: authError?.message || 'Erro ao criar o acesso do cliente.' }, 500)
      }

      authUserId = authData.user.id
      const passwordHash = await hashPassword(String(password))

      const { data: createdCliente, error: createClienteError } = await sb
        .from('usuarios')
        .insert({
          nome: nomeClean,
          username: usernameClean,
          email: emailClean,
          role: 'cliente',
          ativo: ativo !== false,
          auth_user_id: authUserId,
          meta_account_id: metaAccountClean,
          password_hash: passwordHash,
          setor: 'Cliente',
        })
        .select('id')
        .single()

      if (createClienteError || !createdCliente) {
        if (authUserId) await sb.auth.admin.deleteUser(authUserId)
        console.error('[admin-upsert-cliente-central] createClienteError', createClienteError)
        return json(req, { error: 'Erro ao salvar o cliente.' }, 500)
      }

      clienteId = createdCliente.id
    }

    const { error: accessError } = await sb
      .from('cliente_portal_acessos')
      .upsert({
        usuario_id: clienteId,
        analytics_enabled: analytics_enabled !== false,
        reports_enabled: reports_enabled !== false,
        crm_enabled: crm_enabled === true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'usuario_id' })

    if (accessError) {
      console.error('[admin-upsert-cliente-central] accessError', accessError)
      return json(req, { error: 'Erro ao salvar acessos do cliente.' }, 500)
    }

    if (crm_enabled === true) {
      try {
        await ensureDefaultPipeline(sb, clienteId!, nomeClean, crm_pipeline_name)
      } catch (pipelineError) {
        console.error('[admin-upsert-cliente-central] pipelineError', pipelineError)
        return json(req, { error: 'Cliente salvo, mas houve erro ao preparar o CRM.' }, 500)
      }
    }

    const { data: cliente, error: clienteError } = await sb
      .from('usuarios')
      .select('id, nome, username, email, ativo, meta_account_id')
      .eq('id', clienteId)
      .single()

    if (clienteError || !cliente) {
      console.error('[admin-upsert-cliente-central] cliente reload error', clienteError)
      return json(req, { error: 'Cliente salvo, mas não foi possível recarregar os dados.' }, 500)
    }

    return json(req, {
      cliente: {
        ...cliente,
        analytics_enabled: analytics_enabled !== false,
        reports_enabled: reports_enabled !== false,
        crm_enabled: crm_enabled === true,
      },
    })
  } catch (e) {
    console.error('[admin-upsert-cliente-central] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
