-- =============================================================================
-- Migration: Financeiro — soft delete de lançamentos + scope financeiro:delete
-- Data: 2026-05-09
-- Autor: API expansion Tier 3 (deletes via agente IA)
-- =============================================================================
--
-- ESCOPO
--
-- 1) Coluna `deleted_at TIMESTAMPTZ` em fin_transacoes (default NULL)
--    + índice parcial para queries que filtram pendentes de deleção.
--
-- 2) Coluna `deleted_by_token_id UUID` para audit (qual token apagou).
--
-- 3) VIEW `fin_transacoes_ativas` — fonte da verdade para todas as queries
--    de saldo/dashboard/relatórios. Edge functions devem ler dela e não da
--    tabela direta (evita bug de "ghost data" que tivemos hoje com saldo).
--
-- 4) Tabela `fin_delete_confirmations` — armazena dry-run tokens.
--    Cada dry-run gera uma linha com:
--      - id (UUID, retornado como confirmation_token)
--      - api_token_id (quem solicitou)
--      - target_ids (UUID[] com os ids que seriam apagados)
--      - target_hash (sha256 hex dos ids ordenados — defesa anti-bait-and-switch)
--      - filtros_snapshot (JSONB com os filtros do dry-run)
--      - created_at, expires_at (default now() + 5 min)
--      - consumed_at (NULL até ser usado no commit; UPDATE ao consumir)
--    RLS: only service_role (edge function).
--
-- 5) Scope financeiro:delete — adicionado ao espelho Deno em
--    _shared/api_scopes.ts (commit separado, código).
--
-- IDEMPOTÊNCIA
-- - ALTER TABLE ADD COLUMN IF NOT EXISTS
-- - CREATE OR REPLACE VIEW
-- - CREATE TABLE IF NOT EXISTS
--
-- ROLLBACK no rodapé.
-- =============================================================================

BEGIN;

-- 1) Soft delete columns
ALTER TABLE public.fin_transacoes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_token_id UUID NULL REFERENCES public.api_tokens(id) ON DELETE SET NULL;

-- Índice parcial: rápido para queries de listagem padrão (que filtram NOT deleted)
CREATE INDEX IF NOT EXISTS fin_transacoes_not_deleted_idx
  ON public.fin_transacoes (id)
  WHERE deleted_at IS NULL;

-- Índice para purga futura (cron limpa registros old)
CREATE INDEX IF NOT EXISTS fin_transacoes_deleted_at_idx
  ON public.fin_transacoes (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 2) VIEW canônica de transações ativas
-- Todas as queries de saldo/relatório devem ler daqui.
CREATE OR REPLACE VIEW public.fin_transacoes_ativas AS
SELECT *
FROM public.fin_transacoes
WHERE deleted_at IS NULL;

COMMENT ON VIEW public.fin_transacoes_ativas IS
  'Fonte canônica de leitura de transações. Filtra automaticamente lançamentos com soft delete (deleted_at NOT NULL). Use esta view em vez de fin_transacoes direto para cálculos de saldo, DRE, dashboard e relatórios.';

-- 3) Tabela de confirmações de delete (dry-run → commit)
CREATE TABLE IF NOT EXISTS public.fin_delete_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_token_id UUID NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  target_ids UUID[] NOT NULL,
  target_hash TEXT NOT NULL,                     -- sha256 hex de target_ids ordenados
  filtros_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.fin_delete_confirmations IS
  'Tokens de confirmação de delete via API. Dry-run gera uma linha; commit consome. Token expira em 5min. Após consumed_at != NULL não pode ser reutilizado.';

CREATE INDEX IF NOT EXISTS fin_delete_confirmations_token_idx
  ON public.fin_delete_confirmations (api_token_id, expires_at)
  WHERE consumed_at IS NULL;

-- RLS: apenas service_role (edge functions)
ALTER TABLE public.fin_delete_confirmations ENABLE ROW LEVEL SECURITY;
-- Sem policies = só service_role passa (mesmo padrão da Fase 1 do hardening)

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO
--
-- 1) Coluna criada:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='fin_transacoes' AND column_name LIKE 'deleted%';
--
-- 2) View funciona:
--    SELECT count(*) FROM public.fin_transacoes_ativas;  -- deve = count(*) FROM fin_transacoes WHERE deleted_at IS NULL
--
-- 3) Tabela de confirmações:
--    \d public.fin_delete_confirmations
--    SELECT * FROM pg_class WHERE relname = 'fin_delete_confirmations';  -- relrowsecurity = true
--
-- 4) Anon não consegue acessar:
--    GET /rest/v1/fin_delete_confirmations → */0
-- =============================================================================
-- ROLLBACK
--
-- BEGIN;
-- DROP TABLE IF EXISTS public.fin_delete_confirmations;
-- DROP VIEW IF EXISTS public.fin_transacoes_ativas;
-- DROP INDEX IF EXISTS public.fin_transacoes_not_deleted_idx;
-- DROP INDEX IF EXISTS public.fin_transacoes_deleted_at_idx;
-- ALTER TABLE public.fin_transacoes
--   DROP COLUMN IF EXISTS deleted_at,
--   DROP COLUMN IF EXISTS deleted_by_token_id;
-- COMMIT;
-- =============================================================================
