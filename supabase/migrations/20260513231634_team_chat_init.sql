-- ============================================================================
-- Módulo: Chat interno NGP (team_chat)
-- Escopo: comunicação interna entre equipe NGP, com canais gerais e por cliente
-- Isolamento: prefixo team_chat_*, nenhuma tabela existente é alterada
-- Auth: usa public.current_ngp_user_id() (header x-session-token)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. team_chat_channels
--    type='general' -> canal aberto da equipe (#geral, #trafego, etc)
--    type='client'  -> canal de um cliente específico (cliente_id obrigatório)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_chat_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL CHECK (type IN ('general', 'client')),
  nome          text NOT NULL,
  slug          text,
  cliente_id    uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  criado_por    uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  descricao     text,
  arquivado_em  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_chat_channels_type_consistency
    CHECK (
      (type = 'general' AND cliente_id IS NULL)
      OR
      (type = 'client'  AND cliente_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS team_chat_channels_cliente_unique
  ON public.team_chat_channels (cliente_id)
  WHERE type = 'client';

CREATE UNIQUE INDEX IF NOT EXISTS team_chat_channels_general_slug_unique
  ON public.team_chat_channels (slug)
  WHERE type = 'general' AND slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS team_chat_channels_type_idx
  ON public.team_chat_channels (type, arquivado_em);

-- ----------------------------------------------------------------------------
-- 2. team_chat_channel_members
--    Só usado para canais 'general' (canais 'client' são acessíveis por toda
--    equipe interna via RLS). Mantemos a tabela genérica caso queiramos
--    restringir canais por cliente no futuro.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_chat_channel_members (
  channel_id   uuid NOT NULL REFERENCES public.team_chat_channels(id) ON DELETE CASCADE,
  usuario_id   uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (channel_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS team_chat_channel_members_user_idx
  ON public.team_chat_channel_members (usuario_id);

-- ----------------------------------------------------------------------------
-- 3. team_chat_messages
--    client_generated_id: UUID gerado no front pra idempotência
--    tipo:
--      'text'      -> só texto
--      'file'      -> só anexo
--      'text_file' -> texto + anexo
--      'system'    -> evento do sistema (entrou, saiu, arquivou)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_chat_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id            uuid NOT NULL REFERENCES public.team_chat_channels(id) ON DELETE CASCADE,
  autor_usuario_id      uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  client_generated_id   uuid NOT NULL,
  tipo                  text NOT NULL DEFAULT 'text' CHECK (tipo IN ('text', 'file', 'text_file', 'system')),
  texto                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- idempotência: mesma combinação não duplica
CREATE UNIQUE INDEX IF NOT EXISTS team_chat_messages_idempotency_idx
  ON public.team_chat_messages (channel_id, autor_usuario_id, client_generated_id);

-- paginação por canal em ordem cronológica reversa
CREATE INDEX IF NOT EXISTS team_chat_messages_channel_created_idx
  ON public.team_chat_messages (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS team_chat_messages_autor_idx
  ON public.team_chat_messages (autor_usuario_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. team_chat_attachments
--    storage_provider:
--      'supabase'    -> arquivo no bucket privado team-chat-attachments
--      'gdrive_link' -> link manual do Google Drive (acima de 50MB)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_chat_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        uuid NOT NULL REFERENCES public.team_chat_messages(id) ON DELETE CASCADE,
  storage_provider  text NOT NULL CHECK (storage_provider IN ('supabase', 'gdrive_link')),
  storage_path      text NOT NULL,
  file_name         text NOT NULL,
  mime_type         text,
  file_size_bytes   bigint,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_chat_attachments_message_idx
  ON public.team_chat_attachments (message_id);

-- ----------------------------------------------------------------------------
-- 5. team_chat_reads
--    Marca até onde cada usuário leu em cada canal
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_chat_reads (
  channel_id     uuid NOT NULL REFERENCES public.team_chat_channels(id) ON DELETE CASCADE,
  usuario_id     uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  last_read_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (channel_id, usuario_id)
);

-- ============================================================================
-- Trigger: atualizar updated_at em messages e channels
-- ============================================================================
CREATE OR REPLACE FUNCTION public.team_chat_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_chat_channels_set_updated_at ON public.team_chat_channels;
CREATE TRIGGER team_chat_channels_set_updated_at
  BEFORE UPDATE ON public.team_chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.team_chat_set_updated_at();

DROP TRIGGER IF EXISTS team_chat_messages_set_updated_at ON public.team_chat_messages;
CREATE TRIGGER team_chat_messages_set_updated_at
  BEFORE UPDATE ON public.team_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.team_chat_set_updated_at();

-- ============================================================================
-- Funções helper de autorização (SECURITY DEFINER)
-- ============================================================================

-- Verifica se o usuário atual é membro de um canal 'general'
CREATE OR REPLACE FUNCTION public.team_chat_is_general_member(target_channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_chat_channel_members m
    WHERE m.channel_id = target_channel_id
      AND m.usuario_id = public.current_ngp_user_id()
  );
$$;

REVOKE ALL ON FUNCTION public.team_chat_is_general_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_is_general_member(uuid) TO anon, authenticated, service_role;

-- Verifica se o usuário atual pertence à equipe interna NGP
CREATE OR REPLACE FUNCTION public.team_chat_is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = public.current_ngp_user_id()
      AND COALESCE(u.ativo, true) = true
      AND u.archived_at IS NULL
      AND u.role IN ('admin', 'ngp')
  );
$$;

REVOKE ALL ON FUNCTION public.team_chat_is_internal_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_is_internal_user() TO anon, authenticated, service_role;

-- Verifica se o usuário atual tem acesso ao canal (regra principal)
CREATE OR REPLACE FUNCTION public.team_chat_can_access_channel(target_channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_chat_channels c
    WHERE c.id = target_channel_id
      AND c.arquivado_em IS NULL
      AND (
        (c.type = 'client'  AND public.team_chat_is_internal_user())
        OR
        (c.type = 'general' AND public.team_chat_is_general_member(c.id))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.team_chat_can_access_channel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_can_access_channel(uuid) TO anon, authenticated, service_role;

-- Verifica se o usuário atual é admin do NGP Space
CREATE OR REPLACE FUNCTION public.team_chat_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = public.current_ngp_user_id()
      AND COALESCE(u.ativo, true) = true
      AND u.archived_at IS NULL
      AND u.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.team_chat_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_is_admin() TO anon, authenticated, service_role;

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE public.team_chat_channels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_channels         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_channel_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_channel_members  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_messages         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_attachments      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_reads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_reads            FORCE  ROW LEVEL SECURITY;

-- channels: SELECT
-- admin enxerga todos os canais (inclusive recém-criados antes do membership ser populado)
DROP POLICY IF EXISTS team_chat_channels_select ON public.team_chat_channels;
CREATE POLICY team_chat_channels_select
  ON public.team_chat_channels
  FOR SELECT
  USING (
    public.team_chat_is_admin()
    OR (
      arquivado_em IS NULL
      AND (
        (type = 'client'  AND public.team_chat_is_internal_user())
        OR
        (type = 'general' AND public.team_chat_is_general_member(id))
      )
    )
  );

-- channels: INSERT (só admin cria canal general; canal client é criado por admin ou via API trusted)
DROP POLICY IF EXISTS team_chat_channels_insert ON public.team_chat_channels;
CREATE POLICY team_chat_channels_insert
  ON public.team_chat_channels
  FOR INSERT
  WITH CHECK (
    public.team_chat_is_admin()
  );

-- channels: UPDATE (só admin)
DROP POLICY IF EXISTS team_chat_channels_update ON public.team_chat_channels;
CREATE POLICY team_chat_channels_update
  ON public.team_chat_channels
  FOR UPDATE
  USING (public.team_chat_is_admin())
  WITH CHECK (public.team_chat_is_admin());

-- members: SELECT (membros veem outros membros do mesmo canal)
DROP POLICY IF EXISTS team_chat_channel_members_select ON public.team_chat_channel_members;
CREATE POLICY team_chat_channel_members_select
  ON public.team_chat_channel_members
  FOR SELECT
  USING (
    public.team_chat_is_general_member(channel_id)
    OR public.team_chat_is_admin()
  );

-- members: INSERT (só admin)
DROP POLICY IF EXISTS team_chat_channel_members_insert ON public.team_chat_channel_members;
CREATE POLICY team_chat_channel_members_insert
  ON public.team_chat_channel_members
  FOR INSERT
  WITH CHECK (public.team_chat_is_admin());

-- members: DELETE (só admin)
DROP POLICY IF EXISTS team_chat_channel_members_delete ON public.team_chat_channel_members;
CREATE POLICY team_chat_channel_members_delete
  ON public.team_chat_channel_members
  FOR DELETE
  USING (public.team_chat_is_admin());

-- messages: SELECT (quem tem acesso ao canal)
DROP POLICY IF EXISTS team_chat_messages_select ON public.team_chat_messages;
CREATE POLICY team_chat_messages_select
  ON public.team_chat_messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND public.team_chat_can_access_channel(channel_id)
  );

-- messages: INSERT (autor = usuário atual + tem acesso ao canal)
DROP POLICY IF EXISTS team_chat_messages_insert ON public.team_chat_messages;
CREATE POLICY team_chat_messages_insert
  ON public.team_chat_messages
  FOR INSERT
  WITH CHECK (
    autor_usuario_id = public.current_ngp_user_id()
    AND public.team_chat_can_access_channel(channel_id)
  );

-- messages: UPDATE (só o próprio autor pode editar/marcar deletada)
DROP POLICY IF EXISTS team_chat_messages_update ON public.team_chat_messages;
CREATE POLICY team_chat_messages_update
  ON public.team_chat_messages
  FOR UPDATE
  USING (autor_usuario_id = public.current_ngp_user_id())
  WITH CHECK (autor_usuario_id = public.current_ngp_user_id());

-- attachments: SELECT (herda do canal via message)
DROP POLICY IF EXISTS team_chat_attachments_select ON public.team_chat_attachments;
CREATE POLICY team_chat_attachments_select
  ON public.team_chat_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_chat_messages m
      WHERE m.id = team_chat_attachments.message_id
        AND m.deleted_at IS NULL
        AND public.team_chat_can_access_channel(m.channel_id)
    )
  );

-- attachments: INSERT (anexo só pode ser criado em msg do próprio autor)
DROP POLICY IF EXISTS team_chat_attachments_insert ON public.team_chat_attachments;
CREATE POLICY team_chat_attachments_insert
  ON public.team_chat_attachments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.team_chat_messages m
      WHERE m.id = team_chat_attachments.message_id
        AND m.autor_usuario_id = public.current_ngp_user_id()
        AND public.team_chat_can_access_channel(m.channel_id)
    )
  );

-- reads: SELECT/INSERT/UPDATE (usuário só mexe na própria linha)
DROP POLICY IF EXISTS team_chat_reads_select ON public.team_chat_reads;
CREATE POLICY team_chat_reads_select
  ON public.team_chat_reads
  FOR SELECT
  USING (usuario_id = public.current_ngp_user_id());

DROP POLICY IF EXISTS team_chat_reads_insert ON public.team_chat_reads;
CREATE POLICY team_chat_reads_insert
  ON public.team_chat_reads
  FOR INSERT
  WITH CHECK (
    usuario_id = public.current_ngp_user_id()
    AND public.team_chat_can_access_channel(channel_id)
  );

DROP POLICY IF EXISTS team_chat_reads_update ON public.team_chat_reads;
CREATE POLICY team_chat_reads_update
  ON public.team_chat_reads
  FOR UPDATE
  USING (usuario_id = public.current_ngp_user_id())
  WITH CHECK (usuario_id = public.current_ngp_user_id());

COMMIT;

-- ============================================================================
-- Validações pós-migration (rodar manualmente após aplicar):
--   SELECT count(*) FROM public.team_chat_channels;        -- esperado: 0
--   SELECT count(*) FROM public.team_chat_messages;        -- esperado: 0
--   SELECT public.team_chat_is_internal_user();            -- depende sessão
--   \d public.team_chat_channels                           -- inspecionar
-- ============================================================================
