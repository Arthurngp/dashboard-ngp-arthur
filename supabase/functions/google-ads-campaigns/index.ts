import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"

function getCustomerId(raw?: string | null) {
  return String(raw || '').replace(/-/g, '').trim()
}

async function refreshAccessToken() {
  const clientId = Deno.env.get('GOOGLE_ADS_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Google Ads OAuth nao configurado.')
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
  if (!res.ok || data?.error) throw new Error(data?.error_description || data?.error || 'Falha ao renovar token.')
  return String(data.access_token || '')
}

// Executa uma query GAQL contra a Google Ads API.
async function gaqlSearch(opts: {
  accessToken: string
  developerToken: string
  apiVersion: string
  customerId: string
  loginCustomerId?: string | null
  query: string
}) {
  const url = `https://googleads.googleapis.com/${opts.apiVersion}/customers/${opts.customerId}/googleAds:search`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${opts.accessToken}`,
    'developer-token': opts.developerToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  if (opts.loginCustomerId) headers['login-customer-id'] = String(opts.loginCustomerId).replace(/-/g, '')
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: opts.query }),
    signal: AbortSignal.timeout(25000),
  })
  const rawText = await r.text()
  let data: any
  try { data = JSON.parse(rawText) } catch { data = { _raw_preview: rawText.slice(0, 300) } }
  return { ok: r.ok, status: r.status, data }
}

// Helper: micros → BRL real (1_000_000 micros = 1 unidade)
const fromMicros = (v: any) => Number(v || 0) / 1_000_000

// ─── Date clause builder ───────────────────────────────────────────────────
// Aceita 2 formatos de `date_range`:
//   - string preset: 'LAST_30_DAYS', 'THIS_MONTH', etc → DURING <preset>
//   - objeto custom: { since: 'YYYY-MM-DD', until: 'YYYY-MM-DD' } → BETWEEN '...' AND '...'
// Sanitização: regex valida o formato ISO YYYY-MM-DD pra prevenir SQL injection
// no GAQL (`'` em strings GAQL é literal; nosso regex bloqueia qualquer outro char).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PRESET_RE = /^[A-Z_]{1,32}$/  // GAQL aceita só letras maiúsculas e underscore
function dateClause(date_range: unknown): string {
  if (typeof date_range === 'string' && PRESET_RE.test(date_range)) {
    return `DURING ${date_range}`
  }
  if (date_range && typeof date_range === 'object') {
    const obj = date_range as { since?: unknown; until?: unknown }
    const since = String(obj.since || '')
    const until = String(obj.until || '')
    if (ISO_DATE.test(since) && ISO_DATE.test(until)) {
      return `BETWEEN '${since}' AND '${until}'`
    }
  }
  return `DURING LAST_30_DAYS`  // fallback seguro
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const { session_token, customer_id, query = 'summary', date_range = 'LAST_30_DAYS' } = body || {}
    if (!session_token) return json(req, { error: 'Sessao invalida.' }, 401)

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    const { data: sessao } = await sb.from('sessions').select('usuario_id').eq('token', session_token).gt('expires_at', new Date().toISOString()).single()
    if (!sessao) return json(req, { error: 'Sessao expirada.' }, 401)

    const { data: usuario } = await sb.from('usuarios').select('role').eq('id', sessao.usuario_id).single()
    if (!usuario || (usuario.role !== 'ngp' && usuario.role !== 'admin')) return json(req, { error: 'Acesso negado.' }, 403)

    const developerToken = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')
    if (!developerToken) return json(req, { error: 'Google Ads nao configurado no servidor.' }, 503)

    if (query === 'health_check') {
      const checks = {
        client_id: !!Deno.env.get('GOOGLE_ADS_CLIENT_ID'),
        client_secret: !!Deno.env.get('GOOGLE_ADS_CLIENT_SECRET'),
        refresh_token: !!Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN'),
        developer_token: !!developerToken,
        login_customer_id: !!Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
      }
      const allSet = Object.values(checks).every(Boolean)
      if (!allSet) return json(req, { ok: false, step: 'secrets', secrets_present: checks }, 200)
      try {
        const accessToken = await refreshAccessToken()
        return json(req, { ok: true, step: 'oauth_ok', secrets_present: checks, access_token_preview: accessToken.slice(0, 12) + '...', login_customer_id: Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') }, 200)
      } catch (e) {
        return json(req, { ok: false, step: 'oauth_failed', secrets_present: checks, error: e instanceof Error ? e.message : 'OAuth refresh falhou.' }, 200)
      }
    }

    const apiVersion = Deno.env.get('GOOGLE_ADS_API_VERSION') || 'v22'
    const loginCustomerId = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')

    if (query === 'list_mcc_accounts') {
      try {
        const accessToken = await refreshAccessToken()
        const mccId = String(loginCustomerId || '').replace(/-/g, '')
        if (!mccId) return json(req, { error: 'LOGIN_CUSTOMER_ID nao configurado.' }, 503)
        const gaqlMcc = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.status = 'ENABLED'`
        const r = await gaqlSearch({ accessToken, developerToken, apiVersion, customerId: mccId, loginCustomerId: mccId, query: gaqlMcc })
        if (!r.ok || r.data?.error) return json(req, { ok: false, status: r.status, google_error: r.data?.error || r.data }, 200)
        const results = Array.isArray(r.data.results) ? r.data.results : []
        const accounts = results.map((row: any) => ({
          id: String(row?.customerClient?.id || ''),
          name: String(row?.customerClient?.descriptiveName || ''),
          currency: String(row?.customerClient?.currencyCode || ''),
          timezone: String(row?.customerClient?.timeZone || ''),
          manager: row?.customerClient?.manager === true,
          level: Number(row?.customerClient?.level || 0),
        }))
        return json(req, {
          ok: true,
          api_version_used: apiVersion,
          mcc_id: mccId,
          total_returned: accounts.length,
          accounts: accounts.filter((a: any) => !a.manager),
          managers_excluded: accounts.filter((a: any) => a.manager).length,
        })
      } catch (e) {
        return json(req, { ok: false, step: 'list_mcc_accounts_failed', error: e instanceof Error ? e.message : String(e) }, 200)
      }
    }

    const resolvedCustomerId = getCustomerId(customer_id)
    if (!resolvedCustomerId) return json(req, { error: 'Customer ID nao configurado.' }, 400)

    const accessToken = await refreshAccessToken()
    const baseSearch = (q: string) => gaqlSearch({
      accessToken,
      developerToken,
      apiVersion,
      customerId: resolvedCustomerId,
      loginCustomerId,
      query: q,
    })

    // ─── CAMPAIGNS (default) ─────────────────────────────────────────────────
    if (query === 'campaigns' || query === 'summary') {
      const gaql = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion, metrics.conversions_from_interactions_rate FROM campaign WHERE segments.date ${dateClause(date_range)} ORDER BY metrics.cost_micros DESC`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { error: r.data?.error?.message || 'Erro Google Ads.', google_error: r.data?.error || r.data }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      const totals = rows.reduce((acc: any, row: any) => {
        acc.spend += fromMicros(row.metrics?.costMicros)
        acc.impressions += Number(row.metrics?.impressions || 0)
        acc.clicks += Number(row.metrics?.clicks || 0)
        acc.conversions += Number(row.metrics?.conversions || 0)
        // conversions_value já vem em unidade da moeda (não micros) na Google Ads API.
        acc.conversion_value += Number(row.metrics?.conversionsValue || 0)
        return acc
      }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 })
      totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0
      totals.avg_cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0
      totals.cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0
      totals.conversion_rate = totals.clicks > 0 ? totals.conversions / totals.clicks : 0
      // ROAS sobre os TOTAIS (receita_total / gasto_total), não média de ROAS por campanha.
      totals.roas = totals.spend > 0 ? totals.conversion_value / totals.spend : 0

      // Detecta tipo de campanhas (Pmax x Search/Display) pra UI saber o que mostrar
      const channelTypes = new Set<string>()
      for (const row of rows) {
        if (row.metrics?.impressions > 0) {
          channelTypes.add(String(row.campaign?.advertisingChannelType || 'UNKNOWN'))
        }
      }

      return json(req, {
        api_version_used: apiVersion,
        customer_id: resolvedCustomerId,
        date_range,
        summary: totals,
        channel_types_active: Array.from(channelTypes),
        has_pmax: channelTypes.has('PERFORMANCE_MAX'),
        has_search: channelTypes.has('SEARCH'),
        has_display: channelTypes.has('DISPLAY'),
        campaigns: rows.map((row: any) => {
          const spend = fromMicros(row.metrics?.costMicros)
          const conversionValue = Number(row.metrics?.conversionsValue || 0)
          return {
            id: row.campaign?.id || '',
            name: row.campaign?.name || '',
            status: row.campaign?.status || '',
            channel_type: row.campaign?.advertisingChannelType || '',
            spend,
            impressions: Number(row.metrics?.impressions || 0),
            clicks: Number(row.metrics?.clicks || 0),
            conversions: Number(row.metrics?.conversions || 0),
            conversion_value: conversionValue,
            ctr: Number(row.metrics?.ctr || 0),
            avg_cpc: fromMicros(row.metrics?.averageCpc),
            cpa: fromMicros(row.metrics?.costPerConversion),
            roas: spend > 0 ? conversionValue / spend : 0,
            conversion_rate: Number(row.metrics?.conversionsFromInteractionsRate || 0),
          }
        }),
      })
    }

    // ─── SEARCH TERMS (termos buscados — só Search/Display) ──────────────────
    if (query === 'search_terms') {
      const gaql = `SELECT search_term_view.search_term, search_term_view.status, segments.search_term_match_type, campaign.name, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM search_term_view WHERE segments.date ${dateClause(date_range)} ORDER BY metrics.cost_micros DESC LIMIT 100`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) {
        return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, search_terms: [] }, 200)
      }
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        search_terms: rows.map((row: any) => ({
          term: String(row?.searchTermView?.searchTerm || ''),
          status: String(row?.searchTermView?.status || ''),
          match_type: String(row?.segments?.searchTermMatchType || ''),
          campaign: String(row?.campaign?.name || ''),
          ad_group: String(row?.adGroup?.name || ''),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
          ctr: Number(row?.metrics?.ctr || 0),
          avg_cpc: fromMicros(row?.metrics?.averageCpc),
        })),
      })
    }

    // ─── KEYWORDS (palavras-chave Search) ────────────────────────────────────
    if (query === 'keywords') {
      const gaql = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, campaign.name, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM keyword_view WHERE segments.date ${dateClause(date_range)} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT 100`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, keywords: [] }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        keywords: rows.map((row: any) => ({
          text: String(row?.adGroupCriterion?.keyword?.text || ''),
          match_type: String(row?.adGroupCriterion?.keyword?.matchType || ''),
          quality_score: Number(row?.adGroupCriterion?.qualityInfo?.qualityScore || 0),
          campaign: String(row?.campaign?.name || ''),
          ad_group: String(row?.adGroup?.name || ''),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
          ctr: Number(row?.metrics?.ctr || 0),
          avg_cpc: fromMicros(row?.metrics?.averageCpc),
        })),
      })
    }

    // ─── DEVICES (mobile / desktop / tablet) ─────────────────────────────────
    if (query === 'devices') {
      const gaql = `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion FROM customer WHERE segments.date ${dateClause(date_range)}`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, devices: [] }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        devices: rows.map((row: any) => ({
          device: String(row?.segments?.device || 'UNKNOWN'),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
          ctr: Number(row?.metrics?.ctr || 0),
          avg_cpc: fromMicros(row?.metrics?.averageCpc),
          cpa: fromMicros(row?.metrics?.costPerConversion),
        })),
      })
    }

    // ─── LOCATIONS (cidades / regiões) ───────────────────────────────────────
    if (query === 'locations') {
      const gaql = `SELECT geographic_view.country_criterion_id, geographic_view.location_type, segments.geo_target_city, segments.geo_target_region, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM geographic_view WHERE segments.date ${dateClause(date_range)} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT 50`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, locations: [] }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        locations: rows.map((row: any) => ({
          city_id: String(row?.segments?.geoTargetCity || ''),
          region_id: String(row?.segments?.geoTargetRegion || ''),
          location_type: String(row?.geographicView?.locationType || ''),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
        })),
      })
    }

    // ─── HOURLY (dia da semana × hora) ───────────────────────────────────────
    if (query === 'hourly') {
      const gaql = `SELECT segments.day_of_week, segments.hour, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date ${dateClause(date_range)}`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, hourly: [] }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        hourly: rows.map((row: any) => ({
          day_of_week: String(row?.segments?.dayOfWeek || ''),
          hour: Number(row?.segments?.hour || 0),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
        })),
      })
    }

    // ─── DEMOGRAPHICS (idade + gênero) ───────────────────────────────────────
    if (query === 'demographics') {
      const ageGaql = `SELECT ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM age_range_view WHERE segments.date ${dateClause(date_range)}`
      const genderGaql = `SELECT ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM gender_view WHERE segments.date ${dateClause(date_range)}`
      const [ageRes, genderRes] = await Promise.all([baseSearch(ageGaql), baseSearch(genderGaql)])
      const ageRows = (ageRes.ok && Array.isArray(ageRes.data.results)) ? ageRes.data.results : []
      const genderRows = (genderRes.ok && Array.isArray(genderRes.data.results)) ? genderRes.data.results : []
      return json(req, {
        ok: true,
        age_groups: ageRows.map((row: any) => ({
          age_range: String(row?.adGroupCriterion?.ageRange?.type || 'UNDETERMINED'),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
        })),
        genders: genderRows.map((row: any) => ({
          gender: String(row?.adGroupCriterion?.gender?.type || 'UNDETERMINED'),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
        })),
      })
    }

    // ─── TOP ADS (anúncios) ──────────────────────────────────────────────────
    if (query === 'top_ads') {
      const gaql = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, campaign.name, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr FROM ad_group_ad WHERE segments.date ${dateClause(date_range)} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT 30`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, ads: [] }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        ads: rows.map((row: any) => ({
          id: String(row?.adGroupAd?.ad?.id || ''),
          name: String(row?.adGroupAd?.ad?.name || '(sem nome)'),
          type: String(row?.adGroupAd?.ad?.type || ''),
          status: String(row?.adGroupAd?.status || ''),
          campaign: String(row?.campaign?.name || ''),
          ad_group: String(row?.adGroup?.name || ''),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          spend: fromMicros(row?.metrics?.costMicros),
          conversions: Number(row?.metrics?.conversions || 0),
          ctr: Number(row?.metrics?.ctr || 0),
        })),
      })
    }

    // ─── DAILY (série temporal por dia) ──────────────────────────────────────
    if (query === 'daily') {
      const gaql = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date ${dateClause(date_range)} ORDER BY segments.date ASC`
      const r = await baseSearch(gaql)
      if (!r.ok || r.data?.error) return json(req, { ok: false, error: r.data?.error?.message, google_error: r.data?.error, daily: [] }, 200)
      const rows = Array.isArray(r.data.results) ? r.data.results : []
      return json(req, {
        ok: true,
        daily: rows.map((row: any) => ({
          date: String(row?.segments?.date || ''),
          spend: fromMicros(row?.metrics?.costMicros),
          impressions: Number(row?.metrics?.impressions || 0),
          clicks: Number(row?.metrics?.clicks || 0),
          conversions: Number(row?.metrics?.conversions || 0),
        })),
      })
    }

    return json(req, { error: `Query desconhecida: ${query}` }, 400)
  } catch (e) {
    console.error('[google-ads-campaigns] Error:', e)
    return json(req, { error: e instanceof Error ? e.message : 'Erro interno.' }, 500)
  }
})
