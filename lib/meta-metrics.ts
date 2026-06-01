// Decisão registrada em [[01-Arquitetura/ADR-002-attribution-window-canonica]]:
// Toda chamada Meta `insights` declara explicitamente a janela de atribuição
// 7d_click + 1d_view (default histórico Meta). Sem isso, a Meta aplica o default
// da conta de anúncio (varia conta-a-conta) e os números do NGP Space ficam
// inconsistentes com o Gerenciador da Meta. Espalhe `META_INSIGHTS_DEFAULTS`
// no início do objeto de params (antes de ...dp e outros spreads do caller).
export const META_INSIGHTS_DEFAULTS: Record<string, string> = {
  action_attribution_windows: '["7d_click","1d_view"]',
}

// Action keys candidatos por tipo de campanha (cobre variações Pixel/CAPI/onsite).
// As keys ficam em ordem de preferência (mais agregado/deduplicado primeiro).
export const ACTION_KEYS: Record<string, string[]> = {
  VENDAS: ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'offline_conversion.purchase'],
  LEADS: ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
  MENSAGENS: ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply'],
  TRÁFEGO: ['link_click'],
  ENGAJAMENTO: ['post_engagement'],
  RECONHECIMENTO: [],
}

// Resolve o valor de uma única "categoria" de evento (compras, leads, mensagens, etc.).
// CRÍTICO: a Meta retorna o MESMO evento com vários action_types (omni_purchase,
// offsite_conversion.fb_pixel_purchase, purchase). Somar todos infla o número.
// Estratégia: usa o PRIMEIRO action_type da lista de keys que existir nos actions.
export function sumActions(actions: any[], keys: string[]): number {
  if (!actions || !actions.length || !keys.length) return 0
  const byType: Record<string, number> = {}
  for (const a of actions) {
    if (a?.action_type) byType[a.action_type] = +a.value || 0
  }
  for (const k of keys) {
    if (byType[k] !== undefined) return byType[k]
  }
  // Fallback: alguns events vêm como "ns_X.key" (raros) — tenta match por sufixo
  for (const k of keys) {
    for (const type of Object.keys(byType)) {
      if (type.endsWith('.' + k)) return byType[type]
    }
  }
  return 0
}

export const GENDER_NAMES: Record<string, string> = {
  female: 'Feminino',
  male: 'Masculino',
  unknown: 'Não informado',
}

export type MetricFormat = 'currency' | 'integer' | 'percent' | 'compact' | 'ratio'

export interface MetaMetricDef {
  id: string
  label: string
  section: string
  format: MetricFormat
  isAction?: boolean
  actionType?: string
  apiField?: string // if not isAction, what field to ask for in Meta API (defaults to id)
  lowerIsBetter?: boolean
  description?: string
}

