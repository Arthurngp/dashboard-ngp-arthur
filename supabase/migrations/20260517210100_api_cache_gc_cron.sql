-- ── GC do api_cache via pg_cron ──────────────────────────────────────────────
-- Job diário às 04:00 UTC (~01:00 BRT) que apaga entries vencidas há mais de 1h.
-- O delay de 1h evita race: se algum request estava em curso quando expirou,
-- ainda pega o cache em vez de gerar miss desnecessário.
--
-- pg_cron precisa estar habilitado no projeto. Em Supabase Pro está por default.
-- Se não estiver, este SQL falha silenciosamente — não bloqueia a migration.

DO $$
BEGIN
  -- Verifica se pg_cron está disponível antes de agendar
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove job anterior se já existir (idempotência)
    PERFORM cron.unschedule('api_cache_gc')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_cache_gc');

    -- Agenda novo job: diário às 04:00 UTC
    PERFORM cron.schedule(
      'api_cache_gc',
      '0 4 * * *',  -- crontab: minuto, hora, dia-do-mês, mês, dia-da-semana
      $job$
        DELETE FROM public.api_cache
        WHERE expires_at < (now() - interval '1 hour');
      $job$
    );

    RAISE NOTICE 'api_cache_gc agendado: diário às 04:00 UTC';
  ELSE
    RAISE NOTICE 'pg_cron não habilitado — GC manual via admin-cache-stats?gc=1';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Não bloqueia migration se pg_cron der erro (ex: ambiente local sem ext)
    RAISE NOTICE 'falha ao agendar api_cache_gc: %', SQLERRM;
END;
$$;
