CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'performance',
  model text NOT NULL DEFAULT 'gpt-4o-mini',
  temperature numeric(3,2) NOT NULL DEFAULT 0.40,
  system_prompt text NOT NULL,
  user_prompt text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_active
  ON ai_prompt_templates (is_active, category, name);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_created_by
  ON ai_prompt_templates (created_by);

CREATE TABLE IF NOT EXISTS ai_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  cliente_username text,
  cliente_nome text,
  meta_account_id text,
  period_label text,
  prompt_template_id uuid REFERENCES ai_prompt_templates(id) ON DELETE SET NULL,
  prompt_name text,
  model text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra_context text,
  output text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_runs_cliente_created
  ON ai_analysis_runs (cliente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_runs_created_by_created
  ON ai_analysis_runs (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_runs_prompt_template
  ON ai_analysis_runs (prompt_template_id);

ALTER TABLE ai_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis_runs ENABLE ROW LEVEL SECURITY;

INSERT INTO ai_prompt_templates (
  slug,
  name,
  description,
  category,
  model,
  temperature,
  system_prompt,
  user_prompt,
  is_active
) VALUES (
  'diagnostico-performance-meta',
  'Diagnóstico de Performance Meta Ads',
  'Analisa campanhas, investimento, alcance e conversões para sugerir ações práticas.',
  'performance',
  'gpt-4o-mini',
  0.35,
  'Você é um estrategista sênior de performance marketing da NGP. Responda sempre em português brasileiro, com leitura prática, objetiva e orientada a decisão. Não invente dados ausentes. Quando uma métrica não existir, diga que ela não foi informada.',
  'Faça uma análise executiva das métricas do período. Estruture em: 1) Diagnóstico rápido, 2) O que está funcionando, 3) Riscos e desperdícios, 4) Próximas ações recomendadas. Seja específico com base nos números enviados.',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  model = EXCLUDED.model,
  temperature = EXCLUDED.temperature,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt = EXCLUDED.user_prompt,
  is_active = EXCLUDED.is_active,
  updated_at = now();
