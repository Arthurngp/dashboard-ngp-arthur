import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
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

// ── PBKDF2 seguro (nativo do Web Crypto, com salt) ──────────────────────────
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
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('')
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${saltHex}:${hashHex}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, expectedHash] = stored.split(':')
  if (!saltHex || !expectedHash) return false
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  )
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex === expectedHash
}

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

    const { data: usuario, error: usuarioError } = await sb
      .from('usuarios')
      .select('id, username, nome, password_hash, role, meta_account_id, ativo, foto_url')
      .eq('username', username.toLowerCase().trim())
      .in('role', allowedRoles)
      .maybeSingle()

    if (usuarioError) {
      console.error('[login] DB error:', usuarioError)
      return json(req, { error: 'Erro interno.' }, 500)
    }

    if (!usuario) return json(req, { error: 'Usuário ou senha incorretos.' }, 401)
    if (usuario.ativo === false) return json(req, { error: 'Usuário desativado.' }, 401)

    const storedHash = usuario.password_hash || ''
    let passwordValid = false

    if (storedHash.startsWith('pbkdf2:')) {
      // Senha segura com PBKDF2 + salt
      passwordValid = await verifyPassword(password, storedHash)
    } else if (storedHash.startsWith('sha256:')) {
      // Legado SHA-256 (sem salt) — verifica e migra para PBKDF2
      const data = new TextEncoder().encode(password)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const hashed = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
      passwordValid = storedHash === `sha256:${hashed}`
      if (passwordValid) {
        const newHash = await hashPassword(password)
        await sb.from('usuarios').update({ password_hash: newHash }).eq('id', usuario.id)
        console.log(`[login] Senha migrada de sha256 para PBKDF2: ${username}`)
      }
    } else {
      // Legado: plain text — compara e migra para PBKDF2
      passwordValid = storedHash === password
      if (passwordValid) {
        const newHash = await hashPassword(password)
        await sb.from('usuarios').update({ password_hash: newHash }).eq('id', usuario.id)
        console.log(`[login] Senha migrada para PBKDF2: ${username}`)
      }
    }

    if (!passwordValid) return json(req, { error: 'Usuário ou senha incorretos.' }, 401)

    attempts.delete(ip)

    const sessionToken = crypto.getRandomValues(new Uint8Array(32))
      .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()

    const { error: sessionError } = await sb.from('sessions').insert({
      token: sessionToken,
      usuario_id: usuario.id,
      expires_at: expiresAt,
      last_activity: new Date().toISOString(),
    })

    if (sessionError) {
      console.error('[login] Session error:', sessionError)
      return json(req, { error: 'Erro ao criar sessão.' }, 500)
    }

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
