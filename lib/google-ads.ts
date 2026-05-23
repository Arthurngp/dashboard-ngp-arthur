import { SURL } from './constants'
import { getSession } from './auth'
import { efHeaders } from './api'

export type GoogleAdsQuery =
  | 'summary'
  | 'campaigns'
  | 'search_terms'
  | 'keywords'
  | 'devices'
  | 'locations'
  | 'hourly'
  | 'demographics'
  | 'top_ads'
  | 'daily'
  | 'list_mcc_accounts'
  | 'health_check'

/**
 * Período aceito pela API Google Ads:
 * - String preset: 'LAST_30_DAYS', 'THIS_MONTH', etc → vira DURING <preset>
 * - Objeto custom: { since: 'YYYY-MM-DD', until: 'YYYY-MM-DD' } → vira BETWEEN '...' AND '...'
 */
export type GoogleAdsDateRange = string | { since: string; until: string }

export async function googleAdsCall(
  customerId?: string | null,
  query: GoogleAdsQuery = 'campaigns',
  dateRange: GoogleAdsDateRange = 'LAST_30_DAYS'
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
