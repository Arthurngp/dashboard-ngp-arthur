-- Menções @nome dentro de mensagens.
-- mention_target = 'user' (usuario_id setado) | 'all' | 'here'
CREATE TABLE IF NOT EXISTS public.team_chat_message_mentions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid NOT NULL REFERENCES public.team_chat_messages(id) ON DELETE CASCADE,
  mention_type  text NOT NULL CHECK (mention_type IN ('user','all','here')),
  usuario_id    uuid REFERENCES public.usuarios(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_chat_mentions_user_when_type_user
    CHECK (
      (mention_type = 'user' AND usuario_id IS NOT NULL)
      OR (mention_type IN ('all','here') AND usuario_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS team_chat_mentions_message_idx
  ON public.team_chat_message_mentions (message_id);

CREATE INDEX IF NOT EXISTS team_chat_mentions_user_idx
  ON public.team_chat_message_mentions (usuario_id, created_at DESC)
  WHERE usuario_id IS NOT NULL;

ALTER TABLE public.team_chat_message_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_message_mentions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_chat_mentions_select ON public.team_chat_message_mentions;
CREATE POLICY team_chat_mentions_select
  ON public.team_chat_message_mentions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_chat_messages m
      WHERE m.id = team_chat_message_mentions.message_id
        AND m.deleted_at IS NULL
        AND public.team_chat_can_access_channel(m.channel_id)
    )
  );

DROP POLICY IF EXISTS team_chat_mentions_insert ON public.team_chat_message_mentions;
CREATE POLICY team_chat_mentions_insert
  ON public.team_chat_message_mentions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_chat_messages m
      WHERE m.id = team_chat_message_mentions.message_id
        AND m.autor_usuario_id = public.current_ngp_user_id()
    )
  );

CREATE OR REPLACE FUNCTION public.team_chat_list_mentionable(target_channel_id uuid)
RETURNS TABLE (id uuid, nome text, email text, username text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ctype text;
  cprivate boolean;
BEGIN
  IF NOT public.team_chat_can_access_channel(target_channel_id) THEN
    RETURN;
  END IF;

  SELECT c.type, c.is_private INTO ctype, cprivate
  FROM public.team_chat_channels c WHERE c.id = target_channel_id;

  IF ctype IN ('client') OR (ctype = 'general' AND cprivate = false) THEN
    RETURN QUERY
      SELECT u.id, u.nome, u.email, u.username
      FROM public.usuarios u
      WHERE COALESCE(u.ativo, true) = true
        AND u.archived_at IS NULL
        AND u.role IN ('admin','ngp')
        AND lower(u.email) LIKE '%@sejangp.com.br'
      ORDER BY u.nome;
  ELSIF ctype = 'general' AND cprivate = true THEN
    RETURN QUERY
      SELECT u.id, u.nome, u.email, u.username
      FROM public.team_chat_channel_members m
      JOIN public.usuarios u ON u.id = m.usuario_id
      WHERE m.channel_id = target_channel_id
        AND COALESCE(u.ativo, true) = true
        AND u.archived_at IS NULL
      ORDER BY u.nome;
  ELSIF ctype = 'dm' THEN
    RETURN QUERY
      SELECT u.id, u.nome, u.email, u.username
      FROM public.team_chat_dms d
      JOIN public.usuarios u ON (u.id = d.user_a_id OR u.id = d.user_b_id)
      WHERE d.channel_id = target_channel_id
        AND u.id <> public.current_ngp_user_id()
      ORDER BY u.nome;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_list_mentionable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_list_mentionable(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_chat_my_unread_mentions()
RETURNS TABLE (channel_id uuid, mention_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.channel_id, count(*)::bigint
  FROM public.team_chat_message_mentions men
  JOIN public.team_chat_messages m ON m.id = men.message_id
  LEFT JOIN public.team_chat_reads r
    ON r.channel_id = m.channel_id AND r.usuario_id = public.current_ngp_user_id()
  WHERE m.deleted_at IS NULL
    AND (
      (men.mention_type = 'user' AND men.usuario_id = public.current_ngp_user_id())
      OR men.mention_type IN ('all','here')
    )
    AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
    AND m.autor_usuario_id IS DISTINCT FROM public.current_ngp_user_id()
  GROUP BY m.channel_id;
$$;

REVOKE ALL ON FUNCTION public.team_chat_my_unread_mentions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_my_unread_mentions() TO anon, authenticated, service_role;
