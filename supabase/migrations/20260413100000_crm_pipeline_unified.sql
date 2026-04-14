-- ============================================================
-- FASE 1: CRM Pipeline Unificado
-- Substitui a abordagem de tabelas dinâmicas por 3 tabelas fixas
-- ============================================================

-- 1. TABELA DE FUNIS
CREATE TABLE IF NOT EXISTS crm_pipelines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. TABELA DE ETAPAS (colunas do kanban)
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid        NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  position    int         NOT NULL DEFAULT 0,
  color       text        NOT NULL DEFAULT '#9ca3af',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, position)
);

-- 3. TABELA DE LEADS
CREATE TABLE IF NOT EXISTS crm_leads (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     uuid           NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  stage_id        uuid           NOT NULL REFERENCES crm_pipeline_stages(id) ON DELETE RESTRICT,
  company_name    text           NOT NULL,
  contact_name    text,
  email           text,
  phone           text,
  estimated_value numeric(14,2)  NOT NULL DEFAULT 0,
  status          text           NOT NULL DEFAULT 'active',
  position        int            NOT NULL DEFAULT 0,
  notes           text,
  source          text,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now()
);

-- Índice para performance no kanban
CREATE INDEX IF NOT EXISTS crm_leads_pipeline_stage_pos_idx
  ON crm_leads (pipeline_id, stage_id, position);

-- 4. TRIGGER updated_at
CREATE OR REPLACE FUNCTION crm_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_pipelines_updated_at ON crm_pipelines;
CREATE TRIGGER crm_pipelines_updated_at
  BEFORE UPDATE ON crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

DROP TRIGGER IF EXISTS crm_pipeline_stages_updated_at ON crm_pipeline_stages;
CREATE TRIGGER crm_pipeline_stages_updated_at
  BEFORE UPDATE ON crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

DROP TRIGGER IF EXISTS crm_leads_updated_at ON crm_leads;
CREATE TRIGGER crm_leads_updated_at
  BEFORE UPDATE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

-- 5. RLS
ALTER TABLE crm_pipelines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads           ENABLE ROW LEVEL SECURITY;

-- Policies: acesso total para anon (autenticação é feita pela Edge Function com service_role_key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'crm_pipelines' AND policyname = 'crm_pipelines_all'
  ) THEN
    CREATE POLICY crm_pipelines_all ON crm_pipelines FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'crm_pipeline_stages' AND policyname = 'crm_pipeline_stages_all'
  ) THEN
    CREATE POLICY crm_pipeline_stages_all ON crm_pipeline_stages FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'crm_leads' AND policyname = 'crm_leads_all'
  ) THEN
    CREATE POLICY crm_leads_all ON crm_leads FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END;
$$;

-- 6. SEED: Funil Principal com 5 etapas default
DO $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  -- Só insere se não existir
  IF NOT EXISTS (SELECT 1 FROM crm_pipelines WHERE name = 'Funil Principal') THEN
    INSERT INTO crm_pipelines (name, description)
    VALUES ('Funil Principal', 'Pipeline padrão de vendas da NGP Space')
    RETURNING id INTO v_pipeline_id;

    INSERT INTO crm_pipeline_stages (pipeline_id, name, position, color) VALUES
      (v_pipeline_id, 'Prospecção',   0, '#9ca3af'),
      (v_pipeline_id, 'Qualificação', 1, '#60a5fa'),
      (v_pipeline_id, 'Reunião',      2, '#facc15'),
      (v_pipeline_id, 'Proposta',     3, '#fb923c'),
      (v_pipeline_id, 'Fechamento',   4, '#4ade80');
  END IF;
END;
$$;

-- 7. LIMPEZA legado
DROP TABLE IF EXISTS "crm-pipeline-index" CASCADE;
DROP FUNCTION IF EXISTS create_custom_pipeline(text) CASCADE;
DROP FUNCTION IF EXISTS create_custom_pipeline(pipeline_name text) CASCADE;
