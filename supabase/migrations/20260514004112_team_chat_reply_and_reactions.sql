-- Reply to (citação estilo WhatsApp)
ALTER TABLE public.team_chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.team_chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_chat_messages_reply_to_idx
  ON public.team_chat_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.team_chat_reactions (
  message_id  uuid NOT NULL REFERENCES public.team_chat_messages(id) ON DELETE CASCADE,
  usuario_id  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  emoji       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, usuario_id, emoji)
);

CREATE INDEX IF NOT EXISTS team_chat_reactions_message_idx
  ON public.team_chat_reactions (message_id);

ALTER TABLE public.team_chat_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_reactions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_chat_reactions_select ON public.team_chat_reactions;
CREATE POLICY team_chat_reactions_select
  ON public.team_chat_reactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_chat_messages m
      WHERE m.id = team_chat_reactions.message_id
        AND m.deleted_at IS NULL
        AND public.team_chat_can_access_channel(m.channel_id)
    )
  );

DROP POLICY IF EXISTS team_chat_reactions_insert ON public.team_chat_reactions;
CREATE POLICY team_chat_reactions_insert
  ON public.team_chat_reactions
  FOR INSERT
  WITH CHECK (
    usuario_id = public.current_ngp_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.team_chat_messages m
      WHERE m.id = team_chat_reactions.message_id
        AND m.deleted_at IS NULL
        AND public.team_chat_can_access_channel(m.channel_id)
    )
  );

DROP POLICY IF EXISTS team_chat_reactions_delete ON public.team_chat_reactions;
CREATE POLICY team_chat_reactions_delete
  ON public.team_chat_reactions
  FOR DELETE
  USING (usuario_id = public.current_ngp_user_id());

CREATE OR REPLACE FUNCTION public.team_chat_get_reply_previews(message_ids uuid[])
RETURNS TABLE (
  id uuid,
  texto text,
  autor_usuario_id uuid,
  autor_nome text,
  deleted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.team_chat_is_internal_user() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      m.id,
      m.texto,
      m.autor_usuario_id,
      u.nome,
      m.deleted_at
    FROM public.team_chat_messages m
    LEFT JOIN public.usuarios u ON u.id = m.autor_usuario_id
    WHERE m.id = ANY(message_ids)
      AND public.team_chat_can_access_channel(m.channel_id);
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_get_reply_previews(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_get_reply_previews(uuid[]) TO anon, authenticated, service_role;
