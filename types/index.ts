export interface Session {
  auth: string
  session: string
  user: string
  role: 'admin' | 'ngp' | 'cliente'
  username: string
  expires: string
  metaToken?: string
  metaAccount?: string
  foto?: string
}

export interface Cliente {
  id: string
  username: string
  nome: string
  meta_account_id?: string
  foto_url?: string
}

export interface Relatorio {
  id: string
  titulo: string
  periodo: string
  updated_at: string
  dados?: { tipo?: 'v1' | 'v2' }
}

export interface Campaign {
  id: string
  name: string
  status: string
  objective: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  conversations: number
  leads: number
  purchases: number
  purchaseValue: number
  roas: number
  reach: number
}

export interface Adset {
  id: string
  name: string
  status: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  conversations: number
  leads: number
  purchases: number
}

export interface Ad {
  id: string
  name: string
  status: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  creative?: { thumbnail_url?: string }
}

export interface DateParam {
  date_preset?: string
  time_range?: string
}
