-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo: Ponto Eletrônico NGP — Lixeira (soft delete)
-- Adiciona colunas de exclusão lógica em ponto_registros
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ponto_registros
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by  UUID        DEFAULT NULL REFERENCES usuarios(id);

-- Índice para buscar rapidamente os registros excluídos
CREATE INDEX IF NOT EXISTS idx_ponto_deleted_at
  ON ponto_registros(deleted_at)
  WHERE deleted_at IS NOT NULL;
