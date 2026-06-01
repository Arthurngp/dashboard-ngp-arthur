import { META_METRICS } from './meta-metrics'

export const fmt = (n: number, d = 2) =>
  Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtN = (n: number) => parseInt(String(n || 0)).toLocaleString('pt-BR')

export const fmtI = (n: number) => {
  n = parseInt(String(n || 0))
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n)
}

export const esc = (s: unknown) =>
  s == null
    ? ''
    : String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

export function parseIns(ins: Record<string, unknown>) {
  if (!ins) return null

  const actions = (ins.actions as { action_type: string; value: string }[]) || []
  const av = (ins.action_values as { action_type: string; value: string }[]) || []
  
  const spend = parseFloat(String(ins.spend || 0))
  // Receita (purchase_value): prioriza omni_purchase (deduplicado pela Meta) pra bater com gerenciador
  const purVal = parseFloat(
    av.find((a) => a.action_type === 'omni_purchase')?.value ||
    av.find((a) => a.action_type === 'purchase')?.value ||
    av.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value ||
    '0'
  )
  const roasArr = (ins.purchase_roas as { value: string }[]) || []
  let roas = roasArr.length ? parseFloat(roasArr[0].value) : 0
  if (!roas && purVal > 0 && spend > 0) roas = purVal / spend

  const parsed: Record<string, number> = {}

  // Extrair valores diretamente da API ou das Actions
  META_METRICS.forEach(metric => {
    let val = 0
    if (metric.isAction) {
      if (metric.actionType === 'purchase_value') {
        val = purVal
      } else {
        // Find action — prioriza variantes "omni_*" (deduplicadas pela Meta,
        // batem com o que aparece no Gerenciador de Anúncios).
        // Pra cada métrica, define uma lista de keys em ordem de preferência.
        let keysToTry: string[] = []
        if (metric.actionType === 'purchase') {
          keysToTry = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']
        } else if (metric.actionType === 'lead') {
          keysToTry = ['lead', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped']
        } else if (metric.actionType === 'messaging_conversation_started_7d') {
          keysToTry = ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection']
        } else if (metric.actionType) {
          keysToTry = [metric.actionType]
        }
        // Encontra o primeiro action_type que existir nos actions (não soma, pra evitar duplicação)
        let matched: { action_type: string; value: string } | undefined
        for (const k of keysToTry) {
          matched = actions.find(a => a.action_type === k)
          if (matched) break
        }
        // Fallback adicional: pra leads, alguns ad accounts retornam só por sufixo
        if (!matched && metric.actionType === 'lead') {
          matched = actions.find(a => a.action_type?.endsWith('.lead') || a.action_type?.includes('lead_grouped'))
        }
        if (!matched && metric.actionType === 'messaging_conversation_started_7d') {
          matched = actions.find(a => a.action_type?.includes('messaging_conversation_started') || a.action_type?.includes('total_messaging'))
        }
        val = parseFloat(matched?.value || '0')
      }
    } else if (metric.apiField) {
      if (metric.apiField === 'purchase_roas') {
        val = roas
      } else {
        val = parseFloat(String(ins[metric.apiField] || 0))
      }
    }
    parsed[metric.id] = val
  })

  // Calcular custos derivados
  const calcCost = (eventId: string) => {
    const evts = parsed[eventId] || 0
    return evts > 0 ? spend / evts : 0
  }

  parsed['cost_per_view_content'] = calcCost('view_content')
  parsed['cost_per_add_to_cart'] = calcCost('add_to_cart')
  parsed['cost_per_checkout'] = calcCost('initiate_checkout')
  parsed['cost_per_purchase'] = calcCost('purchases')
  parsed['cost_per_lead'] = calcCost('leads')
  parsed['cost_per_conversation'] = calcCost('conversations')

  // Maintain legacy compatibility for existing codebase
  return {
    ...parsed,
    spend,
    impressions: parsed.impressions || 0,
    clicks: parsed.clicks || 0,
    ctr: parsed.ctr || 0,
    cpc: parsed.cpc || 0,
    reach: parsed.reach || 0,
    conversations: parsed.conversations || 0,
    leads: parsed.leads || 0,
    purchases: parsed.purchases || 0,
    purchaseValue: purVal,
    roas: parseFloat(roas.toFixed(2)),
  }
}
