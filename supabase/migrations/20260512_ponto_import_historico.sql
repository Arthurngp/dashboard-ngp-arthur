-- =============================================================================
-- Migration: ponto — importação de histórico (CSV/XLSX)
-- Data: 2026-05-12
-- =============================================================================
--
-- ESCOPO
--
-- 1) Estende ponto_tipo_valido para incluir 'ausencia' (dia sem batida real,
--    p/ marcar FOLGA / FERIADO / DOMINGO no histórico importado).
-- 2) Adiciona coluna observacao TEXT (livre, ex: "FOLGA").
-- 3) Adiciona coluna source TEXT NOT NULL DEFAULT 'app' para distinguir
--    batidas registradas via app vs importadas (source='import').
-- 4) Cria índice único parcial (usuario_id, created_at, tipo_registro) para
--    dedup em re-imports (ignora deleted).
-- =============================================================================

BEGIN;

ALTER TABLE public.ponto_registros
  DROP CONSTRAINT IF EXISTS ponto_tipo_valido;
ALTER TABLE public.ponto_registros
  ADD CONSTRAINT ponto_tipo_valido
  CHECK (tipo_registro IN ('entrada','saida_almoco','retorno_almoco','saida','extra','ausencia'));

ALTER TABLE public.ponto_registros
  ADD COLUMN IF NOT EXISTS observacao TEXT NULL;

ALTER TABLE public.ponto_registros
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app';

CREATE UNIQUE INDEX IF NOT EXISTS ponto_registros_dedup_idx
  ON public.ponto_registros (usuario_id, created_at, tipo_registro)
  WHERE deleted_at IS NULL;

COMMIT;
