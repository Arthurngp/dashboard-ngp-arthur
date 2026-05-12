-- =============================================================================
-- Migration: Financeiro — transferências entre contas como par de lançamentos
-- Data: 2026-05-11
-- =============================================================================
--
-- ESCOPO
--
-- 1) Adiciona `transfer_pair_id UUID` e `transfer_direction TEXT` em
--    fin_transacoes para suportar transferências entre contas como par
--    (uma linha tipo=transferencia direction=out na origem e outra
--    tipo=transferencia direction=in no destino, ambas com o mesmo
--    transfer_pair_id).
--
-- 2) Saldo por conta passa a usar transfer_direction para decidir sinal:
--    - direction=in  → soma valor
--    - direction=out → subtrai valor
--
-- 3) DRE/resumo: linhas com tipo='transferencia' não entram em entradas
--    nem em saídas; afetam apenas saldo das contas envolvidas.
--
-- IDEMPOTÊNCIA: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- =============================================================================

BEGIN;

ALTER TABLE public.fin_transacoes
  ADD COLUMN IF NOT EXISTS transfer_pair_id UUID NULL,
  ADD COLUMN IF NOT EXISTS transfer_direction TEXT NULL;

ALTER TABLE public.fin_transacoes
  DROP CONSTRAINT IF EXISTS fin_transacoes_transfer_direction_check;
ALTER TABLE public.fin_transacoes
  ADD CONSTRAINT fin_transacoes_transfer_direction_check
  CHECK (transfer_direction IS NULL OR transfer_direction IN ('in', 'out'));

-- Coerência: se houver pair_id, precisa ter direction (e vice-versa).
ALTER TABLE public.fin_transacoes
  DROP CONSTRAINT IF EXISTS fin_transacoes_transfer_pair_consistency_check;
ALTER TABLE public.fin_transacoes
  ADD CONSTRAINT fin_transacoes_transfer_pair_consistency_check
  CHECK (
    (transfer_pair_id IS NULL AND transfer_direction IS NULL)
    OR
    (transfer_pair_id IS NOT NULL AND transfer_direction IS NOT NULL AND tipo = 'transferencia')
  );

CREATE INDEX IF NOT EXISTS fin_transacoes_transfer_pair_idx
  ON public.fin_transacoes (transfer_pair_id)
  WHERE transfer_pair_id IS NOT NULL;

-- Recria a VIEW canônica para incluir as novas colunas (SELECT *).
CREATE OR REPLACE VIEW public.fin_transacoes_ativas AS
SELECT *
FROM public.fin_transacoes
WHERE deleted_at IS NULL;

COMMIT;

-- ROLLBACK
-- BEGIN;
-- ALTER TABLE public.fin_transacoes DROP CONSTRAINT IF EXISTS fin_transacoes_transfer_pair_consistency_check;
-- ALTER TABLE public.fin_transacoes DROP CONSTRAINT IF EXISTS fin_transacoes_transfer_direction_check;
-- DROP INDEX IF EXISTS public.fin_transacoes_transfer_pair_idx;
-- ALTER TABLE public.fin_transacoes DROP COLUMN IF EXISTS transfer_direction;
-- ALTER TABLE public.fin_transacoes DROP COLUMN IF EXISTS transfer_pair_id;
-- CREATE OR REPLACE VIEW public.fin_transacoes_ativas AS
--   SELECT * FROM public.fin_transacoes WHERE deleted_at IS NULL;
-- COMMIT;
