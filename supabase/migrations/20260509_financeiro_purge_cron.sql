-- =============================================================================
-- Migration: Financeiro — pg_cron de purga (soft delete + tokens expirados)
-- Data: 2026-05-09
-- Autor: API expansion Tier 3
-- =============================================================================
--
-- ESCOPO
--
-- 1) Habilita extensão pg_cron (se ainda não habilitada).
--
-- 2) Função pública.fin_purge_soft_deleted():
--    DELETE de fin_transacoes onde deleted_at < now() - interval '30 days'.
--    Janela de 30 dias é o contrato com a API: restaurar_lancamento funciona
--    nesse prazo. Após, a linha é apagada DE VERDADE para o banco não inflar.
--
-- 3) Função pública.fin_purge_expired_confirmations():
--    DELETE de fin_delete_confirmations onde expires_at < now() - interval '1 hour'
--    (1h de margem para casos onde o agente está em execução). consumed_at NULL
--    + expirado é o caso normal; consumed_at NOT NULL e expirado também limpa
--    (já foi usado, não tem motivo para manter).
--
-- 4) Schedule via cron.schedule:
--    - 'fin-purge-soft-deleted': diário 03:00 UTC (00:00 BRT)
--    - 'fin-purge-expired-confirmations': a cada hora
--
-- IDEMPOTÊNCIA
-- - CREATE EXTENSION IF NOT EXISTS
-- - CREATE OR REPLACE FUNCTION
-- - cron.schedule retorna o job_id existente se o nome já existe.
--   Para reaplicar, fazemos cron.unschedule do nome antes.
--
-- ROLLBACK
-- - SELECT cron.unschedule('fin-purge-soft-deleted');
-- - SELECT cron.unschedule('fin-purge-expired-confirmations');
-- - DROP FUNCTION public.fin_purge_soft_deleted();
-- - DROP FUNCTION public.fin_purge_expired_confirmations();
-- - DROP EXTENSION pg_cron;  (cuidado: afeta outros jobs!)
-- =============================================================================

BEGIN;

-- 1) Extensão pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) Função: purga soft-deleted após 30 dias
CREATE OR REPLACE FUNCTION public.fin_purge_soft_deleted()
RETURNS TABLE (deleted_count integer, oldest_deleted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_oldest timestamptz;
BEGIN
  SELECT MIN(deleted_at) INTO v_oldest
  FROM public.fin_transacoes
  WHERE deleted_at < now() - interval '30 days';

  WITH del AS (
    DELETE FROM public.fin_transacoes
    WHERE deleted_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM del;

  -- Log no postgres logs (visível em supabase dashboard > logs > postgres)
  RAISE NOTICE 'fin_purge_soft_deleted: % registros apagados (oldest deleted_at: %)', v_count, v_oldest;

  RETURN QUERY SELECT v_count, v_oldest;
END;
$$;

COMMENT ON FUNCTION public.fin_purge_soft_deleted() IS
  'Apaga fisicamente fin_transacoes com deleted_at > 30 dias. Roda diariamente via pg_cron.';

-- 3) Função: purga tokens de confirmação expirados há > 1h
CREATE OR REPLACE FUNCTION public.fin_purge_expired_confirmations()
RETURNS TABLE (deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH del AS (
    DELETE FROM public.fin_delete_confirmations
    WHERE expires_at < now() - interval '1 hour'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM del;

  RAISE NOTICE 'fin_purge_expired_confirmations: % tokens apagados', v_count;

  RETURN QUERY SELECT v_count;
END;
$$;

COMMENT ON FUNCTION public.fin_purge_expired_confirmations() IS
  'Apaga fin_delete_confirmations expirados há > 1 hora. Roda a cada hora via pg_cron.';

-- 4) Schedule (idempotente: unschedule + schedule)
DO $$
BEGIN
  -- Desagenda jobs antigos com mesmo nome (se existirem)
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('fin-purge-soft-deleted', 'fin-purge-expired-confirmations');

  -- Agenda novamente
  PERFORM cron.schedule('fin-purge-soft-deleted', '0 3 * * *', $job$SELECT public.fin_purge_soft_deleted()$job$);
  PERFORM cron.schedule('fin-purge-expired-confirmations', '0 * * * *', $job$SELECT public.fin_purge_expired_confirmations()$job$);
END $$;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO
--
-- 1) Funções criadas:
--    SELECT proname, proconfig FROM pg_proc
--    WHERE pronamespace='public'::regnamespace
--      AND proname IN ('fin_purge_soft_deleted', 'fin_purge_expired_confirmations');
--
-- 2) Jobs agendados:
--    SELECT jobname, schedule, command FROM cron.job
--    WHERE jobname IN ('fin-purge-soft-deleted', 'fin-purge-expired-confirmations');
--
-- 3) Histórico de execuções (depois que rodar):
--    SELECT * FROM cron.job_run_details
--    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'fin-purge-%')
--    ORDER BY start_time DESC LIMIT 10;
--
-- 4) Smoke test manual (executa AGORA, sem esperar o cron):
--    SELECT * FROM public.fin_purge_soft_deleted();
--    SELECT * FROM public.fin_purge_expired_confirmations();
-- =============================================================================
