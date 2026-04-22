import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isNgp } from "../_shared/roles.ts"

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const actor = await validateSession(sb, session_token)
    if (!actor) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isNgp(actor.role)) return json(req, { error: 'Acesso negado.' }, 403)

    const { data: usuarios, error: usuariosError } = await sb
      .from('usuarios')
      .select('id, nome, username, email, role, ativo, created_at, foto_url, meta_account_id')
      .eq('role', 'cliente')
      .is('archived_at', null)
      .order('created_at', { ascending: false })

    if (usuariosError) {
      console.error('[admin-listar-clientes-central] usuariosError', usuariosError)
      return json(req, { error: 'Erro ao buscar clientes.' }, 500)
    }

    const ids = (usuarios || []).map((cliente) => cliente.id)

    const [configRes, pipelinesRes] = await Promise.all([
      ids.length
        ? sb
            .from('cliente_portal_acessos')
            .select('usuario_id, analytics_enabled, reports_enabled, crm_enabled, updated_at')
            .in('usuario_id', ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? sb
            .from('crm_pipelines')
            .select('id, cliente_id, name, is_active, created_at')
            .in('cliente_id', ids)
            .eq('is_active', true)
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (configRes.error) {
      console.error('[admin-listar-clientes-central] configError', configRes.error)
      return json(req, { error: 'Erro ao buscar configurações dos clientes.' }, 500)
    }

    if (pipelinesRes.error) {
      console.error('[admin-listar-clientes-central] pipelinesError', pipelinesRes.error)
      return json(req, { error: 'Erro ao buscar CRM dos clientes.' }, 500)
    }

    const configMap = new Map((configRes.data || []).map((row) => [row.usuario_id, row]))
    const pipelineMap = new Map<string, { total: number; firstName: string | null }>()

    for (const pipeline of pipelinesRes.data || []) {
      const current = pipelineMap.get(pipeline.cliente_id) || { total: 0, firstName: null }
      pipelineMap.set(pipeline.cliente_id, {
        total: current.total + 1,
        firstName: current.firstName || pipeline.name,
      })
    }

    const clientes = (usuarios || []).map((cliente) => {
      const config = configMap.get(cliente.id)
      const pipelines = pipelineMap.get(cliente.id)
      return {
        ...cliente,
        analytics_enabled: config?.analytics_enabled ?? true,
        reports_enabled: config?.reports_enabled ?? true,
        crm_enabled: config?.crm_enabled ?? false,
        crm_pipeline_count: pipelines?.total ?? 0,
        crm_pipeline_name: pipelines?.firstName ?? null,
      }
    })

    return json(req, { clientes })
  } catch (e) {
    console.error('[admin-listar-clientes-central] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
