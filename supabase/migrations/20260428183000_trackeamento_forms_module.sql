-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo: Trackeamento / Formulários
-- Estruturas compartilhadas no mesmo projeto Supabase do NGP Space.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trackeamento_forms (
  id           text PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  title        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  theme        jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  published    boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS trackeamento_form_responses (
  id           text PRIMARY KEY,
  form_id      text NOT NULL REFERENCES trackeamento_forms(id) ON DELETE CASCADE,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trackeamento_form_sessions (
  id            text PRIMARY KEY,
  form_id       text NOT NULL REFERENCES trackeamento_forms(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'in_progress',
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  total_time_ms integer,
  last_field_id text,
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_trackeamento_forms_updated_at
  ON trackeamento_forms (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trackeamento_forms_created_by
  ON trackeamento_forms (created_by);

CREATE INDEX IF NOT EXISTS idx_trackeamento_form_responses_form_id
  ON trackeamento_form_responses (form_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_trackeamento_form_sessions_form_id
  ON trackeamento_form_sessions (form_id, started_at DESC);

ALTER TABLE trackeamento_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE trackeamento_form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE trackeamento_form_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'trackeamento-form-assets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('trackeamento-form-assets', 'trackeamento-form-assets', true);
  END IF;
END $$;

CREATE POLICY "trackeamento_form_assets_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'trackeamento-form-assets');

CREATE POLICY "trackeamento_form_assets_public_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'trackeamento-form-assets');