export const META_METRICS: MetaMetricDef[] = [
  // Financeiro
  { id: 'spend', label: 'Investido', section: '💰 Financeiro', format: 'currency', apiField: 'spend' },
  { id: 'revenue', label: 'Receita', section: '💰 Financeiro', format: 'currency', isAction: true, actionType: 'purchase_value' }, // We'll parse this specifically
  { id: 'roas', label: 'ROAS', section: '💰 Financeiro', format: 'ratio', apiField: 'purchase_roas' },
  { id: 'cpm', label: 'CPM (Custo por mil impressões)', section: '💰 Financeiro', format: 'currency', apiField: 'cpm', lowerIsBetter: true },
  { id: 'cpc', label: 'CPC (Custo por clique no link)', section: '💰 Financeiro', format: 'currency', apiField: 'cpc', lowerIsBetter: true },
  
  // Alcance e Impressões
  { id: 'impressions', label: 'Impressões', section: '📣 Alcance e Entrega', format: 'compact', apiField: 'impressions' },
  { id: 'reach', label: 'Alcance', section: '📣 Alcance e Entrega', format: 'compact', apiField: 'reach' },
  { id: 'frequency', label: 'Frequência', section: '📣 Alcance e Entrega', format: 'ratio', apiField: 'frequency' },
  { id: 'clicks', label: 'Cliques (Todos)', section: '📣 Alcance e Entrega', format: 'integer', apiField: 'clicks' },
  { id: 'ctr', label: 'CTR (Todos)', section: '📣 Alcance e Entrega', format: 'percent', apiField: 'ctr' },
  { id: 'inline_link_clicks', label: 'Cliques no Link', section: '📣 Alcance e Entrega', format: 'integer', apiField: 'inline_link_clicks' },
  { id: 'inline_link_click_ctr', label: 'CTR (Cliques no Link)', section: '📣 Alcance e Entrega', format: 'percent', apiField: 'inline_link_click_ctr' },

  // Engajamento e Vídeo
  { id: 'post_engagement', label: 'Engajamento com a Página/Publicação', section: '❤️ Engajamento', format: 'integer', isAction: true, actionType: 'post_engagement' },
  { id: 'page_engagement', label: 'Engajamento com a Página', section: '❤️ Engajamento', format: 'integer', isAction: true, actionType: 'page_engagement' },
  { id: 'video_view', label: 'Visualizações de Vídeo (3s)', section: '❤️ Engajamento', format: 'compact', isAction: true, actionType: 'video_view' },
  { id: 'video_p50_watched_actions', label: 'Visualizações de Vídeo (50%)', section: '❤️ Engajamento', format: 'compact', isAction: true, actionType: 'video_p50_watched_actions' },
  { id: 'video_p100_watched_actions', label: 'Visualizações de Vídeo (100%)', section: '❤️ Engajamento', format: 'compact', isAction: true, actionType: 'video_p100_watched_actions' },

  // Conversões (Funil Padrão)
  { id: 'view_content', label: 'Visualização de Conteúdo (Site)', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'view_content' },
  { id: 'add_to_cart', label: 'Adições ao Carrinho', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'add_to_cart' },
  { id: 'initiate_checkout', label: 'Finalizações de Compra Iniciadas', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'initiate_checkout' },
  { id: 'purchases', label: 'Compras', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'purchase' },
  { id: 'leads', label: 'Leads (Cadastros)', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'lead' },
  { id: 'conversations', label: 'Conversas Iniciadas', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'messaging_conversation_started_7d' }, // Meta uses messaging_conversation_started_7d or onsit_conversion.messaging_conversation_started_7d
  { id: 'contacts', label: 'Contatos', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'contact' },
  { id: 'search', label: 'Pesquisas no Site', section: '🎯 Conversões', format: 'integer', isAction: true, actionType: 'search' },
  
  // Custos por Conversão
  { id: 'cost_per_view_content', label: 'Custo por Visualização de Conteúdo', section: '📉 Custos de Ação', format: 'currency', lowerIsBetter: true },
  { id: 'cost_per_add_to_cart', label: 'Custo por Adição ao Carrinho', section: '📉 Custos de Ação', format: 'currency', lowerIsBetter: true },
  { id: 'cost_per_checkout', label: 'Custo por Finalização de Compra', section: '📉 Custos de Ação', format: 'currency', lowerIsBetter: true },
  { id: 'cost_per_purchase', label: 'Custo por Compra (CPA)', section: '📉 Custos de Ação', format: 'currency', lowerIsBetter: true },
  { id: 'cost_per_lead', label: 'Custo por Lead (CPL)', section: '📉 Custos de Ação', format: 'currency', lowerIsBetter: true },
  { id: 'cost_per_conversation', label: 'Custo por Conversa', section: '📉 Custos de Ação', format: 'currency', lowerIsBetter: true },
]

export const DEFAULT_METRICS = [
  'spend', 'revenue', 'roas', 'cpc', 'cpm',
  'conversations', 'leads', 'purchases', 'cost_per_lead', 'cost_per_purchase',
  'impressions', 'clicks', 'ctr', 'reach', 'frequency'
]

export function getRequiredApiFields(metricIds: string[]): string[] {
  const fields = new Set<string>()
  // Basic fields we always want to fetch because other systems might depend on them internally
  fields.add('spend')
  fields.add('impressions')
  fields.add('clicks')

  let needsActions = false
  let needsActionValues = false

  metricIds.forEach(id => {
    const def = META_METRICS.find(m => m.id === id)
    if (!def) return

    if (def.isAction) {
      needsActions = true
      if (def.actionType === 'purchase_value' || def.actionType === 'purchase') {
        needsActionValues = true
      }
    } else if (def.apiField) {
      fields.add(def.apiField)
    }

    // Dependency logic for derived cost metrics
    if (id.startsWith('cost_per_')) {
      needsActions = true
      fields.add('spend') // cost needs spend
    }
    if (id === 'roas') {
      fields.add('purchase_roas')
      needsActionValues = true
    }
  })

  if (needsActions) fields.add('actions')
  if (needsActionValues) fields.add('action_values')

  // Always request campaigns specific basic id/name if it's on campaign level
  // fields.add('campaign_id')
  // fields.add('campaign_name')
  // We don't add them here, the caller handles basic object ids.

  return Array.from(fields)
}
