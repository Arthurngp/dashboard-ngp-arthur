-- DM 1:1.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_channels_type_check'
             AND conrelid = 'public.team_chat_channels'::regclass) THEN
    ALTER TABLE public.team_chat_channels DROP CONSTRAINT team_chat_channels_type_check;
  END IF;
END $$;

ALTER TABLE public.team_chat_channels
  ADD CONSTRAINT team_chat_channels_type_check
  CHECK (type IN ('general', 'client', 'dm'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_channels_type_consistency'
             AND conrelid = 'public.team_chat_channels'::regclass) THEN
    ALTER TABLE public.team_chat_channels DROP CONSTRAINT team_chat_channels_type_consistency;
  END IF;
END $$;

ALTER TABLE public.team_chat_channels
  ADD CONSTRAINT team_chat_channels_type_consistency
  CHECK (
    (type = 'general' AND cliente_id IS NULL)
    OR (type = 'client'  AND cliente_id IS NOT NULL)
    OR (type = 'dm'      AND cliente_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS public.team_chat_dms (
  channel_id  uuid PRIMARY KEY REFERENCES public.team_chat_channels(id) ON DELETE CASCADE,
  user_a_id   uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  user_b_id   uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_chat_dms_pair_ordered CHECK (user_a_id < user_b_id),
  CONSTRAINT team_chat_dms_pair_unique UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS team_chat_dms_user_a_idx ON public.team_chat_dms (user_a_id);
CREATE INDEX IF NOT EXISTS team_chat_dms_user_b_idx ON public.team_chat_dms (user_b_id);

ALTER TABLE public.team_chat_dms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_dms FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_chat_dms_select ON public.team_chat_dms;
CREATE POLICY team_chat_dms_select
  ON public.team_chat_dms FOR SELECT
  USING (
    user_a_id = public.current_ngp_user_id()
    OR user_b_id = public.current_ngp_user_id()
  );

CREATE OR REPLACE FUNCTION public.team_chat_can_access_channel(target_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_chat_channels c
    WHERE c.id = target_channel_id AND c.arquivado_em IS NULL AND (
      (c.type = 'client'  AND public.team_chat_is_internal_user())
      OR (c.type = 'general' AND c.is_private = false AND public.team_chat_is_internal_user())
      OR (c.type = 'general' AND c.is_private = true  AND public.team_chat_is_general_member(c.id))
      OR (c.type = 'dm' AND EXISTS (
        SELECT 1 FROM public.team_chat_dms d
        WHERE d.channel_id = c.id
          AND (d.user_a_id = public.current_ngp_user_id() OR d.user_b_id = public.current_ngp_user_id())
      ))
    )
  );
$$;

DROP POLICY IF EXISTS team_chat_channels_select ON public.team_chat_channels;
CREATE POLICY team_chat_channels_select
  ON public.team_chat_channels FOR SELECT
  USING (
    arquivado_em IS NULL AND (
      (type = 'client'  AND public.team_chat_is_internal_user())
      OR (type = 'general' AND is_private = false AND public.team_chat_is_internal_user())
      OR (type = 'general' AND is_private = true  AND public.team_chat_is_general_member(id))
      OR (type = 'dm' AND EXISTS (
        SELECT 1 FROM public.team_chat_dms d
        WHERE d.channel_id = team_chat_channels.id
          AND (d.user_a_id = public.current_ngp_user_id() OR d.user_b_id = public.current_ngp_user_id())
      ))
    )
  );

CREATE OR REPLACE FUNCTION public.team_chat_open_dm(other_usuario_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_id uuid; user_a uuid; user_b uuid; existing_channel uuid; new_channel uuid; other_nome text;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.team_chat_is_internal_user() THEN
    RAISE EXCEPTION 'Apenas equipe interna pode iniciar DMs';
  END IF;
  IF caller_id = other_usuario_id THEN
    RAISE EXCEPTION 'Não dá pra mandar DM pra si mesmo';
  END IF;

  SELECT u.nome INTO other_nome
  FROM public.usuarios u
  WHERE u.id = other_usuario_id
    AND COALESCE(u.ativo, true) = true AND u.archived_at IS NULL
    AND u.role IN ('admin', 'ngp')
    AND lower(u.email) LIKE '%@sejangp.com.br';

  IF other_nome IS NULL THEN RAISE EXCEPTION 'Usuário inválido para DM'; END IF;

  IF caller_id < other_usuario_id THEN
    user_a := caller_id; user_b := other_usuario_id;
  ELSE
    user_a := other_usuario_id; user_b := caller_id;
  END IF;

  SELECT channel_id INTO existing_channel
  FROM public.team_chat_dms WHERE user_a_id = user_a AND user_b_id = user_b;
  IF existing_channel IS NOT NULL THEN RETURN existing_channel; END IF;

  INSERT INTO public.team_chat_channels (type, nome, is_private, criado_por)
  VALUES ('dm', other_nome, true, caller_id)
  RETURNING id INTO new_channel;

  INSERT INTO public.team_chat_dms (channel_id, user_a_id, user_b_id)
  VALUES (new_channel, user_a, user_b);

  RETURN new_channel;
END; $$;
REVOKE ALL ON FUNCTION public.team_chat_open_dm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_open_dm(uuid) TO anon, authenticated, service_role;
