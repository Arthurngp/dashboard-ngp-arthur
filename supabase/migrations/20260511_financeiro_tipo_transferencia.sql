-- =============================================================================
-- Migration: fin_transacoes_tipo_check passa a aceitar 'transferencia'
-- Data: 2026-05-11
-- =============================================================================
--
-- ESCOPO
--
-- O check antigo restringia tipo a ('entrada','saida'). A partir do par de
-- transferência entre contas (transfer_pair_id), também é válido o valor
-- 'transferencia'. Sem isso, qualquer INSERT/UPDATE com tipo='transferencia'
-- falha com violação de check.
-- =============================================================================

ALTER TABLE public.fin_transacoes
  DROP CONSTRAINT IF EXISTS fin_transacoes_tipo_check;

ALTER TABLE public.fin_transacoes
  ADD CONSTRAINT fin_transacoes_tipo_check
  CHECK (tipo IN ('entrada', 'saida', 'transferencia'));
