-- =============================================================================
-- Migration: RLS crítico - Fase 2A (drop policies permissivas em tabelas
--                                  acessadas APENAS por edge functions)
-- Data: 2026-05-09
-- Autor: revisão de segurança
-- =============================================================================
--
-- OBJETIVO
-- Remover policies que efetivamente bypassam RLS (USING(true) / WITH CHECK(true))
-- concedidas a anon/authenticated em 7 tabelas. Após o drop, as tabelas ficam
-- com RLS habilitado mas só acessíveis por service_role (edge functions).
--
-- AUDITORIA DE USO (verificada em 2026-05-09 com grep em lib/, app/, supabase/functions/)
--
--   clientes              → 0 chamadas /rest/v1/ no client; usado por
--                           várias edge functions; tem policy 'service_role full access'
--   crm_leads             → 0 chamadas no client; edge functions: crm-manage-pipeline,
--                           crm-manage-leads, crm-ai-advisor, crm-manage-stages
--   crm_pipelines         → 0 chamadas no client; edge functions: crm-manage-tasks,
--                           crm-manage-pipeline, admin-listar-clientes-central,
--                           admin-upsert-cliente-central
--   crm_pipeline_stages   → 0 chamadas no client; edge functions: crm-manage-pipeline,
--                           crm-manage-leads, crm-manage-stages, admin-upsert-cliente-central
--   crm_pipeline_fields   → 0 chamadas no client; edge functions: crm-manage-fields,
--                           crm-manage-pipeline
--   crm_b2b               → 0 linhas, 0 chamadas em qualquer lugar (tabela morta)
--   crm_funil_principal   → 0 linhas, 0 chamadas em qualquer lugar (tabela morta)
--
-- IMPACTO ESPERADO
--   ✅ Edge functions continuam funcionando (service_role bypassa RLS).
--   ✅ Anon/authenticated deixa de ler/escrever via /rest/v1/ direto.
--   ⚠️ Se algum código no client começar a falhar com {"code":"42501",...}
--      ou retornar listas vazias, é porque há acesso direto não mapeado.
--      Reverter a policy específica e mover o acesso para edge function.
--
-- ROLLBACK (no rodapé do arquivo)
--
-- IDEMPOTÊNCIA
--   `DROP POLICY IF EXISTS` é idempotente.
-- =============================================================================

BEGIN;

-- ── clientes ──────────────────────────────────────────────────────────────
-- Mantém policies 'service_role clientes' e 'service_role full access clientes'.
DROP POLICY IF EXISTS "allow_insert_clientes" ON public.clientes;
DROP POLICY IF EXISTS "allow_select_clientes" ON public.clientes;
DROP POLICY IF EXISTS "allow_update_clientes" ON public.clientes;

-- ── crm_leads ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "crm_leads_all" ON public.crm_leads;

-- ── crm_pipelines ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "crm_pipelines_all" ON public.crm_pipelines;

-- ── crm_pipeline_stages ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "crm_pipeline_stages_all" ON public.crm_pipeline_stages;

-- ── crm_pipeline_fields ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Enable read access for authenticated users on crm_pipeline_fiel" ON public.crm_pipeline_fields;
DROP POLICY IF EXISTS "Enable write access for authenticated users on crm_pipeline_fie" ON public.crm_pipeline_fields;

-- ── crm_b2b (tabela vazia, abandonada) ────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.crm_b2b;

-- ── crm_funil_principal (tabela vazia, abandonada) ────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.crm_funil_principal;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO
--
-- 1) Confirmar que nenhuma policy permissiva sobrou para anon/authenticated:
--
-- SELECT tablename, policyname, roles, qual::text, with_check::text
-- FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('clientes','crm_leads','crm_pipelines','crm_pipeline_stages',
--                     'crm_pipeline_fields','crm_b2b','crm_funil_principal')
--   AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles));
--
-- Esperado: 0 linhas.
--
-- 2) Pentest read-only com anon key:
--    GET /rest/v1/clientes?select=*&limit=1 → []
--    GET /rest/v1/crm_leads?select=*&limit=1 → []
--    ... etc para as 7 tabelas
--
-- =============================================================================
-- ROLLBACK COMPLETO (caso necessário)
--
-- BEGIN;
--
-- CREATE POLICY "allow_insert_clientes" ON public.clientes
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "allow_select_clientes" ON public.clientes
--   FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "allow_update_clientes" ON public.clientes
--   FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
--
-- CREATE POLICY "crm_leads_all" ON public.crm_leads
--   FOR ALL TO anon USING (true) WITH CHECK (true);
--
-- CREATE POLICY "crm_pipelines_all" ON public.crm_pipelines
--   FOR ALL TO anon USING (true) WITH CHECK (true);
--
-- CREATE POLICY "crm_pipeline_stages_all" ON public.crm_pipeline_stages
--   FOR ALL TO anon USING (true) WITH CHECK (true);
--
-- CREATE POLICY "Enable read access for authenticated users on crm_pipeline_fiel"
--   ON public.crm_pipeline_fields
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Enable write access for authenticated users on crm_pipeline_fie"
--   ON public.crm_pipeline_fields
--   FOR ALL TO authenticated USING (true);
--
-- CREATE POLICY "Allow all for authenticated" ON public.crm_b2b
--   FOR ALL TO authenticated USING (true);
-- CREATE POLICY "Allow all for authenticated" ON public.crm_funil_principal
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
--
-- COMMIT;
-- =============================================================================
