import { efCall } from '@/lib/api'

export async function crmCall(fn: string, body: Record<string, unknown>): Promise<any> {
  return efCall(fn, body)
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
  custom_data?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface CrmPipelineField {
  id: string
  pipeline_id: string
  name: string
  type: string
  options: string[]
  position: number
  created_at: string
}
