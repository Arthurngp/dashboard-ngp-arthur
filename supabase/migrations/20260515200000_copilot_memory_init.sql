-- ============================================================================
-- Módulo: NGP Copilot — Memória persistente do cliente (Fase 0 do PRD)
-- Escopo: client_memory_profiles + client_timeline_events
-- Isolamento: prefixo copilot_/client_memory_ (não toca tabelas existentes)
-- Auth: usa public.current_ngp_user_id() (header x-session-token)
--
-- Tradeoff conhecido — profile 1-per-cliente:
--   No MVP, cada cliente tem UM perfil consolidado. Se no futuro precisar
--   separar contexto Meta vs Google vs CRM (porque divergem demais), trocar
--   o UNIQUE(client_id) por UNIQUE(client_id, scope) com coluna scope text.
--   Custo de migrar depois: 1 migration. Custo de prever agora: complexidade
--   sem benefício. Optamos por simples.
--
-- workspace_id: nullable, sem FK — a camada de workspaces ainda não existe
-- (PRD seção 23, questão 10). Quando existir, adiciona FK numa migration.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. client_memory_profiles
--    Perfil vivo da conta. Reescrito periodicamente por profile-compactor.
--    Campos editáveis manualmente pelo time NGP (correções de fato vencem
--    sobre o que a IA escreveu).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_memory_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid,
  client_id           uuid NOT NULL UNIQUE REFERENCES public.clientes(id) ON DELETE CASCADE,

  executive_summary   text,
  service_scope       text,
  business_context    text,
  offer_context       text,
  icp_context         text,
  channel_notes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  operational_rules   text,
  risks               text,

  last_compacted_at   timestamptz,
  last_compacted_by   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_memory_profiles_workspace_idx
  ON public.client_memory_profiles (workspace_id);

CREATE INDEX IF NOT EXISTS client_memory_profiles_updated_idx
  ON public.client_memory_profiles (updated_at DESC);

-- Full-text search em PT-BR sobre os campos textuais (busca semântica futura)
CREATE INDEX IF NOT EXISTS client_memory_profiles_fts_idx
  ON public.client_memory_profiles
  USING GIN (
    to_tsvector('portuguese',
      coalesce(executive_summary, '') || ' ' ||
      coalesce(service_scope, '') || ' ' ||
      coalesce(business_context, '') || ' ' ||
      coalesce(offer_context, '') || ' ' ||
      coalesce(icp_context, '') || ' ' ||
      coalesce(operational_rules, '') || ' ' ||
      coalesce(risks, '')
    )
  );

-- ----------------------------------------------------------------------------
-- 2. client_timeline_events
--    Linha do tempo append-only D0 → D1000. Cada evento captura motivador,
--    resultado esperado e (preenchido depois) resultado observado.
--    Habilita backtesting (PRD seção 8.9): comparar hipótese vs resultado.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_timeline_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid,
  client_id             uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,

  event_type            text NOT NULL,
  title                 text NOT NULL,
  description           text,

  -- Inteligência operacional: por quê + o que esperávamos + o que aconteceu
  motivador             text,
  resultado_esperado    text,
  resultado_observado   text,
  hypothesis_status     text NOT NULL DEFAULT 'open'
                        CHECK (hypothesis_status IN ('open', 'confirmed', 'rejected', 'partial', 'na')),
  observed_at           timestamptz,

  -- Liga ao registro original (mensagem do copilot, ação, asset, etc)
  reference_table       text,
  reference_id          uuid,

  event_at              timestamptz NOT NULL DEFAULT now(),
  created_by_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_by_agent      boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_timeline_events_client_event_at_idx
  ON public.client_timeline_events (client_id, event_at DESC);

CREATE INDEX IF NOT EXISTS client_timeline_events_type_idx
  ON public.client_timeline_events (client_id, event_type, event_at DESC);

CREATE INDEX IF NOT EXISTS client_timeline_events_hypothesis_idx
  ON public.client_timeline_events (client_id, hypothesis_status)
  WHERE hypothesis_status = 'open';

CREATE INDEX IF NOT EXISTS client_timeline_events_reference_idx
  ON public.client_timeline_events (reference_table, reference_id);

-- Full-text PT-BR para busca por palavras-chave no histórico
CREATE INDEX IF NOT EXISTS client_timeline_events_fts_idx
  ON public.client_timeline_events
  USING GIN (
    to_tsvector('portuguese',
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(motivador, '') || ' ' ||
      coalesce(resultado_esperado, '') || ' ' ||
      coalesce(resultado_observado, '')
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Trigger genérico para updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copilot_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_memory_profiles_updated_at ON public.client_memory_profiles;
CREATE TRIGGER client_memory_profiles_updated_at
  BEFORE UPDATE ON public.client_memory_profiles
  FOR EACH ROW EXECUTE FUNCTION public.copilot_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS
--    Toda equipe interna NGP (admin/ngp) lê e escreve.
--    service_role bypassa pra jobs (compactor, summarizer).
-- ----------------------------------------------------------------------------
ALTER TABLE public.client_memory_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_memory_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.client_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_timeline_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ngp_all_client_memory_profiles" ON public.client_memory_profiles;
CREATE POLICY "ngp_all_client_memory_profiles"
  ON public.client_memory_profiles
  FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

DROP POLICY IF EXISTS "ngp_all_client_timeline_events" ON public.client_timeline_events;
CREATE POLICY "ngp_all_client_timeline_events"
  ON public.client_timeline_events
  FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

COMMIT;
