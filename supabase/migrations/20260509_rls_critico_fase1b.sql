-- =============================================================================
-- Migration: RLS crítico - Fase 1B (feedback, contract_templates,
--                                   funções SECURITY DEFINER de uso só-edge,
--                                   limpeza de policies redundantes)
-- Data: 2026-05-09
-- Autor: revisão de segurança
-- =============================================================================
--
-- ESCOPO
--
-- 1) ENABLE RLS em `feedback` e `contract_templates`
--    - feedback           → consumida por feedback-submit, feedback-admin (edge)
--    - contract_templates → consumida por contract-template-load/-save (edge)
--    Ambas sem chamada do client. Mesmo padrão da Fase 1.
--
-- 2) Revogar EXECUTE de funções SECURITY DEFINER que são só-edge
--    - find_crm_lead_by_phone(text)
--      consumida por whatsapp-send, whatsapp-webhook, whatsapp-sync (edge).
--      Migration original já tinha GRANT só p/ service_role; foi re-concedida
--      por fora. Restaurar o estado pretendido.
--    - upsert_chat_conversation_projection(...)
--      idem, consumida por whatsapp-* (edge).
--
--    NÃO mexemos em `current_ngp_user_id()` nem `can_access_whatsapp_instance()`
--    porque são chamadas DENTRO de policies RLS de tabelas que o frontend
--    acessa diretamente (chat_messages, chat_conversations, ...) com a anon
--    key. Revogar EXECUTE de anon quebraria essas policies → tela de chat
--    retornaria vazio. Tratar essas 2 funções numa fase posterior junto com
--    refatoração do acesso ao chat.
--
-- 3) DROP de 3 policies redundantes que disparam falso-positivo no advisor.
--    Service role sempre bypassa RLS, então policies "Service role full access"
--    com USING(true) são desnecessárias.
--    - crm_activities."Service role full access"
--    - crm_tasks."Service role full access"
--    - crm_ai_advisor_runs.service_role_all_crm_ai_advisor_runs
--
-- IDEMPOTÊNCIA
-- Todos os comandos usam IF EXISTS / IF NOT EXISTS quando aplicável; ENABLE
-- RLS é idempotente.
-- =============================================================================

BEGIN;

-- ── 1) ENABLE RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.feedback           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

-- ── 2) REVOKE em funções SECURITY DEFINER ──────────────────────────────────
REVOKE ALL ON FUNCTION public.find_crm_lead_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.find_crm_lead_by_phone(text) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_chat_conversation_projection(
    text, text, text, text, text, uuid, text, text, text, timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_chat_conversation_projection(
    text, text, text, text, text, uuid, text, text, text, timestamptz, boolean
) TO service_role;

-- ── 3) DROP de policies redundantes (service_role já bypassa RLS) ──────────
DROP POLICY IF EXISTS "Service role full access"             ON public.crm_activities;
DROP POLICY IF EXISTS "Service role full access"             ON public.crm_tasks;
DROP POLICY IF EXISTS "service_role_all_crm_ai_advisor_runs" ON public.crm_ai_advisor_runs;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO
--
-- 1) RLS habilitado:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace='public'::regnamespace
--      AND relname IN ('feedback','contract_templates');
--    -- esperado: relrowsecurity = true para ambas
--
-- 2) Funções com EXECUTE só p/ service_role:
--    SELECT proname, array(SELECT r.rolname
--      FROM aclexplode(p.proacl) ae
--      LEFT JOIN pg_roles r ON r.oid = ae.grantee
--      WHERE ae.privilege_type='EXECUTE') AS executors
--    FROM pg_proc p WHERE proname IN
--      ('find_crm_lead_by_phone','upsert_chat_conversation_projection');
--    -- esperado: executors = {service_role,postgres}
--
-- 3) Policies redundantes removidas:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('crm_activities','crm_tasks','crm_ai_advisor_runs');
--    -- esperado: 0 linhas
--
-- 4) Pentest read-only com anon key:
--    GET /rest/v1/feedback           → []
--    GET /rest/v1/contract_templates → []
-- =============================================================================
-- ROLLBACK COMPLETO (caso necessário)
--
-- BEGIN;
--
-- -- 1)
-- ALTER TABLE public.feedback           DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.contract_templates DISABLE ROW LEVEL SECURITY;
--
-- -- 2)
-- GRANT EXECUTE ON FUNCTION public.find_crm_lead_by_phone(text)
--   TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.upsert_chat_conversation_projection(
--     text, text, text, text, text, uuid, text, text, text, timestamptz, boolean
-- ) TO anon, authenticated;
--
-- -- 3)
-- CREATE POLICY "Service role full access" ON public.crm_activities
--   FOR ALL USING (true);
-- CREATE POLICY "Service role full access" ON public.crm_tasks
--   FOR ALL USING (true);
-- CREATE POLICY "service_role_all_crm_ai_advisor_runs" ON public.crm_ai_advisor_runs
--   FOR ALL USING (true) WITH CHECK (true);
--
-- COMMIT;
-- =============================================================================
