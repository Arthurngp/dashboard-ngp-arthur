-- ============================================================================
-- Módulo: NGP Copilot — Planos do agente (Fase 0 do PRD seções 8.6 + 8.7.1)
-- Escopo: agent_plans
--
-- Função dupla no MVP:
--   1. Capturar TODA proposta da IA antes de aplicar (memory_update incluído)
--   2. Suportar fila de aprovação com escalada
--
-- Tipos de plano (MVP):
--   - memory_update      : IA propõe atualizar client_memory_profiles
--   - timeline_event     : IA propõe registrar evento na timeline
--   - playbook_change    : (futuro) ajuste em regra/playbook do cliente
--   - campaign_create    : (Fase 1) propor campanha Meta/Google
--   - campaign_change    : (Fase 1) alterar campanha existente
--   - analysis_finding   : análise descoberta (não exige aprovação, só log)
--
-- Autoaplica: quando confidence >= threshold E scope='soft'
-- Escalada: agente marca needs_escalation=true quando não tem confiança
--           ou quando o impacto é alto
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid,
  client_id           uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,

  -- Origem do plano: mensagem do chat que disparou (opcional)
  conversation_id     uuid REFERENCES public.copilot_conversations(id) ON DELETE SET NULL,
  source_message_id   uuid REFERENCES public.copilot_messages(id) ON DELETE SET NULL,

  plan_type           text NOT NULL CHECK (plan_type IN (
                        'memory_update',
                        'timeline_event',
                        'playbook_change',
                        'campaign_create',
                        'campaign_change',
                        'analysis_finding'
                      )),

  -- Severidade do impacto. 'soft' pode autoaplicar se confiança alta.
  -- 'hard' SEMPRE pede aprovação humana.
  impact_scope        text NOT NULL DEFAULT 'soft'
                      CHECK (impact_scope IN ('soft', 'hard')),

  title               text NOT NULL,
  reasoning_summary   text NOT NULL,
  context_references  jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{table, id, why}]

  -- Diff estruturado: { before: {...}, after: {...} } pra exibição
  proposal_json       jsonb NOT NULL,

  -- 0.0–1.0 — agente declara confiança no que está propondo
  confidence          numeric(3,2) NOT NULL DEFAULT 0.50
                      CHECK (confidence >= 0 AND confidence <= 1),

  -- Quando true, ignora autoapply mesmo em soft+high_confidence
  needs_escalation    boolean NOT NULL DEFAULT false,
  escalation_reason   text,

  status              text NOT NULL DEFAULT 'pending_approval'
                      CHECK (status IN (
                        'draft',
                        'pending_approval',
                        'approved',
                        'rejected',
                        'applied',
                        'failed',
                        'auto_applied'
                      )),

  -- Justificativa do humano (PRD 8.6.1)
  decision_note       text,
  decided_by          uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  decided_at          timestamptz,

  -- Resultado da aplicação
  applied_at          timestamptz,
  applied_error       text,
  applied_changes     jsonb,  -- registro do que efetivamente foi mudado

  agent_model         text,
  agent_run_id        text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_plans_client_status_idx
  ON public.agent_plans (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_plans_pending_idx
  ON public.agent_plans (created_at DESC)
  WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS agent_plans_type_idx
  ON public.agent_plans (client_id, plan_type, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_plans_conversation_idx
  ON public.agent_plans (conversation_id);

DROP TRIGGER IF EXISTS agent_plans_updated_at ON public.agent_plans;
CREATE TRIGGER agent_plans_updated_at
  BEFORE UPDATE ON public.agent_plans
  FOR EACH ROW EXECUTE FUNCTION public.copilot_set_updated_at();

ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ngp_all_agent_plans" ON public.agent_plans;
CREATE POLICY "ngp_all_agent_plans"
  ON public.agent_plans FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

-- ----------------------------------------------------------------------------
-- Função: aplicar memory_update aprovado
--   Atualiza client_memory_profiles atômicamente, registra timeline_event,
--   e marca o plano como 'applied'.
--   Usada tanto pelo path de aprovação humana quanto pelo auto-apply.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copilot_apply_memory_update(plan_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan agent_plans%ROWTYPE;
  v_after jsonb;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_plan FROM agent_plans WHERE id = plan_id FOR UPDATE;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Plan % not found', plan_id;
  END IF;

  IF v_plan.plan_type != 'memory_update' THEN
    RAISE EXCEPTION 'Plan % is not a memory_update', plan_id;
  END IF;

  IF v_plan.status NOT IN ('approved','draft') AND NOT (v_plan.status = 'pending_approval' AND v_plan.impact_scope = 'soft' AND v_plan.confidence >= 0.80 AND NOT v_plan.needs_escalation) THEN
    RAISE EXCEPTION 'Plan % not in applicable status (got %)', plan_id, v_plan.status;
  END IF;

  v_after := v_plan.proposal_json -> 'after';

  -- Upsert no profile usando os campos presentes em 'after'
  INSERT INTO client_memory_profiles (
    client_id, workspace_id,
    executive_summary, service_scope, business_context, offer_context,
    icp_context, channel_notes, operational_rules, risks,
    last_compacted_by, last_compacted_at
  )
  VALUES (
    v_plan.client_id, v_plan.workspace_id,
    v_after->>'executive_summary',
    v_after->>'service_scope',
    v_after->>'business_context',
    v_after->>'offer_context',
    v_after->>'icp_context',
    coalesce(v_after->'channel_notes', '{}'::jsonb),
    v_after->>'operational_rules',
    v_after->>'risks',
    'copilot:' || coalesce(v_plan.agent_model, 'unknown'),
    now()
  )
  ON CONFLICT (client_id) DO UPDATE SET
    executive_summary  = coalesce(EXCLUDED.executive_summary,  client_memory_profiles.executive_summary),
    service_scope      = coalesce(EXCLUDED.service_scope,      client_memory_profiles.service_scope),
    business_context   = coalesce(EXCLUDED.business_context,   client_memory_profiles.business_context),
    offer_context      = coalesce(EXCLUDED.offer_context,      client_memory_profiles.offer_context),
    icp_context        = coalesce(EXCLUDED.icp_context,        client_memory_profiles.icp_context),
    channel_notes      = client_memory_profiles.channel_notes || EXCLUDED.channel_notes,
    operational_rules  = coalesce(EXCLUDED.operational_rules,  client_memory_profiles.operational_rules),
    risks              = coalesce(EXCLUDED.risks,              client_memory_profiles.risks),
    last_compacted_by  = EXCLUDED.last_compacted_by,
    last_compacted_at  = now();

  -- Registra na timeline
  INSERT INTO client_timeline_events (
    workspace_id, client_id, event_type, title, description,
    motivador, reference_table, reference_id,
    created_by_agent, event_at
  )
  VALUES (
    v_plan.workspace_id, v_plan.client_id,
    'memory_update', v_plan.title, v_plan.reasoning_summary,
    coalesce(v_plan.decision_note, 'Aplicado automaticamente'),
    'agent_plans', v_plan.id,
    true, now()
  )
  RETURNING id INTO v_event_id;

  -- Marca o plano como aplicado
  UPDATE agent_plans SET
    status = CASE WHEN status = 'pending_approval' THEN 'auto_applied' ELSE 'applied' END,
    applied_at = now(),
    applied_changes = jsonb_build_object('timeline_event_id', v_event_id)
  WHERE id = plan_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.copilot_apply_memory_update(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copilot_apply_memory_update(uuid) TO authenticated, service_role;

COMMIT;
