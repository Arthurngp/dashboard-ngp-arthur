import { SURL } from './constants'
import { getSession } from './auth'
import { efHeaders } from './api'

export async function googleAdsCall(
  customerId?: string | null,
  query: 'summary' | 'campaigns' = 'campaigns',
  dateRange: string = 'LAST_30_DAYS'
) {
  const sess = getSession()
  if (!sess) throw new Error('Sessão expirada')

  const res = await fetch(`${SURL}/functions/v1/google-ads-campaigns`, {
    method: 'POST',
    headers: efHeaders(),
    body: JSON.stringify({
      session_token: sess.session,
      customer_id: customerId || null,
      query,
      date_range: dateRange,
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
