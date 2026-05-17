// Definições de tipos e helpers do Google Ads.

export interface GoogleAdsCampaign {
  id: string
  name: string
  status: string
  channel_type: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number
  avg_cpc: number
  cpa: number
  conversion_rate: number
}

export interface GoogleAdsSummary {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number
  avg_cpc: number
  cpa: number
  conversion_rate: number
}

export interface SearchTermRow {
  term: string
  status: string
  match_type: string
  campaign: string
  ad_group: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  avg_cpc: number
}

export interface KeywordRow {
  text: string
  match_type: string
  quality_score: number
  campaign: string
  ad_group: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  avg_cpc: number
}

export interface DeviceRow {
  device: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  avg_cpc: number
  cpa: number
}

export interface LocationRow {
  city_id: string
  region_id: string
  location_type: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
}

export interface HourlyRow {
  day_of_week: string
  hour: number
  impressions: number
  clicks: number
  spend: number
  conversions: number
}

export interface DemoRow {
  age_range?: string
  gender?: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
}

export interface AdRow {
  id: string
  name: string
  type: string
  status: string
  campaign: string
  ad_group: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
}

export interface DailyRow {
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

// Labels amigáveis pra códigos da API
export const DEVICE_LABELS: Record<string, string> = {
  MOBILE: '📱 Mobile',
  DESKTOP: '🖥️ Desktop',
  TABLET: '📱 Tablet',
  CONNECTED_TV: '📺 TV',
  OTHER: 'Outros',
  UNKNOWN: 'Desconhecido',
}

export const AGE_LABELS: Record<string, string> = {
  AGE_RANGE_18_24: '18-24',
  AGE_RANGE_25_34: '25-34',
  AGE_RANGE_35_44: '35-44',
  AGE_RANGE_45_54: '45-54',
  AGE_RANGE_55_64: '55-64',
  AGE_RANGE_65_UP: '65+',
  AGE_RANGE_UNDETERMINED: 'Não detectado',
  UNDETERMINED: 'Não detectado',
}

export const GENDER_LABELS: Record<string, string> = {
  MALE: 'Masculino',
  FEMALE: 'Feminino',
  UNDETERMINED: 'Não detectado',
}

export const DAY_OF_WEEK_LABELS: Record<string, string> = {
  MONDAY: 'Seg',
  TUESDAY: 'Ter',
  WEDNESDAY: 'Qua',
  THURSDAY: 'Qui',
  FRIDAY: 'Sex',
  SATURDAY: 'Sáb',
  SUNDAY: 'Dom',
}

export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  SEARCH: 'Search',
  DISPLAY: 'Display',
  SHOPPING: 'Shopping',
  VIDEO: 'YouTube',
  PERFORMANCE_MAX: 'Pmax',
  HOTEL: 'Hotel',
  LOCAL: 'Local',
  SMART: 'Smart',
  DEMAND_GEN: 'Demand Gen',
  UNKNOWN: 'Desconhecido',
}

export const MATCH_TYPE_LABELS: Record<string, string> = {
  EXACT: 'Exata',
  PHRASE: 'Frase',
  BROAD: 'Ampla',
  NEAR_EXACT: 'Quase Exata',
  NEAR_PHRASE: 'Quase Frase',
}
