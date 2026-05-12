import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession } from "../_shared/roles.ts"

const PBKDF2_ITERATIONS = 100_000

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('pbkdf2:')) {
    const parts = hash.split(':')
    if (parts.length !== 3) return false
    const saltHex = parts[1]
    const storedHash = parts[2]
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
    const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256)
    const derivedHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('')
    return derivedHex === storedHash
  }
  // legacy SHA-256 plaintext
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return hex === hash
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, password } = await req.json()
    if (!session_token || !password) return json(req, { error: 'Dados inválidos.' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)

    const { data: usuario } = await sb
      .from('usuarios')
      .select('password_hash, acesso_financeiro, ativo')
      .eq('id', user.usuario_id)
      .single()

    if (!usuario || !usuario.ativo) return json(req, { error: 'Usuário não encontrado.' }, 404)
    if (!usuario.acesso_financeiro) return json(req, { error: 'Acesso não autorizado.' }, 403)

    const ok = await verifyPassword(password, usuario.password_hash)
    if (!ok) return json(req, { error: 'Senha incorreta.' }, 401)

    return json(req, { ok: true })

  } catch (e) {
    console.error('[financeiro-auth]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
