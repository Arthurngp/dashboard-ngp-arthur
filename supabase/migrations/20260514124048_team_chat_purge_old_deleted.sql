-- Purga manual de mensagens soft-deletadas há mais de 30 dias.
-- Execução manual via SQL pelo admin: SELECT public.team_chat_purge_old_deleted_messages();
-- Documentada em docs/chat-retencao.md.

CREATE OR REPLACE FUNCTION public.team_chat_purge_old_deleted_messages(retention_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  msgs_count int;
  atts_count int;
  reacts_count int;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL OR NOT public.team_chat_is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem purgar mensagens';
  END IF;

  SELECT count(*) INTO msgs_count
  FROM public.team_chat_messages
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - (retention_days || ' days')::interval;

  WITH purged AS (
    SELECT id FROM public.team_chat_messages
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - (retention_days || ' days')::interval
  )
  SELECT
    (SELECT count(*) FROM public.team_chat_attachments a WHERE a.message_id IN (SELECT id FROM purged)),
    (SELECT count(*) FROM public.team_chat_reactions r WHERE r.message_id IN (SELECT id FROM purged))
  INTO atts_count, reacts_count;

  DELETE FROM public.team_chat_messages
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - (retention_days || ' days')::interval;

  RETURN jsonb_build_object(
    'messages_purged', msgs_count,
    'attachments_purged', atts_count,
    'reactions_purged', reacts_count,
    'retention_days', retention_days,
    'cutoff', (now() - (retention_days || ' days')::interval)::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_purge_old_deleted_messages(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_purge_old_deleted_messages(int) TO anon, authenticated, service_role;
