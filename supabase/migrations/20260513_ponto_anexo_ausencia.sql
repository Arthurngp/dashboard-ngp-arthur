-- =============================================================================
-- Migration: ponto_registros — anexo de justificativa (atestado/falta)
-- Data: 2026-05-13
-- =============================================================================
--
-- Adiciona 3 colunas pra metadados do anexo (o binário vai no Storage):
--   anexo_path  TEXT  — caminho relativo dentro do bucket "ponto-anexos"
--   anexo_mime  TEXT  — MIME type do arquivo
--   anexo_size  INT   — bytes (pra exibir no UI)
--
-- Cria bucket privado "ponto-anexos" (não-listável, só via signed URL).
-- Acesso aos arquivos é mediado por edge function que valida admin OU dono.
-- =============================================================================

BEGIN;

ALTER TABLE public.ponto_registros
  ADD COLUMN IF NOT EXISTS anexo_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS anexo_mime TEXT NULL,
  ADD COLUMN IF NOT EXISTS anexo_size INTEGER NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ponto-anexos',
  'ponto-anexos',
  false,
  5242880,
  ARRAY['application/pdf','image/png','image/jpeg','image/jpg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
