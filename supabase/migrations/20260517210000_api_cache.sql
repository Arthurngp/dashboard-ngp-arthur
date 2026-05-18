-- ── Tabela api_cache + cache_stats ───────────────────────────────────────────
-- Cache compartilhado de respostas de APIs externas (Meta, Google Ads, etc).
-- Postgres aguenta nosso volume tranquilo (10 req/s pico vs 50K/s capacidade).
-- Quando crescer a ponto de doer, troca o backend pra Redis SEM mudar interface.
--
-- Schema:
--   - cache_key: hash determinístico {endpoint}:{params} (até 256 chars)
--   - payload: jsonb (resposta completa serializada)
--   - expires_at: quando o cache deixa de ser válido
--   - created_at: pra auditoria/debug
--
-- Limpeza:
--   - Edge functions fazem DELETE WHERE expires_at < now() oportunisticamente
--   - Cron pg_cron diário faz limpeza agressiva (entries vencidas há +1h)

CREATE TABLE IF NOT EXISTS public.api_cache (
  cache_key  text PRIMARY KEY,
  payload    jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lookup primário é por cache_key (já indexado por ser PK).
-- expires_at é usado pelo GC pra apagar em lote — índice acelera DELETE em range.
CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at ON public.api_cache(expires_at);

-- RLS: ninguém acessa direto. Só edges via service_role.
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
-- (sem policies = bloqueio total pra anon/authenticated. service_role bypassa.)

COMMENT ON TABLE public.api_cache IS
  'Cache compartilhado de respostas de APIs externas (Meta, Google Ads, snapshots IA). '
  'Chave determinística por endpoint+params. TTL padrão 30min, configurável por call site.';
COMMENT ON COLUMN public.api_cache.cache_key IS
  'Hash determinístico do request: ex "meta-insights:act_123:last_7d:campaign". '
  'Quem grava define a key; quem lê precisa derivar a MESMA key.';

-- ── Estatísticas de uso do cache ─────────────────────────────────────────────
-- Tabela enxuta pra dashboard de telemetria. Atualizada via UPSERT atômico.
-- Sem PII; sem dado sensível — só counters por chave/endpoint.

CREATE TABLE IF NOT EXISTS public.cache_stats (
  endpoint    text PRIMARY KEY,
  hits        bigint NOT NULL DEFAULT 0,
  misses      bigint NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  last_miss_at timestamptz,
  avg_payload_kb numeric(10, 2)
);

ALTER TABLE public.cache_stats ENABLE ROW LEVEL SECURITY;

-- RPC pra incremento atômico (evita race em hits concorrentes).
-- Edge functions chamam após hit/miss; falha silenciosa não bloqueia request.
CREATE OR REPLACE FUNCTION public.cache_stats_record(
  p_endpoint text,
  p_hit boolean,
  p_payload_bytes int DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cache_stats (endpoint, hits, misses, last_hit_at, last_miss_at, avg_payload_kb)
  VALUES (
    p_endpoint,
    CASE WHEN p_hit THEN 1 ELSE 0 END,
    CASE WHEN p_hit THEN 0 ELSE 1 END,
    CASE WHEN p_hit THEN now() ELSE NULL END,
    CASE WHEN p_hit THEN NULL ELSE now() END,
    CASE WHEN p_payload_bytes IS NOT NULL THEN (p_payload_bytes::numeric / 1024) ELSE NULL END
  )
  ON CONFLICT (endpoint) DO UPDATE SET
    hits = cache_stats.hits + CASE WHEN p_hit THEN 1 ELSE 0 END,
    misses = cache_stats.misses + CASE WHEN p_hit THEN 0 ELSE 1 END,
    last_hit_at = CASE WHEN p_hit THEN now() ELSE cache_stats.last_hit_at END,
    last_miss_at = CASE WHEN p_hit THEN cache_stats.last_miss_at ELSE now() END,
    -- Moving average aproximada: 90% antigo + 10% novo
    avg_payload_kb = CASE
      WHEN p_payload_bytes IS NULL THEN cache_stats.avg_payload_kb
      WHEN cache_stats.avg_payload_kb IS NULL THEN (p_payload_bytes::numeric / 1024)
      ELSE (cache_stats.avg_payload_kb * 0.9 + (p_payload_bytes::numeric / 1024) * 0.1)
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cache_stats_record(text, boolean, int) TO service_role;
