-- ============================================================================
-- Módulo: NGP Copilot — Conversa por cliente (Fase 0 do PRD)
-- Escopo: copilot_conversations + copilot_messages + copilot_attachments
-- Decisão: schema dedicado (não reusa team_chat) porque:
--   - autor pode ser humano OU agente IA (team_chat só tem humano)
--   - tipos de mensagem incluem agent_proposal/agent_analysis/agent_alert
--   - RLS pode divergir no futuro (níveis de autonomia por cliente)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. copilot_conversations
--    1 conversa por cliente. Pode-se evoluir pra N futuramente (canal por
--    plataforma/projeto), mas no MVP é unique(client_id).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copilot_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid,
  client_id       uuid NOT NULL UNIQUE REFERENCES public.clientes(id) ON DELETE CASCADE,
  titulo          text NOT NULL DEFAULT 'Conversa com NGP Copilot',
  arquivado_em    timestamptz,
  created_by      uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS copilot_conversations_workspace_idx
  ON public.copilot_conversations (workspace_id);

-- ----------------------------------------------------------------------------
-- 2. copilot_messages
--    role: quem produziu a mensagem
--      'user'           -> humano do time NGP
--      'agent'          -> o NGP Copilot (IA)
--      'system'         -> evento (entrou novo dado, profile foi atualizado)
--
--    kind: forma da mensagem (afeta renderização no front)
--      'text'              -> texto livre
--      'agent_proposal'    -> card de proposta (campanha, alteração)
--      'agent_analysis'    -> card de análise (comparativa, métricas)
--      'agent_alert'       -> aviso/risco
--      'agent_checklist'   -> lista de itens acionáveis
--      'memory_update'     -> notificação de atualização de profile
--
--    payload_json: corpo estruturado quando kind != 'text'
--    client_generated_id: idempotência no envio
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copilot_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid,
  conversation_id       uuid NOT NULL REFERENCES public.copilot_conversations(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,

  role                  text NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  kind                  text NOT NULL DEFAULT 'text'
                        CHECK (kind IN (
                          'text',
                          'agent_proposal',
                          'agent_analysis',
                          'agent_alert',
                          'agent_checklist',
                          'memory_update'
                        )),
  texto                 text,
  payload_json          jsonb,

  -- Quando role='user', referencia o usuário
  autor_usuario_id      uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  -- Quando role='agent', registra qual modelo respondeu
  agent_model           text,
  agent_run_id          text,

  -- Idempotência (front gera UUID antes de mandar)
  client_generated_id   uuid,
  reply_to_message_id   uuid REFERENCES public.copilot_messages(id) ON DELETE SET NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- Idempotência: mesmo client_generated_id não duplica por conversa
CREATE UNIQUE INDEX IF NOT EXISTS copilot_messages_idempotency_idx
  ON public.copilot_messages (conversation_id, autor_usuario_id, client_generated_id)
  WHERE client_generated_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS copilot_messages_conversation_created_idx
  ON public.copilot_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS copilot_messages_client_created_idx
  ON public.copilot_messages (client_id, created_at DESC);

-- Full-text PT-BR para busca no histórico (5ª camada de contexto)
CREATE INDEX IF NOT EXISTS copilot_messages_fts_idx
  ON public.copilot_messages
  USING GIN (to_tsvector('portuguese', coalesce(texto, '')))
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. copilot_attachments
--    Ligação leve mensagem→arquivo. A inteligência extraída por tipo fica
--    em campaign_assets (migration #14, próxima). Aqui só persistimos o
--    arquivo bruto.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copilot_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid,
  message_id        uuid NOT NULL REFERENCES public.copilot_messages(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,

  storage_provider  text NOT NULL DEFAULT 'supabase'
                    CHECK (storage_provider IN ('supabase', 'external_link')),
  storage_path      text NOT NULL,
  file_name         text NOT NULL,
  mime_type         text,
  file_size_bytes   bigint,

  -- Quando o asset-ingest extrair conteúdo, popula campaign_assets.id aqui
  asset_id          uuid,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS copilot_attachments_message_idx
  ON public.copilot_attachments (message_id);

CREATE INDEX IF NOT EXISTS copilot_attachments_client_idx
  ON public.copilot_attachments (client_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Triggers updated_at
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS copilot_conversations_updated_at ON public.copilot_conversations;
CREATE TRIGGER copilot_conversations_updated_at
  BEFORE UPDATE ON public.copilot_conversations
  FOR EACH ROW EXECUTE FUNCTION public.copilot_set_updated_at();

DROP TRIGGER IF EXISTS copilot_messages_updated_at ON public.copilot_messages;
CREATE TRIGGER copilot_messages_updated_at
  BEFORE UPDATE ON public.copilot_messages
  FOR EACH ROW EXECUTE FUNCTION public.copilot_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Storage bucket privado pros anexos do Copilot
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('copilot-assets-private', 'copilot-assets-private', false)
ON CONFLICT (id) DO NOTHING;

-- Policies do bucket: só equipe NGP (admin/ngp) acessa via signed URL gerada
-- no backend. Sem upload/select direto pelo cliente sem service_role.
DROP POLICY IF EXISTS "ngp_read_copilot_assets" ON storage.objects;
CREATE POLICY "ngp_read_copilot_assets"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'copilot-assets-private'
    AND public.current_ngp_user_id() IS NOT NULL
  );

DROP POLICY IF EXISTS "ngp_insert_copilot_assets" ON storage.objects;
CREATE POLICY "ngp_insert_copilot_assets"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'copilot-assets-private'
    AND public.current_ngp_user_id() IS NOT NULL
  );

-- ----------------------------------------------------------------------------
-- 6. RLS nas tabelas
-- ----------------------------------------------------------------------------
ALTER TABLE public.copilot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_conversations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.copilot_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE public.copilot_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ngp_all_copilot_conversations" ON public.copilot_conversations;
CREATE POLICY "ngp_all_copilot_conversations"
  ON public.copilot_conversations FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

DROP POLICY IF EXISTS "ngp_all_copilot_messages" ON public.copilot_messages;
CREATE POLICY "ngp_all_copilot_messages"
  ON public.copilot_messages FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

DROP POLICY IF EXISTS "ngp_all_copilot_attachments" ON public.copilot_attachments;
CREATE POLICY "ngp_all_copilot_attachments"
  ON public.copilot_attachments FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

COMMIT;
