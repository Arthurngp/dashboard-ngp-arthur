import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'

export async function crmCall(fn: string, body: Record<string, unknown>) {
  const session = getSession()
  const res = await fetch(`${SURL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON,
      'Authorization': `Bearer ${ANON}`,
    },
    body: JSON.stringify({ session_token: session?.session, ...body }),
  })
  return res.json()
}

export interface CrmPipeline {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CrmStage {
  id: string
  pipeline_id: string
  name: string
  position: number
  color: string
  created_at: string
  updated_at: string
}

export interface CrmLead {
  id: string
  pipeline_id: string
  stage_id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  estimated_value: number
  status: string
  position: number
  notes: string | null
  source: string | null
  created_at: string
  updated_at: string
}
