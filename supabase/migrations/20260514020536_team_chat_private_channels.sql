-- Suporte a canais privados (só convidados acessam).
-- Aplica-se a canais type='general' (canais 'client' permanecem abertos a toda equipe interna).

ALTER TABLE public.team_chat_channels
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS team_chat_channels_private_idx
  ON public.team_chat_channels (is_private, type);

CREATE OR REPLACE FUNCTION public.team_chat_is_public_general(target_channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_chat_channels
    WHERE id = target_channel_id
      AND type = 'general'
      AND is_private = false
      AND arquivado_em IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.team_chat_is_public_general(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_is_public_general(uuid) TO anon, authenticated, service_role;

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
        (c.type = 'general' AND c.is_private = false AND public.team_chat_is_internal_user())
        OR
        (c.type = 'general' AND c.is_private = true  AND public.team_chat_is_general_member(c.id))
      )
  );
$$;

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
        (type = 'general' AND is_private = false AND public.team_chat_is_internal_user())
        OR
        (type = 'general' AND is_private = true  AND public.team_chat_is_general_member(id))
      )
    )
  );

CREATE OR REPLACE FUNCTION public.team_chat_create_general_channel(
  channel_nome text,
  channel_slug text,
  channel_descricao text,
  channel_is_private boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  new_id uuid;
  clean_slug text;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.team_chat_is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem criar canais';
  END IF;

  clean_slug := lower(regexp_replace(coalesce(channel_slug, channel_nome), '[^a-z0-9-]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  IF clean_slug = '' THEN
    RAISE EXCEPTION 'Slug inválido';
  END IF;

  IF EXISTS (SELECT 1 FROM public.team_chat_channels WHERE type='general' AND slug=clean_slug) THEN
    RAISE EXCEPTION 'Já existe um canal com esse slug: %', clean_slug;
  END IF;

  INSERT INTO public.team_chat_channels (type, nome, slug, descricao, is_private, criado_por)
  VALUES ('general', trim(channel_nome), clean_slug, channel_descricao, coalesce(channel_is_private, false), caller_id)
  RETURNING id INTO new_id;

  INSERT INTO public.team_chat_channel_members (channel_id, usuario_id, role)
  VALUES (new_id, caller_id, 'admin')
  ON CONFLICT DO NOTHING;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_create_general_channel(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_create_general_channel(text, text, text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_chat_invite_member(
  target_channel_id uuid,
  target_usuario_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.team_chat_is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.team_chat_channel_members
    WHERE channel_id = target_channel_id
      AND usuario_id = caller_id
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Sem permissão para convidar neste canal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = target_usuario_id
      AND COALESCE(ativo, true) = true
      AND archived_at IS NULL
      AND role IN ('admin', 'ngp')
      AND lower(email) LIKE '%@sejangp.com.br'
  ) THEN
    RAISE EXCEPTION 'Usuário inválido para o chat interno';
  END IF;

  INSERT INTO public.team_chat_channel_members (channel_id, usuario_id, role)
  VALUES (target_channel_id, target_usuario_id, 'member')
  ON CONFLICT (channel_id, usuario_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_invite_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_invite_member(uuid, uuid) TO anon, authenticated, service_role;
