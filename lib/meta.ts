import { SURL } from './constants'
import { getSession } from './auth'
import { efHeaders } from './api'

export async function metaCall(
  endpoint: string,
  params: Record<string, string> = {},
  accountId?: string | null
) {
  const sess = getSession()
  if (!sess) throw new Error('Sessão expirada')

  const res = await fetch(`${SURL}/functions/v1/meta-proxy`, {
    method: 'POST',
    headers: efHeaders(),
    body: JSON.stringify({
      session_token: sess.session,
      endpoint,
      params,
      account_id: accountId || null,
    }),
  })

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      if (typeof window !== 'undefined') {
        const { clearSession } = await import('./auth')
        clearSession()
        window.location.href = '/login'
      }
    }

    const e = await res.json().catch(() => ({}))
    const errObj = e.error || e
    const msg =
      typeof errObj === 'string'
        ? errObj
        : errObj.message || errObj.error_user_msg || JSON.stringify(errObj)
    throw new Error(`HTTP ${res.status}: ${msg}`)
  }

  return res.json()
}
