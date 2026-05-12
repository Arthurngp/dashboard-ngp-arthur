-- =============================================================================
-- Migration: RLS crítico - Fase 2B.1 (relatorios — drop policies anon/auth)
-- Data: 2026-05-09
-- Autor: revisão de segurança
-- =============================================================================
--
-- ESCOPO
-- Remover policies permissivas (anon/authenticated) em `relatorios`.
-- O frontend foi refatorado para chamar `get-relatorios` edge function ao
-- invés de `/rest/v1/relatorios` (linha 137 do `app/cliente/ClienteAnalyticsView.tsx`).
--
-- NÃO mexido: `allow_public_select_by_id` (role public, USING true).
-- Esta policy é usada pelo link público compartilhável de relatório
-- (`public/logos/relatorio-static.html` linha 656). Drop dela quebra esse
-- fluxo. Tratar em fase posterior junto com sistema de tokens de
-- compartilhamento (ver PROXIMOS_PASSOS.md).
--
-- VALIDAÇÃO PRÉVIA
-- - app/cliente/ClienteAnalyticsView.tsx:loadRelatorios refatorada (commit
--   da mesma sessão) para usar efCall('get-relatorios', { cliente_username })
-- - Edge functions: get-relatorios, save-relatorio, delete-relatorio (todas
--   com session_token + service_role) já implementadas e funcionais
-- - Pentest da edge function: retorna 401 com session inválida ✅
--
-- IMPACTO
-- - Frontend antigo (sem o deploy do client refatorado) que ainda chame
--   `/rest/v1/relatorios?cliente_username=eq.<x>` para de funcionar ❗
-- - O drop NÃO afeta o link público compartilhado (`relatorio-static.html`)
--   porque mantemos `allow_public_select_by_id`.
--
-- ROLLBACK no rodapé.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "allow_insert_relatorios" ON public.relatorios;
DROP POLICY IF EXISTS "allow_select_relatorios" ON public.relatorios;
DROP POLICY IF EXISTS "allow_update_relatorios" ON public.relatorios;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO
--
-- 1) curl com anon SEM session_token deve retornar */0 nos endpoints REST:
--    GET /rest/v1/relatorios?select=*&limit=1   → */0
--
-- 2) Mas a policy public (USING true) ainda permite GET por id (até FASE 2B.2):
--    GET /rest/v1/relatorios?id=eq.<uuid>&select=id,dados → continua funcionando
--
-- 3) Edge function continua OK:
--    POST /functions/v1/get-relatorios → retorna lista filtrada por cliente
-- =============================================================================
-- ROLLBACK
--
-- BEGIN;
-- CREATE POLICY "allow_insert_relatorios" ON public.relatorios
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "allow_select_relatorios" ON public.relatorios
--   FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "allow_update_relatorios" ON public.relatorios
--   FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
-- COMMIT;
-- =============================================================================
