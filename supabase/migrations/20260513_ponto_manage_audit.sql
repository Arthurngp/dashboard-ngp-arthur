-- =============================================================================
-- Migration: ponto_registros — auditoria de edição manual pelo admin
-- Data: 2026-05-13
-- =============================================================================
--
-- Adiciona campos para rastrear edições manuais feitas pelo admin via
-- nova edge function admin-ponto-manage (create/update/mark_absence).
--
-- edited_at: timestamp da última alteração admin
-- edited_by: usuario_id do admin que fez a alteração
--
-- A coluna `source` (TEXT livre, default 'app') passa a aceitar 2 novos
-- valores: 'admin_manual' (batida criada manualmente) e 'admin_edited'
-- (batida originalmente de outra origem, mas editada por admin).
-- =============================================================================

BEGIN;

ALTER TABLE public.ponto_registros
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL;

ALTER TABLE public.ponto_registros
  ADD COLUMN IF NOT EXISTS edited_by UUID NULL REFERENCES public.usuarios(id);

COMMIT;
