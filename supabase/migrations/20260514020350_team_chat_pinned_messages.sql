-- Adiciona suporte a mensagens fixadas (pinned) por canal.
-- Limite de 5 fixadas por canal aplicado via RPC.

ALTER TABLE public.team_chat_messages
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_chat_messages_pinned_idx
  ON public.team_chat_messages (channel_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.team_chat_toggle_pin(target_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  msg_channel uuid;
  is_pinned boolean;
  pinned_count int;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT channel_id, pinned_at IS NOT NULL
    INTO msg_channel, is_pinned
  FROM public.team_chat_messages
  WHERE id = target_message_id AND deleted_at IS NULL;

  IF msg_channel IS NULL THEN
    RAISE EXCEPTION 'Mensagem não encontrada';
  END IF;

  IF NOT public.team_chat_can_access_channel(msg_channel) THEN
    RAISE EXCEPTION 'Sem acesso ao canal';
  END IF;

  IF is_pinned THEN
    UPDATE public.team_chat_messages
    SET pinned_at = NULL, pinned_by = NULL, updated_at = now()
    WHERE id = target_message_id;
    RETURN jsonb_build_object('pinned', false);
  ELSE
    SELECT count(*) INTO pinned_count
    FROM public.team_chat_messages
    WHERE channel_id = msg_channel AND pinned_at IS NOT NULL;

    IF pinned_count >= 5 THEN
      RAISE EXCEPTION 'Limite de 5 mensagens fixadas atingido. Desafixe uma antes.';
    END IF;

    UPDATE public.team_chat_messages
    SET pinned_at = now(), pinned_by = caller_id, updated_at = now()
    WHERE id = target_message_id;
    RETURN jsonb_build_object('pinned', true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_toggle_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_toggle_pin(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_chat_get_channel_links(target_channel_id uuid, limit_count int DEFAULT 100)
RETURNS TABLE (
  message_id uuid,
  url text,
  texto text,
  autor_usuario_id uuid,
  autor_nome text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.team_chat_can_access_channel(target_channel_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      m.id,
      (regexp_matches(m.texto, 'https?://[^\s]+', 'g'))[1] AS url,
      m.texto,
      m.autor_usuario_id,
      u.nome,
      m.created_at
    FROM public.team_chat_messages m
    LEFT JOIN public.usuarios u ON u.id = m.autor_usuario_id
    WHERE m.channel_id = target_channel_id
      AND m.deleted_at IS NULL
      AND m.texto IS NOT NULL
      AND m.texto ~ 'https?://'
    ORDER BY m.created_at DESC
    LIMIT limit_count;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_get_channel_links(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_get_channel_links(uuid, int) TO anon, authenticated, service_role;
