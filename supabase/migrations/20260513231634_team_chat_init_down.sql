-- ============================================================================
-- ROLLBACK do módulo team_chat
-- USO MANUAL apenas (não aplicar automaticamente)
-- ============================================================================
-- Para executar:
--   1. Confirmar que ninguém está usando o chat
--   2. Fazer backup do banco
--   3. Rodar este arquivo manualmente via psql ou Supabase SQL Editor
--   4. Remover/arquivar a migration UP correspondente
-- ============================================================================

BEGIN;

-- Tabelas (CASCADE remove policies e índices junto)
DROP TABLE IF EXISTS public.team_chat_attachments       CASCADE;
DROP TABLE IF EXISTS public.team_chat_reads             CASCADE;
DROP TABLE IF EXISTS public.team_chat_messages          CASCADE;
DROP TABLE IF EXISTS public.team_chat_channel_members   CASCADE;
DROP TABLE IF EXISTS public.team_chat_channels          CASCADE;

-- Funções helper
DROP FUNCTION IF EXISTS public.team_chat_can_access_channel(uuid);
DROP FUNCTION IF EXISTS public.team_chat_is_general_member(uuid);
DROP FUNCTION IF EXISTS public.team_chat_is_internal_user();
DROP FUNCTION IF EXISTS public.team_chat_is_admin();
DROP FUNCTION IF EXISTS public.team_chat_set_updated_at();

COMMIT;
