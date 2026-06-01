-- ============================================================================
-- NGP Copilot — daily_learning_documents (PRD seção 8.7.1 + 13.2)
-- Documentos diários de aprendizado por cliente.
-- Gerados pela edge function copilot-daily-summarizer (cron 1x/dia).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_learning_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid,
  client_id             uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,

  document_date         date NOT NULL,
  title                 text NOT NULL,
  summary_markdown      text NOT NULL,
  summary_json          jsonb,

  -- 'generated' | 'reviewed' | 'archived'
  status                text NOT NULL DEFAULT 'generated'
                        CHECK (status IN ('generated', 'reviewed', 'archived')),
  generated_by_model    text,
  reviewed_by           uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  is_editable           boolean NOT NULL DEFAULT true,

  -- Estatísticas do dia consolidadas (counts pra exibição rápida)
  stats_json            jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, document_date)
);

CREATE INDEX IF NOT EXISTS daily_learning_documents_client_date_idx
  ON public.daily_learning_documents (client_id, document_date DESC);

CREATE INDEX IF NOT EXISTS daily_learning_documents_status_idx
  ON public.daily_learning_documents (status, document_date DESC);

CREATE INDEX IF NOT EXISTS daily_learning_documents_fts_idx
  ON public.daily_learning_documents
  USING GIN (to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(summary_markdown, '')));

DROP TRIGGER IF EXISTS daily_learning_documents_updated_at ON public.daily_learning_documents;
CREATE TRIGGER daily_learning_documents_updated_at
  BEFORE UPDATE ON public.daily_learning_documents
  FOR EACH ROW EXECUTE FUNCTION public.copilot_set_updated_at();

ALTER TABLE public.daily_learning_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_learning_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ngp_all_daily_learning_documents" ON public.daily_learning_documents;
CREATE POLICY "ngp_all_daily_learning_documents"
  ON public.daily_learning_documents FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

COMMIT;
