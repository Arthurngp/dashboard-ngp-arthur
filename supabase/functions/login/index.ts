import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts"
import { handleCors, json } from "../_shared/cors.ts"

const loginRolesFor = (tab: string): string[] => tab === 'ngp' ? ['ngp', 'admin'] : [tab]

const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 5 * 60 * 1000

function checkRate(ip: string): boolean {
  const now = Date.now()
  const e = attempts.get(ip)
  if (!e || now > e.resetAt) { attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return true }
  e.count++
  return e.count <= MAX_ATTEMPTS
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, e] of attempts) if (now > e.resetAt) attempts.delete(ip)
}, 10 * 60 * 1000)

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip') || 'unknown'

    if (!checkRate(ip)) return json(req, { error: 'Muitas tentativas. Aguarde 5 minutos.' }, 429)

    const { username, password, role } = await req.json()
    if (!username || !password || !role) return json(req, { error: 'Parâmetros inválidos.' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const allowedRoles = loginRolesFor(role)
    console.log(`[login] Tentativa: username="${username}" role="${role}" allowedRoles=${JSON.stringify(allowedRoles)}`)

    const { data: usuario, error: usuarioError } = await sb
      .from('usuarios')
      .select('id, username, nome, password_hash, role, meta_account_id, ativo, foto_url')
      .eq('username', username.toLowerCase().trim())
      .in('role', allowedRoles)
      .maybeSingle()

    console.log(`[login] DB result: found=${!!usuario} error=${JSON.stringify(usuarioError)} ativo=${usuario?.ativo}`)

    if (usuarioError) {
      console.error('[login] DB error:', usuarioError)
      return json(req, { error: 'Erro interno ao buscar usuário.' }, 500)
    }

    if (!usuario) {
      console.log(`[login] Usuário não encontrado: username="${username}" roles=${JSON.stringify(allowedRoles)}`)
      return json(req, { error: 'Usuário ou senha incorretos.' }, 401)
    }

    if (usuario.ativo === false) {
      console.log(`[login] Usuário inativo: ${username}`)
      return json(req, { error: 'Usuário desativado.' }, 401)
    }

    // Validar senha
    let passwordValid = false
    const storedHash = usuario.password_hash || ''
    console.log(`[login] Hash tipo: starts_with_$2=${storedHash.startsWith('$2')} hash_length=${storedHash.length}`)

    if (storedHash.startsWith('$2')) {
      passwordValid = await bcrypt.compare(password, storedHash)
    } else {
      passwordValid = storedHash === password
      if (passwordValid) {
        const newHash = await bcrypt.hash(password)
        await sb.from('usuarios').update({ password_hash: newHash }).eq('id', usuario.id)
        console.log(`[login] Senha migrada para bcrypt: ${username}`)
      }
    }

    console.log(`[login] Senha válida: ${passwordValid}`)

    if (!passwordValid) return json(req, { error: 'Usuário ou senha incorretos.' }, 401)

    attempts.delete(ip)

    const sessionToken = crypto.getRandomValues(new Uint8Array(32))
      .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()

    const { error: sessionError } = await sb.from('sessions').insert({
      token: sessionToken,
      usuario_id: usuario.id,
      expires_at: expiresAt,
    })

    if (sessionError) {
      console.error('[login] Session error:', sessionError)
      return json(req, { error: 'Erro ao criar sessão.' }, 500)
    }

    console.log(`[login] Login OK: ${username} (${usuario.role})`)

    return json(req, {
      session_token: sessionToken,
      user: {
        nome:            usuario.nome,
        username:        usuario.username,
        role:            usuario.role,
        meta_account_id: usuario.meta_account_id || undefined,
        foto_url:        usuario.foto_url || undefined,
      },
      expires_at: expiresAt,
    })

  } catch (e) {
    console.error('[login] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
