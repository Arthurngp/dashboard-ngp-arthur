import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

type GoogleAdsCampaign = {
  resourceName?: string
  campaign?: { id?: string; name?: string; status?: string }
  metrics?: {
    costMicros?: string
    impressions?: string
    clicks?: string
    conversions?: string
    ctr?: string
    averageCpc?: string
    costPerConversion?: string
    conversionRate?: string
  }
}

function getCustomerId(raw?: string | null) {
  const fallback = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID')
  return String(raw || fallback || '').replace(/-/g, '').trim()
}

async function refreshAccessToken() {
  const clientId = Deno.env.get('GOOGLE_ADS_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Ads OAuth não configurado.')
  }

  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('refresh_token', refreshToken)
  body.set('grant_type', 'refresh_token')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  })

  const data = await res.json()
  if (!res.ok || data?.error) {
    throw new Error(data?.error_description || data?.error || 'Falha ao renovar token do Google Ads.')
  }

  return String(data.access_token || '')
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const { session_token, customer_id, query = 'summary', date_range = 'LAST_30_DAYS' } = body || {}

    if (!session_token) {
      return json(req, { error: 'Sessão inválida.' }, 401)
    }

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) {
      return json(req, { error: 'Sessão expirada.' }, 401)
    }

    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single()

    if (!usuario || (usuario.role !== 'ngp' && usuario.role !== 'admin')) {
      return json(req, { error: 'Acesso negado.' }, 403)
    }

    const developerToken = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')
    if (!developerToken) {
      return json(req, { error: 'Google Ads não configurado no servidor.' }, 503)
    }

    const resolvedCustomerId = getCustomerId(customer_id)
    if (!resolvedCustomerId) {
      return json(req, { error: 'Customer ID não configurado.' }, 400)
    }

    const accessToken = await refreshAccessToken()
    const apiVersion = Deno.env.get('GOOGLE_ADS_API_VERSION') || 'v18'
    const loginCustomerId = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')

    const gaql = query === 'campaigns'
      ? `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_per_conversion,
          metrics.conversion_rate
        FROM campaign
        WHERE segments.date DURING ${date_range}
        ORDER BY metrics.cost_micros DESC
      `
      : `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_per_conversion,
          metrics.conversion_rate
        FROM campaign
        WHERE segments.date DURING ${date_range}
        ORDER BY metrics.cost_micros DESC
      `

    const url = `https://googleads.googleapis.com/${apiVersion}/customers/${resolvedCustomerId}/googleAds:search`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }

    if (loginCustomerId) {
      headers['login-customer-id'] = String(loginCustomerId).replace(/-/g, '')
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: gaql }),
      signal: AbortSignal.timeout(20000),
    })

    const data = await res.json()
    if (!res.ok || data?.error) {
      console.error('[google-ads-campaigns] API error:', JSON.stringify(data?.error || data))
      return json(req, {
        error: data?.error?.message || 'Erro ao consultar Google Ads.',
        google_error: data?.error || data,
      }, res.status || 502)
    }

    const campaigns: GoogleAdsCampaign[] = Array.isArray(data.results) ? data.results : []

    return json(req, {
      customer_id: resolvedCustomerId,
      date_range,
      campaigns: campaigns.map((row) => ({
        id: row.campaign?.id || '',
        name: row.campaign?.name || '',
        status: row.campaign?.status || '',
        spend: Number(row.metrics?.costMicros || 0) / 1_000_000,
        impressions: Number(row.metrics?.impressions || 0),
        clicks: Number(row.metrics?.clicks || 0),
        conversions: Number(row.metrics?.conversions || 0),
        ctr: Number(row.metrics?.ctr || 0),
        avg_cpc: Number(row.metrics?.averageCpc || 0) / 1_000_000,
        cpa: Number(row.metrics?.costPerConversion || 0) / 1_000_000,
        conversion_rate: Number(row.metrics?.conversionRate || 0),
      })),
    })
  } catch (e) {
    console.error('[google-ads-campaigns] Error:', e)
    return json(req, { error: e instanceof Error ? e.message : 'Erro interno.' }, 500)
  }
})
