-- =============================================================================
-- Migration: RLS crítico - Fase 1
-- Data: 2026-05-09
-- Autor: revisão de segurança
-- =============================================================================
--
-- OBJETIVO
-- Fechar 4 tabelas que hoje estão expostas via PostgREST (anon key) com leitura
-- e escrita liberadas. Todas as 4 são acessadas exclusivamente por edge
-- functions (service_role), portanto habilitar RLS sem criar policies não
-- quebra nenhum fluxo do app — service_role bypassa RLS por padrão.
--
-- AUDITORIA DE USO (verificada em 2026-05-09)
--   - api_tokens             → supabase/functions/admin-api-tokens, _shared/api_tokens
--   - api_token_audit_logs   → supabase/functions/financeiro-openclaw
--   - fin_agent_runs         → supabase/functions/financeiro-agent
--   - cliente_portal_acessos → supabase/functions/cliente-portal-access,
--                              admin-listar-clientes-central,
--                              admin-upsert-cliente-central
--
-- IMPACTO ESPERADO
--   ✅ Edge functions continuam funcionando (usam service_role).
--   ✅ Anon key (client) deixa de conseguir ler/escrever nestas 4 tabelas.
--   ⚠️  Se algum código no client (lib/ ou app/) começar a falhar com erro
--       "new row violates row-level security policy" ou retornar [] vazio,
--       é porque alguém adicionou um acesso direto que não foi mapeado.
--       Nesse caso, ou (a) mover o acesso para uma edge function, ou
--       (b) criar policy específica.
--
-- ROLLBACK (caso necessário)
--   ALTER TABLE public.api_tokens             DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.api_token_audit_logs   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.fin_agent_runs         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.cliente_portal_acessos DISABLE ROW LEVEL SECURITY;
--
-- IDEMPOTÊNCIA
--   Os ALTER TABLE são idempotentes (rodar 2x não quebra).
-- =============================================================================

BEGIN;

-- 1) api_tokens
--    Conteúdo sensível: token_hash, scopes, last_used_ip
ALTER TABLE public.api_tokens
  ENABLE ROW LEVEL SECURITY;

-- 2) api_token_audit_logs
--    Conteúdo sensível: request_payload e response_payload em JSONB,
--    podem conter qualquer dado da API.
ALTER TABLE public.api_token_audit_logs
  ENABLE ROW LEVEL SECURITY;

-- 3) fin_agent_runs
--    Conteúdo sensível: snapshot financeiro completo + resposta da IA em JSONB.
--    Esta é a IA Analista do setor financeiro.
ALTER TABLE public.fin_agent_runs
  ENABLE ROW LEVEL SECURITY;

-- 4) cliente_portal_acessos
--    Conteúdo sensível: flags de acesso (analytics, reports, crm) por usuário.
ALTER TABLE public.cliente_portal_acessos
  ENABLE ROW LEVEL SECURITY;

COMMIT;

-- =============================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO
-- Rodar após o COMMIT para confirmar:
--
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace
--   AND relname IN ('api_tokens','api_token_audit_logs','fin_agent_runs','cliente_portal_acessos');
--
-- Esperado: relrowsecurity = true para as 4 linhas.
-- =============================================================================
