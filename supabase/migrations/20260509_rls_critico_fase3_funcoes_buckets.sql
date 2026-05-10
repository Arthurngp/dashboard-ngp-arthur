-- =============================================================================
-- Migration: RLS crítico - Fase 3 (search_path em funções + buckets públicos)
-- Data: 2026-05-09
-- Autor: revisão de segurança
-- =============================================================================
--
-- ESCOPO
--
-- 1) Fixar `search_path` em 8 funções com search_path mutável (CVE class:
--    SQL injection via search_path). Definir `SET search_path = public, pg_temp`
--    em cada uma.
--
-- 2) Remover policies de SELECT amplo nos buckets `avatars` e
--    `trackeamento-form-assets`. Validação: app usa `getPublicUrl()` para
--    leitura (que não depende dessas policies) e uploads são feitos via edge
--    function ou signed URL. Policies de SELECT só serviam para listar
--    arquivos via /storage/v1/object/list, expondo todos os arquivos.
--
-- IDEMPOTÊNCIA
-- - ALTER FUNCTION ... SET search_path é idempotente
-- - DROP POLICY IF EXISTS é idempotente
-- =============================================================================

BEGIN;

-- ── 1) ALTER FUNCTION ... SET search_path ──────────────────────────────────
ALTER FUNCTION public.contract_templates_set_updated_at()                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_compact_stage_positions(p_stage_id uuid, p_exclude_lead_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_set_updated_at()                                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_shift_stage_positions(p_stage_id uuid, p_threshold integer, p_exclude_lead_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_update_lead_last_activity()                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.current_ngp_session_token()                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.feedback_set_updated_at()                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.tasks_set_updated_at()                                               SET search_path = public, pg_temp;

-- ── 2) Buckets — remover SELECT amplo ──────────────────────────────────────
-- App usa getPublicUrl/uploadToSignedUrl, ambos não dependem destas policies.
-- URL pública (/storage/v1/object/public/...) continua funcionando.
DROP POLICY IF EXISTS "Leitura publica avatars 1oj01fe_0" ON storage.objects;
DROP POLICY IF EXISTS "trackeamento_form_assets_public_read" ON storage.objects;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO
--
-- 1) Funções com search_path setado:
--    SELECT proname, proconfig FROM pg_proc
--    WHERE pronamespace='public'::regnamespace
--      AND proname IN ('contract_templates_set_updated_at','crm_compact_stage_positions',
--                      'crm_set_updated_at','crm_shift_stage_positions','crm_update_lead_last_activity',
--                      'current_ngp_session_token','feedback_set_updated_at','tasks_set_updated_at');
--    -- esperado: proconfig contém 'search_path=public, pg_temp'
--
-- 2) Policies de bucket removidas:
--    SELECT policyname FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND policyname IN ('Leitura publica avatars 1oj01fe_0','trackeamento_form_assets_public_read');
--    -- esperado: 0 linhas
--
-- 3) Pentest:
--    POST /storage/v1/object/list/avatars com anon → []
--    GET /storage/v1/object/public/avatars/<file> → continua funcionando (URL pública não usa policy)
-- =============================================================================
-- ROLLBACK COMPLETO
--
-- BEGIN;
--
-- ALTER FUNCTION public.contract_templates_set_updated_at()                                  RESET search_path;
-- ALTER FUNCTION public.crm_compact_stage_positions(p_stage_id uuid, p_exclude_lead_id uuid) RESET search_path;
-- ALTER FUNCTION public.crm_set_updated_at()                                                 RESET search_path;
-- ALTER FUNCTION public.crm_shift_stage_positions(p_stage_id uuid, p_threshold integer, p_exclude_lead_id uuid) RESET search_path;
-- ALTER FUNCTION public.crm_update_lead_last_activity()                                      RESET search_path;
-- ALTER FUNCTION public.current_ngp_session_token()                                          RESET search_path;
-- ALTER FUNCTION public.feedback_set_updated_at()                                            RESET search_path;
-- ALTER FUNCTION public.tasks_set_updated_at()                                               RESET search_path;
--
-- CREATE POLICY "Leitura publica avatars 1oj01fe_0" ON storage.objects
--   FOR SELECT TO public USING (bucket_id = 'avatars');
-- CREATE POLICY "trackeamento_form_assets_public_read" ON storage.objects
--   FOR SELECT TO anon, authenticated USING (bucket_id = 'trackeamento-form-assets');
--
-- COMMIT;
-- =============================================================================
