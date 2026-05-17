import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

const PBKDF2_ITERATIONS = 100_000

async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  if (!salt) {
    salt = crypto.getRandomValues(new Uint8Array(16))
  }
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  )
  const hashHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${saltHex}:${hashHex}`
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const {
      session_token,
      nome,
      username,
      email,
      password,
      role,
      meta_account_id,
      google_ads_customer_id,
      foto_url,
      cargo,
      funcao,
      senioridade,
      setor,
      data_entrada,
    } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!nome || !username || !email || !password || !role) {
      return json(req, { error: 'Campos obrigatórios: nome, username, email, password, role.' }, 400)
    }
    if (!['admin', 'ngp', 'cliente'].includes(role)) return json(req, { error: 'Role inválida.' }, 400)
    if (password.length < 6) return json(req, { error: 'A senha deve ter ao menos 6 caracteres.' }, 400)

    const sb   = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)

    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Acesso negado.' }, 403)

    const usernameClean = username.toLowerCase().trim()
    const emailClean    = email.toLowerCase().trim()
    const passwordHash = await hashPassword(password)

    // Google Ads customer_id: aceita "123-456-7890" ou "1234567890". Armazena sem hífens.
    const googleAdsClean = google_ads_customer_id
      ? String(google_ads_customer_id).trim().replace(/-/g, '')
      : null
    if (googleAdsClean && !/^\d{10}$/.test(googleAdsClean)) {
      return json(req, { error: 'Google Ads Customer ID inválido. Use 10 dígitos (ex: 123-456-7890).' }, 400)
    }

    // Verifica duplicidade de username
    const { data: existingUsername } = await sb
      .from('usuarios')
      .select('id')
      .eq('username', usernameClean)
      .maybeSingle()
    if (existingUsername) return json(req, { error: 'Esse username já está em uso.' }, 409)

    // Verifica duplicidade de email
    const { data: existingEmail } = await sb
      .from('usuarios')
      .select('id')
      .eq('email', emailClean)
      .maybeSingle()
    if (existingEmail) return json(req, { error: 'Esse email já está em uso.' }, 409)

    // Cria usuário no Supabase Auth
    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email: emailClean,
      password,
      email_confirm: true,
    })

    if (authError || !authData?.user) {
      console.error('[admin-criar-usuario] Auth error:', authError)
      return json(req, { error: authError?.message || 'Erro ao criar no sistema de autenticação.' }, 500)
    }

    // Cria registro na tabela usuarios
    const { data: novoUsuario, error: insertError } = await sb
      .from('usuarios')
      .insert({
        nome: nome.trim(),
        username: usernameClean,
        email: emailClean,
        role,
        ativo: true,
        auth_user_id: authData.user.id,
        meta_account_id: meta_account_id || null,
        google_ads_customer_id: googleAdsClean,
        foto_url: foto_url?.trim() || null,
        cargo: cargo?.trim() || null,
        funcao: funcao?.trim() || null,
        senioridade: senioridade?.trim() || null,
        setor: setor?.trim() || null,
        data_entrada: data_entrada || null,
        password_hash: passwordHash,
      })
      .select('id, nome, username, email, role, ativo, created_at, foto_url, cargo, funcao, senioridade, setor, data_entrada')
      .single()

    if (insertError) {
      await sb.auth.admin.deleteUser(authData.user.id)
      console.error('[admin-criar-usuario] Insert error:', insertError)
      return json(req, { error: 'Erro ao salvar usuário.' }, 500)
    }

    return json(req, { usuario: novoUsuario })

  } catch (e) {
    console.error('[admin-criar-usuario] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
