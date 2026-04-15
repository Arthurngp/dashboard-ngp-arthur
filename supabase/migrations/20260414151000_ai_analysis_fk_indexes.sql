CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_created_by
  ON ai_prompt_templates (created_by);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_runs_prompt_template
  ON ai_analysis_runs (prompt_template_id);
