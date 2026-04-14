/**
 * Helper centralizado para chamadas às Supabase Edge Functions.
 * Garante que os headers `apikey` e `Authorization` estejam SEMPRE presentes.
 *
 * Uso:
 *   import { efCall, efHeaders } from '@/lib/api'
 *
 *   // Forma simples (com session_token automático):
 *   const data = await efCall('login', { username, password, role })
 *
 *   // Se precisar dos headers pra montar a request manualmente:
 *   fetch(url, { method: 'POST', headers: efHeaders(), body: ... })
 */
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'

/** Headers padrão para qualquer chamada a Edge Functions */
export function efHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': ANON,
    'Authorization': `Bearer ${ANON}`,
  }
}

/**
 * Chama uma Supabase Edge Function pelo nome.
 * Adiciona session_token automaticamente se o usuário estiver logado.
 *
 * @param fn - Nome da Edge Function (ex: 'login', 'crm-manage-pipeline')
 * @param body - Payload da request (session_token é adicionado automaticamente se existir)
 * @param options - { skipSession: true } para NÃO incluir session_token (ex: login)
 */
export async function efCall(
  fn: string,
  body: Record<string, unknown> = {},
  options?: { skipSession?: boolean }
): Promise<Record<string, unknown>> {
  const payload = { ...body }

  if (!options?.skipSession) {
    const session = getSession()
    if (session?.session && !payload.session_token) {
      payload.session_token = session.session
    }
  }

  try {
    const res = await fetch(`${SURL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify(payload),
    })
    return await res.json()
  } catch (e) {
    console.error(`[efCall:${fn}]`, e)
    return { error: 'Erro de conexão.' }
  }
}
