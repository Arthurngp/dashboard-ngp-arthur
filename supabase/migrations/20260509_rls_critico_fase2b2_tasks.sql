-- =============================================================================
-- Migration: RLS crítico - Fase 2B.2 (tasks, task_setores — drop policies anon)
-- Data: 2026-05-09
-- Autor: revisão de segurança
-- =============================================================================
--
-- ESCOPO
-- Remover policies permissivas (USING/CHECK true) em `tasks` e `task_setores`.
-- O frontend foi refatorado para chamar `tarefas-manage` edge function (op:
-- bootstrap, task_create, task_update, task_delete, setor_create, setor_update,
-- setor_delete, setores_list_all).
--
-- AUDITORIA
-- - app/tarefas/page.tsx: 5 chamadas /rest/v1/ → todas via efCall('tarefas-manage')
-- - app/tarefas/config/page.tsx: 4 chamadas /rest/v1/ → todas via efCall
-- - tsc --noEmit passa sem erros
-- - Edge function tarefas-manage deployada (verify_jwt: true)
--
-- O QUE NÃO É TOCADO
-- - `task_setores_delete_admin` (DELETE p/ authenticated, USING admin via
--   auth.uid()). Nosso modelo de sessão não usa auth.uid() (usamos
--   public.sessions), então essa policy nunca dispara hoje. Manter sem
--   prejuízo — não interfere com service_role.
--
-- IDEMPOTÊNCIA
-- DROP POLICY IF EXISTS é idempotente.
-- =============================================================================

BEGIN;

-- ── tasks ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tasks_anon_all" ON public.tasks;

-- ── task_setores ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Leitura total"     ON public.task_setores;
DROP POLICY IF EXISTS "Inserção total"    ON public.task_setores;
DROP POLICY IF EXISTS "Atualização total" ON public.task_setores;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO
--
-- Pentest com anon:
--   GET /rest/v1/tasks?select=*&limit=1         → */0
--   GET /rest/v1/task_setores?select=*&limit=1  → */0
--   POST /functions/v1/tarefas-manage (com session válida) → 200 com dados
-- =============================================================================
-- ROLLBACK
--
-- BEGIN;
-- CREATE POLICY "tasks_anon_all" ON public.tasks
--   FOR ALL TO anon USING (true) WITH CHECK (true);
-- CREATE POLICY "Leitura total" ON public.task_setores
--   FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "Inserção total" ON public.task_setores
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "Atualização total" ON public.task_setores
--   FOR UPDATE TO anon, authenticated USING (true);
-- COMMIT;
-- =============================================================================
