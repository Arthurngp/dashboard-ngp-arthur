// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token, action, ...params } = await req.json()

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!action)        return json(req, { error: 'Action obrigatória.' }, 400)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Valida sessão
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    // Valida role
    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single()

    if (!usuario || !['ngp', 'admin'].includes(usuario.role)) {
      return json(req, { error: 'Acesso negado.' }, 403)
    }

    // ── ACTIONS ──────────────────────────────────────────────────────────────

    // LIST — listar leads de um funil
    if (action === 'list') {
      const { pipeline_id } = params
      if (!pipeline_id) return json(req, { error: 'pipeline_id obrigatório.' }, 400)

      const { data, error } = await sb
        .from('crm_leads')
        .select('*')
        .eq('pipeline_id', pipeline_id)
        .order('stage_id', { ascending: true })
        .order('position', { ascending: true })

      if (error) throw error
      return json(req, { leads: data })
    }

    // CREATE — criar novo lead
    if (action === 'create') {
      const { pipeline_id, stage_id, company_name, contact_name, email, phone, estimated_value, notes, source, custom_data } = params
      if (!pipeline_id)    return json(req, { error: 'pipeline_id obrigatório.' }, 400)
      if (!stage_id)       return json(req, { error: 'stage_id obrigatório.' }, 400)
      if (!company_name?.trim()) return json(req, { error: 'company_name obrigatório.' }, 400)

      // Abre espaço no topo (posição 0)
      const { data: stageLeads } = await sb
        .from('crm_leads')
        .select('id, position')
        .eq('stage_id', stage_id)
        .order('position', { ascending: true })

      if (stageLeads && stageLeads.length > 0) {
        await Promise.all(
          stageLeads.map((l: any) =>
            sb.from('crm_leads').update({ position: l.position + 1 }).eq('id', l.id)
          )
        )
      }

      const { data, error } = await sb
        .from('crm_leads')
        .insert({
          pipeline_id,
          stage_id,
          company_name: company_name.trim(),
          contact_name: contact_name?.trim() || null,
          email:        email?.trim() || null,
          phone:        phone?.trim() || null,
          estimated_value: estimated_value || 0,
          notes:  notes?.trim() || null,
          source: source?.trim() || null,
          position: 0,
          custom_data: custom_data || {},
        })
        .select()
        .single()

      if (error) throw error
      return json(req, { lead: data })
    }

    // UPDATE — editar campos do lead
    if (action === 'update') {
      const { lead_id, company_name, contact_name, email, phone, estimated_value, notes, source, status, custom_data } = params
      if (!lead_id) return json(req, { error: 'lead_id obrigatório.' }, 400)

      const updates: Record<string, unknown> = {}
      if (company_name  !== undefined) updates.company_name    = company_name?.trim() || null
      if (contact_name  !== undefined) updates.contact_name    = contact_name?.trim() || null
      if (email         !== undefined) updates.email           = email?.trim() || null
      if (phone         !== undefined) updates.phone           = phone?.trim() || null
      if (estimated_value !== undefined) updates.estimated_value = estimated_value
      if (notes         !== undefined) updates.notes           = notes?.trim() || null
      if (source        !== undefined) updates.source          = source?.trim() || null
      if (status        !== undefined) updates.status          = status
      if (custom_data   !== undefined) updates.custom_data     = custom_data

      const { data, error } = await sb
        .from('crm_leads')
        .update(updates)
        .eq('id', lead_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { lead: data })
    }

    // MOVE — mover lead entre etapas (drag-and-drop)
    if (action === 'move') {
      const { lead_id, new_stage_id, new_position } = params
      if (!lead_id)      return json(req, { error: 'lead_id obrigatório.' }, 400)
      if (!new_stage_id) return json(req, { error: 'new_stage_id obrigatório.' }, 400)
      if (new_position === undefined) return json(req, { error: 'new_position obrigatório.' }, 400)

      // Busca stage atual do lead
      const { data: lead } = await sb
        .from('crm_leads')
        .select('stage_id, position')
        .eq('id', lead_id)
        .single()

      if (!lead) return json(req, { error: 'Lead não encontrado.' }, 404)

      const oldStageId  = lead.stage_id
      const oldPosition = lead.position

      // Se mudou de stage: reordena o stage de origem (fecha o gap)
      if (oldStageId !== new_stage_id) {
        const { data: oldStageLeads } = await sb
          .from('crm_leads')
          .select('id, position')
          .eq('stage_id', oldStageId)
          .neq('id', lead_id)
          .order('position', { ascending: true })

        if (oldStageLeads) {
          await Promise.all(
            oldStageLeads.map((l: any, index: number) =>
              sb.from('crm_leads').update({ position: index }).eq('id', l.id)
            )
          )
        }

        // Abre espaço no stage de destino
        const { data: newStageLeads } = await sb
          .from('crm_leads')
          .select('id, position')
          .eq('stage_id', new_stage_id)
          .gte('position', new_position)
          .order('position', { ascending: true })

        if (newStageLeads) {
          await Promise.all(
            newStageLeads.map((l: any) =>
              sb.from('crm_leads').update({ position: l.position + 1 }).eq('id', l.id)
            )
          )
        }
      } else {
        // Mesmo stage — reordena internamente
        const { data: stageLeads } = await sb
          .from('crm_leads')
          .select('id, position')
          .eq('stage_id', oldStageId)
          .neq('id', lead_id)
          .order('position', { ascending: true })

        if (stageLeads) {
          const reordered = [...stageLeads]
          reordered.splice(new_position, 0, { id: lead_id, position: new_position })
          await Promise.all(
            reordered.map((l: any, index: number) =>
              sb.from('crm_leads').update({ position: index }).eq('id', l.id)
            )
          )
        }
      }

      // Atualiza o lead com novo stage e posição
      const { data, error } = await sb
        .from('crm_leads')
        .update({ stage_id: new_stage_id, position: new_position })
        .eq('id', lead_id)
        .select()
        .single()

      if (error) throw error
      return json(req, { lead: data, ok: true })
    }

    // DELETE — excluir lead
    if (action === 'delete') {
      const { lead_id } = params
      if (!lead_id) return json(req, { error: 'lead_id obrigatório.' }, 400)

      // Busca stage para reordenar após delete
      const { data: lead } = await sb
        .from('crm_leads')
        .select('stage_id, position')
        .eq('id', lead_id)
        .single()

      const { error } = await sb
        .from('crm_leads')
        .delete()
        .eq('id', lead_id)

      if (error) throw error

      // Reordena posições no stage
      if (lead) {
        const { data: remaining } = await sb
          .from('crm_leads')
          .select('id')
          .eq('stage_id', lead.stage_id)
          .order('position', { ascending: true })

        if (remaining) {
          await Promise.all(
            remaining.map((l: any, index: number) =>
              sb.from('crm_leads').update({ position: index }).eq('id', l.id)
            )
          )
        }
      }

      return json(req, { ok: true })
    }

    return json(req, { error: `Action '${action}' desconhecida.` }, 400)

  } catch (e) {
    console.error('[crm-manage-leads]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
