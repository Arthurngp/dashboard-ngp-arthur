-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo: Templates de contrato (persistência global)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  slug        text        NOT NULL UNIQUE DEFAULT 'default',
  nome        text        NOT NULL DEFAULT 'Template Oficial NGP',
  conteudo    text        NOT NULL,
  updated_by  uuid
);

CREATE OR REPLACE FUNCTION public.contract_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_templates_updated_at ON public.contract_templates;
CREATE TRIGGER contract_templates_updated_at
  BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.contract_templates_set_updated_at();

ALTER TABLE public.contract_templates DISABLE ROW LEVEL SECURITY;
